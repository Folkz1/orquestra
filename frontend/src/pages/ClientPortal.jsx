import { useEffect, useMemo, useState } from 'react'
import {
  bulkCreateActiveClientPortalLinks,
  createClientPortalLink,
  deleteClientPortalLink,
  getClientPortalLinks,
  getProjectOptions,
  requestClientPortalFeedback,
  updateClientPortalLink,
} from '../api'

const SECTION_OPTIONS = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'proposals', label: 'Propostas' },
  { key: 'recordings', label: 'Gravacoes' },
]

const FEEDBACK_TYPES = [
  { key: 'feedback', label: 'Feedback' },
  { key: 'test', label: 'Teste' },
  { key: 'approval', label: 'Aprovacao' },
]

const PUBLIC_PORTAL_FALLBACK = 'https://orquestra-backend.jz9bd8.easypanel.host'

const emptyForm = {
  projectId: '',
  clientName: '',
  welcomeMessage: '',
  visibleSections: SECTION_OPTIONS.map((item) => item.key),
}

function timeAgo(dateStr) {
  if (!dateStr) return 'nunca'
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function formatDate(dateStr) {
  if (!dateStr) return 'Nao informado'
  return new Date(dateStr).toLocaleString('pt-BR')
}

function normalizePortalUrl(url) {
  if (!url) return ''

  try {
    const parsed = new URL(url)
    if (parsed.hostname.includes('wordpress_')) {
      return `${PUBLIC_PORTAL_FALLBACK}${parsed.pathname}`
    }
    return parsed.toString()
  } catch {
    if (url.startsWith('/')) {
      return `${PUBLIC_PORTAL_FALLBACK}${url}`
    }
    return url
  }
}

function getFeedbackLabel(type) {
  return FEEDBACK_TYPES.find((item) => item.key === type)?.label || 'Feedback'
}

function hoursSince(dateStr) {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.max(0, Math.floor(diff / 3600000))
}

function daysSince(dateStr) {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.max(0, Math.floor(diff / 86400000))
}

function formatPercent(value) {
  return `${Math.round(value || 0)}%`
}

function MetricCard({ label, value, note, tone = 'zinc' }) {
  const tones = {
    zinc: 'border-zinc-800 bg-zinc-900/80',
    sky: 'border-sky-500/20 bg-sky-500/10',
    emerald: 'border-emerald-500/20 bg-emerald-500/10',
    amber: 'border-amber-500/20 bg-amber-500/10',
  }

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] || tones.zinc}`}>
      <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-zinc-50">{value}</p>
      <p className="mt-2 text-sm text-zinc-400">{note}</p>
    </div>
  )
}

function StatusBadge({ active, expiresAt }) {
  if (!active) {
    return <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-300">Inativo</span>
  }
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return <span className="rounded-full border border-red-500/30 bg-red-500/15 px-2.5 py-1 text-[11px] font-medium text-red-300">Expirado</span>
  }
  return <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">Ativo</span>
}

function FeedbackBadge({ status, type }) {
  const tone =
    status === 'requested'
      ? 'border-amber-500/30 bg-amber-500/15 text-amber-200'
      : status === 'completed'
        ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200'
        : 'border-sky-500/20 bg-sky-500/10 text-sky-200'

  const label =
    status === 'requested'
      ? `${getFeedbackLabel(type)} pendente`
      : status === 'completed'
        ? 'Feedback concluido'
        : 'Sem checkpoint'

  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone}`}>{label}</span>
}

function AnalyticsBar({ label, value, total, tone = 'sky' }) {
  const width = total > 0 ? `${Math.max(8, Math.round((value / total) * 100))}%` : '0%'
  const tones = {
    sky: 'from-sky-400/80 to-cyan-300/80',
    emerald: 'from-emerald-400/80 to-teal-300/80',
    amber: 'from-amber-300/80 to-orange-300/80',
    rose: 'from-rose-400/80 to-red-300/80',
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-zinc-300">{label}</span>
        <span className="text-zinc-500">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full bg-gradient-to-r ${tones[tone] || tones.sky}`} style={{ width }} />
      </div>
    </div>
  )
}

export default function ClientPortal() {
  const [links, setLinks] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [feedbackForms, setFeedbackForms] = useState({})
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (showCreate && projects.length === 0 && !projectsLoading) {
      loadProjects()
    }
  }, [showCreate, projects.length, projectsLoading])

  async function loadData() {
    setLoading(true)
    try {
      const linksData = await getClientPortalLinks()
      setLinks(
        (linksData || [])
          .map((link) => ({ ...link, portal_url: normalizePortalUrl(link.portal_url) }))
          .sort((a, b) => {
            const aPriority = a.feedback_status === 'requested' ? 2 : a.is_active ? 1 : 0
            const bPriority = b.feedback_status === 'requested' ? 2 : b.is_active ? 1 : 0
            if (aPriority !== bPriority) return bPriority - aPriority
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          })
      )
    } catch (error) {
      console.error('[ClientPortal] load failed:', error)
    }
    setLoading(false)
  }

  async function loadProjects() {
    setProjectsLoading(true)
    try {
      const projectsData = await getProjectOptions()
      setProjects(Array.isArray(projectsData) ? projectsData : projectsData.items || [])
    } catch (error) {
      console.error('[ClientPortal] project options failed:', error)
    }
    setProjectsLoading(false)
  }

  function resetForm() {
    setForm(emptyForm)
  }

  function toggleSection(section) {
    setForm((current) => {
      const exists = current.visibleSections.includes(section)
      return {
        ...current,
        visibleSections: exists
          ? current.visibleSections.filter((item) => item !== section)
          : [...current.visibleSections, section],
      }
    })
  }

  function ensureFeedbackForm(link) {
    setFeedbackForms((current) => {
      if (current[link.id]) return current
      return {
        ...current,
        [link.id]: {
          feedback_type: link.feedback_type || 'feedback',
          title: link.feedback_title || '',
          message: link.feedback_message || '',
        },
      }
    })
  }

  async function handleCreate(event) {
    event.preventDefault()
    if (!form.projectId || !form.clientName.trim() || form.visibleSections.length === 0) return

    setSubmitting(true)
    try {
      const result = await createClientPortalLink({
        project_id: form.projectId,
        client_name: form.clientName.trim(),
        welcome_message: form.welcomeMessage.trim() || null,
        visible_sections: form.visibleSections,
        expires_hours: 720,
      })
      const portalUrl = normalizePortalUrl(result.portal_url)
      await navigator.clipboard.writeText(portalUrl)
      alert(`Link criado e copiado.\n\n${portalUrl}`)
      setShowCreate(false)
      resetForm()
      await loadData()
    } catch (error) {
      alert('Erro ao criar link: ' + (error?.data?.detail || error.message || error))
    }
    setSubmitting(false)
  }

  async function handleBulkCreate() {
    setBulkLoading(true)
    try {
      const result = await bulkCreateActiveClientPortalLinks({ expires_hours: 720 })
      alert(`Portais sincronizados.\n\nCriados: ${result.created_count}\nAtualizados: ${result.updated_count}\nIgnorados: ${result.skipped_count}`)
      await loadData()
    } catch (error) {
      alert('Erro ao criar portais ativos: ' + (error?.data?.detail || error.message || error))
    }
    setBulkLoading(false)
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(normalizePortalUrl(url))
      alert('Link copiado.')
    } catch {
      alert('Nao foi possivel copiar o link automaticamente.')
    }
  }

  async function toggleActive(link) {
    setBusyId(link.id)
    try {
      await updateClientPortalLink(link.id, { is_active: !link.is_active })
      await loadData()
    } catch (error) {
      alert('Erro ao atualizar link: ' + (error?.data?.detail || error.message || error))
    }
    setBusyId(null)
  }

  async function handleDeactivate(link) {
    if (!confirm(`Desativar o link de ${link.client_name}?`)) return

    setBusyId(link.id)
    try {
      await deleteClientPortalLink(link.id)
      await loadData()
    } catch (error) {
      alert('Erro ao desativar link: ' + (error?.data?.detail || error.message || error))
    }
    setBusyId(null)
  }

  async function handleFeedbackRequest(link) {
    const draft = feedbackForms[link.id] || { feedback_type: 'feedback', title: '', message: '' }
    setBusyId(link.id)
    try {
      const result = await requestClientPortalFeedback(link.id, {
        feedback_type: draft.feedback_type,
        title: draft.title.trim() || null,
        message: draft.message.trim() || null,
        send_whatsapp: true,
      })
      alert(result.notification_sent ? 'Cliente notificado com o link do portal.' : 'Checkpoint salvo, mas o envio WhatsApp falhou.')
      await loadData()
    } catch (error) {
      alert('Erro ao solicitar feedback: ' + (error?.data?.detail || error.message || error))
    }
    setBusyId(null)
  }

  async function markFeedbackState(link, status) {
    setBusyId(link.id)
    try {
      await updateClientPortalLink(link.id, { feedback_status: status })
      await loadData()
    } catch (error) {
      alert('Erro ao atualizar checkpoint: ' + (error?.data?.detail || error.message || error))
    }
    setBusyId(null)
  }

  const stats = useMemo(() => {
    const active = links.filter((link) => link.is_active).length
    const pending = links.filter((link) => link.feedback_status === 'requested').length
    const totalViews = links.reduce((sum, link) => sum + (link.view_count || 0), 0)
    return { total: links.length, active, pending, totalViews }
  }, [links])

  const analytics = useMemo(() => {
    const total = links.length
    const active = links.filter((link) => link.is_active)
    const viewed = links.filter((link) => (link.view_count || 0) > 0)
    const neverViewed = links.filter((link) => (link.view_count || 0) === 0)
    const expired = links.filter((link) => link.expires_at && new Date(link.expires_at) < new Date())
    const pending = links.filter((link) => link.feedback_status === 'requested')
    const completed = links.filter((link) => link.feedback_status === 'completed')
    const withPhone = links.filter((link) => Boolean(link.contact_phone))
    const sent = links.filter((link) => Boolean(link.feedback_sent_at))
    const stale = links.filter((link) => {
      const lastSeenHours = hoursSince(link.last_viewed_at)
      return link.is_active && lastSeenHours !== null && lastSeenHours >= 72
    })
    const blind = links.filter((link) => link.is_active && !link.last_viewed_at && daysSince(link.created_at) >= 3)
    const nearExpiry = links.filter((link) => {
      if (!link.expires_at) return false
      const diff = new Date(link.expires_at).getTime() - Date.now()
      return diff > 0 && diff <= 7 * 86400000
    })
    const avgViews = total ? (links.reduce((sum, link) => sum + (link.view_count || 0), 0) / total) : 0
    const activationRate = total ? (active.length / total) * 100 : 0
    const engagementRate = total ? (viewed.length / total) * 100 : 0
    const feedbackCloseRate = pending.length + completed.length > 0
      ? (completed.length / (pending.length + completed.length)) * 100
      : 0
    const notificationCoverage = total ? (withPhone.length / total) * 100 : 0
    const topViewed = [...links]
      .filter((link) => (link.view_count || 0) > 0)
      .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
      .slice(0, 5)
    const attention = [...links]
      .filter((link) => link.feedback_status === 'requested' || blind.includes(link) || stale.includes(link) || !link.contact_phone)
      .sort((a, b) => {
        const aScore = (a.feedback_status === 'requested' ? 3 : 0) + (!a.contact_phone ? 2 : 0) + ((a.view_count || 0) === 0 ? 1 : 0)
        const bScore = (b.feedback_status === 'requested' ? 3 : 0) + (!b.contact_phone ? 2 : 0) + ((b.view_count || 0) === 0 ? 1 : 0)
        return bScore - aScore
      })
      .slice(0, 5)
    const sectionCoverage = SECTION_OPTIONS.map((section) => ({
      key: section.key,
      label: section.label,
      value: links.filter((link) => (link.visible_sections || []).includes(section.key)).length,
    }))

    return {
      total,
      active: active.length,
      viewed: viewed.length,
      neverViewed: neverViewed.length,
      expired: expired.length,
      pending: pending.length,
      completed: completed.length,
      sent: sent.length,
      withPhone: withPhone.length,
      stale: stale.length,
      blind: blind.length,
      nearExpiry: nearExpiry.length,
      avgViews,
      activationRate,
      engagementRate,
      feedbackCloseRate,
      notificationCoverage,
      topViewed,
      attention,
      sectionCoverage,
    }
  }, [links])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-zinc-800 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(234,179,8,0.12),transparent_22%),linear-gradient(145deg,#050816,#0b1224_58%,#111827)] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.35em] text-sky-200/80">Portal cliente</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 md:text-4xl">Portal de acompanhamento mais forte, com checkpoint de feedback e rollout em lote.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-300">Cada cliente ganha um portal publico com status do projeto, timeline, propostas e gravacoes. Quando voce precisar de aprovacao, feedback ou teste, dispara o link do portal direto no WhatsApp.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleBulkCreate}
              disabled={bulkLoading}
              className="rounded-xl border border-sky-400/20 bg-sky-500/15 px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-500/25 disabled:opacity-50"
            >
              {bulkLoading ? 'Sincronizando...' : 'Criar portais ativos'}
            </button>
            <button
              onClick={() => setShowCreate((value) => !value)}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/80"
            >
              + Novo link
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <MetricCard label="Portais" value={stats.total} note="Links publicados no workspace" />
          <MetricCard label="Ativos" value={stats.active} note="Portais atualmente acessiveis" tone="emerald" />
          <MetricCard label="Pendentes" value={stats.pending} note="Clientes aguardando feedback ou teste" tone="amber" />
          <MetricCard label="Views" value={stats.totalViews} note="Visualizacoes somadas dos links" tone="sky" />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
        <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/80 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-zinc-500">Analytics</p>
              <h2 className="mt-2 text-xl font-semibold text-zinc-50">Funnel e saude operacional</h2>
            </div>
            <div className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-400">
              media {analytics.avgViews.toFixed(1)} views por portal
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <MetricCard label="Engajamento" value={formatPercent(analytics.engagementRate)} note={`${analytics.viewed} de ${analytics.total || 0} ja abriram`} tone="sky" />
            <MetricCard label="Cobertura WA" value={formatPercent(analytics.notificationCoverage)} note={`${analytics.withPhone} links com telefone`} tone="emerald" />
            <MetricCard label="Fechamento" value={formatPercent(analytics.feedbackCloseRate)} note={`${analytics.completed} checkpoints concluidos`} tone="amber" />
            <MetricCard label="Ativacao" value={formatPercent(analytics.activationRate)} note={`${analytics.active} links ativos`} />
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4">
              <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-500">Funnel</p>
              <div className="mt-4 space-y-4">
                <AnalyticsBar label="Portais criados" value={analytics.total} total={analytics.total || 1} />
                <AnalyticsBar label="Portais ativos" value={analytics.active} total={analytics.total || 1} tone="emerald" />
                <AnalyticsBar label="Portais visualizados" value={analytics.viewed} total={analytics.total || 1} />
                <AnalyticsBar label="Checkpoints enviados" value={analytics.sent} total={analytics.total || 1} tone="amber" />
                <AnalyticsBar label="Checkpoints concluidos" value={analytics.completed} total={analytics.total || 1} tone="rose" />
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4">
              <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-500">Saude</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                  <p className="text-xs text-zinc-500">Nunca abriram</p>
                  <p className="mt-2 text-2xl font-semibold text-zinc-50">{analytics.neverViewed}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                  <p className="text-xs text-zinc-500">Frios 72h+</p>
                  <p className="mt-2 text-2xl font-semibold text-zinc-50">{analytics.stale}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                  <p className="text-xs text-zinc-500">Cegos 3d+</p>
                  <p className="mt-2 text-2xl font-semibold text-zinc-50">{analytics.blind}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                  <p className="text-xs text-zinc-500">Expiram em 7d</p>
                  <p className="mt-2 text-2xl font-semibold text-zinc-50">{analytics.nearExpiry}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/80 p-5">
            <p className="text-[11px] uppercase tracking-[0.3em] text-zinc-500">Ranking</p>
            <h2 className="mt-2 text-xl font-semibold text-zinc-50">Portais mais vistos</h2>
            <div className="mt-4 space-y-3">
              {analytics.topViewed.length === 0 ? (
                <p className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-4 text-sm text-zinc-500">Ainda nao ha links com visualizacao registrada.</p>
              ) : (
                analytics.topViewed.map((link, index) => (
                  <div key={link.id} className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-zinc-100">{index + 1}. {link.client_name}</p>
                        <p className="mt-1 text-xs text-zinc-500">{link.project_name || 'Sem projeto'} · ultimo acesso {link.last_viewed_at ? `${timeAgo(link.last_viewed_at)} atras` : 'nunca'}</p>
                      </div>
                      <div className="rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs text-sky-100">
                        {link.view_count || 0} views
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/80 p-5">
            <p className="text-[11px] uppercase tracking-[0.3em] text-zinc-500">Atencao</p>
            <h2 className="mt-2 text-xl font-semibold text-zinc-50">Portais que pedem acao</h2>
            <div className="mt-4 space-y-3">
              {analytics.attention.length === 0 ? (
                <p className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-4 text-sm text-zinc-500">Nenhum portal com sinal forte de risco no momento.</p>
              ) : (
                analytics.attention.map((link) => (
                  <div key={link.id} className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-zinc-100">{link.client_name}</p>
                        <p className="mt-1 text-xs text-zinc-500">{link.project_name || 'Sem projeto'}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {link.feedback_status === 'requested' && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-200">feedback pendente</span>}
                          {!link.contact_phone && <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-200">sem telefone</span>}
                          {(link.view_count || 0) === 0 && <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300">sem views</span>}
                          {hoursSince(link.last_viewed_at) >= 72 && <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-200">frio 72h+</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => setExpanded((current) => current === link.id ? null : link.id)}
                        className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-300"
                      >
                        Abrir
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/80 p-5">
            <p className="text-[11px] uppercase tracking-[0.3em] text-zinc-500">Cobertura</p>
            <h2 className="mt-2 text-xl font-semibold text-zinc-50">Secoes liberadas</h2>
            <div className="mt-4 space-y-4">
              {analytics.sectionCoverage.map((item) => (
                <AnalyticsBar key={item.key} label={item.label} value={item.value} total={analytics.total || 1} tone="emerald" />
              ))}
            </div>
          </div>
        </div>
      </section>

      {showCreate && (
        <form onSubmit={handleCreate} className="rounded-[24px] border border-zinc-800 bg-zinc-900/90 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-zinc-50">Criar portal manual</h2>
              <p className="mt-1 text-sm text-zinc-400">Use quando quiser publicar um portal pontual antes da sincronizacao em lote.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">Projeto</label>
              <select
                value={form.projectId}
                onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100"
                required
                disabled={projectsLoading}
              >
                <option value="">{projectsLoading ? 'Carregando...' : 'Selecione...'}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">Nome do cliente</label>
              <input
                value={form.clientName}
                onChange={(event) => setForm((current) => ({ ...current, clientName: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100"
                placeholder="Ex: Emilio"
                required
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">Mensagem de boas-vindas</label>
            <textarea
              value={form.welcomeMessage}
              onChange={(event) => setForm((current) => ({ ...current, welcomeMessage: event.target.value }))}
              className="mt-2 w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100"
              rows={3}
              placeholder="Acompanhe aqui a evolucao do seu projeto."
            />
          </div>

          <div className="mt-4">
            <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">Secoes visiveis</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {SECTION_OPTIONS.map((section) => {
                const checked = form.visibleSections.includes(section.key)
                return (
                  <label
                    key={section.key}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm transition ${
                      checked
                        ? 'border-primary/40 bg-primary/10 text-zinc-100'
                        : 'border-zinc-700 bg-zinc-950 text-zinc-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSection(section.key)}
                      className="accent-primary"
                    />
                    <span>{section.label}</span>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={submitting || form.visibleSections.length === 0}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? 'Criando...' : 'Criar e copiar link'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false)
                resetForm()
              }}
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-300"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {links.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-zinc-800 bg-zinc-950/50 px-6 py-16 text-center">
          <p className="text-zinc-100">Nenhum portal criado</p>
          <p className="mt-2 text-sm text-zinc-500">Use "Criar portais ativos" para publicar uma base inicial para todos os clientes com projeto em andamento.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {links.map((link) => {
            const isExpanded = expanded === link.id
            const feedbackForm = feedbackForms[link.id] || {
              feedback_type: link.feedback_type || 'feedback',
              title: link.feedback_title || '',
              message: link.feedback_message || '',
            }

            return (
              <div key={link.id} className="overflow-hidden rounded-[24px] border border-zinc-800 bg-zinc-950/80">
                <div
                  className="cursor-pointer p-5 transition hover:bg-zinc-900/70"
                  onClick={() => {
                    setExpanded(isExpanded ? null : link.id)
                    if (!isExpanded) ensureFeedbackForm(link)
                  }}
                  style={{ borderLeft: `4px solid ${link.project_color || '#3b82f6'}` }}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-semibold text-zinc-50">{link.client_name}</span>
                        <StatusBadge active={link.is_active} expiresAt={link.expires_at} />
                        <FeedbackBadge status={link.feedback_status} type={link.feedback_type} />
                      </div>
                      <div className="text-sm text-zinc-400">
                        {link.project_name || 'Sem projeto'} · {link.view_count || 0} views · criado {timeAgo(link.created_at)} atras
                      </div>
                      <div className="grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
                        <span>Ultimo acesso: {link.last_viewed_at ? timeAgo(link.last_viewed_at) + ' atras' : 'nunca'}</span>
                        <span>Checkpoint: {link.feedback_requested_at ? formatDate(link.feedback_requested_at) : 'nao solicitado'}</span>
                        <span>WhatsApp: {link.contact_phone || 'contato nao vinculado'}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          window.open(link.portal_url, '_blank', 'noopener,noreferrer')
                        }}
                        className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200"
                      >
                        Abrir portal
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          copyLink(link.portal_url)
                        }}
                        className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200"
                      >
                        Copiar link
                      </button>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-zinc-800 px-5 pb-5 pt-5">
                    <div className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4">
                          <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-500">Experiencia do portal</p>
                          <p className="mt-3 text-sm leading-7 text-zinc-300">{link.welcome_message || 'Sem mensagem personalizada.'}</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {(link.visible_sections || []).map((section) => (
                              <span key={section} className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-xs text-sky-100">
                                {SECTION_OPTIONS.find((item) => item.key === section)?.label || section}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.25em] text-amber-200/70">Checkpoint</p>
                              <h3 className="mt-2 text-lg font-semibold text-zinc-50">Solicitar feedback, teste ou aprovacao</h3>
                              <p className="mt-2 text-sm leading-7 text-zinc-300">Ao disparar, o sistema marca o portal como checkpoint ativo e envia o link direto no WhatsApp do cliente vinculado.</p>
                            </div>
                            {!link.contact_phone && (
                              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-200">Sem contato vinculado</span>
                            )}
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Tipo</label>
                              <select
                                value={feedbackForm.feedback_type}
                                onChange={(event) =>
                                  setFeedbackForms((current) => ({
                                    ...current,
                                    [link.id]: { ...feedbackForm, feedback_type: event.target.value },
                                  }))
                                }
                                className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100"
                              >
                                {FEEDBACK_TYPES.map((item) => (
                                  <option key={item.key} value={item.key}>{item.label}</option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Titulo</label>
                              <input
                                value={feedbackForm.title}
                                onChange={(event) =>
                                  setFeedbackForms((current) => ({
                                    ...current,
                                    [link.id]: { ...feedbackForm, title: event.target.value },
                                  }))
                                }
                                className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100"
                                placeholder="Ex: Teste liberado para aprovacao final"
                              />
                            </div>
                          </div>

                          <div className="mt-3">
                            <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Mensagem</label>
                            <textarea
                              value={feedbackForm.message}
                              onChange={(event) =>
                                setFeedbackForms((current) => ({
                                  ...current,
                                  [link.id]: { ...feedbackForm, message: event.target.value },
                                }))
                              }
                              className="mt-2 w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100"
                              rows={4}
                              placeholder="Explique o que o cliente precisa validar ou aprovar."
                            />
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              onClick={() => handleFeedbackRequest(link)}
                              disabled={busyId === link.id || !link.contact_phone}
                              className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
                            >
                              {busyId === link.id ? 'Enviando...' : 'Solicitar e enviar link'}
                            </button>
                            <button
                              onClick={() => markFeedbackState(link, 'completed')}
                              disabled={busyId === link.id}
                              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 disabled:opacity-50"
                            >
                              Marcar concluido
                            </button>
                            <button
                              onClick={() => markFeedbackState(link, 'idle')}
                              disabled={busyId === link.id}
                              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 disabled:opacity-50"
                            >
                              Limpar checkpoint
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4">
                          <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-500">Tracking</p>
                          <div className="mt-3 space-y-2 text-sm text-zinc-300">
                            <p>Visualizacoes: {link.view_count || 0}</p>
                            <p>Ultimo acesso: {formatDate(link.last_viewed_at)}</p>
                            <p>Expira em: {formatDate(link.expires_at)}</p>
                            <p>Ultimo envio: {formatDate(link.feedback_sent_at)}</p>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4">
                          <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-500">URL publica</p>
                          <p className="mt-3 break-all text-sm leading-7 text-zinc-300">{link.portal_url}</p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => copyLink(link.portal_url)}
                            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white"
                          >
                            Copiar novamente
                          </button>
                          <button
                            onClick={() => toggleActive(link)}
                            disabled={busyId === link.id}
                            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 disabled:opacity-50"
                          >
                            {link.is_active ? 'Desativar' : 'Reativar'}
                          </button>
                          <button
                            onClick={() => handleDeactivate(link)}
                            disabled={busyId === link.id || !link.is_active}
                            className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200 disabled:opacity-50"
                          >
                            Remover acesso
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
