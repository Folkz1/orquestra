import { useState, useEffect } from 'react'
import { getProposals, createProposal, updateProposal, deleteProposal, getProposalAnalytics } from '../api'

const STATUS_COLORS = {
  draft: 'bg-zinc-700 text-zinc-300',
  sent: 'bg-blue-500/20 text-blue-400',
  viewed: 'bg-yellow-500/20 text-yellow-400',
  accepted: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
}

const STATUS_LABELS = {
  draft: 'Rascunho',
  sent: 'Enviada',
  viewed: 'Visualizada',
  accepted: 'Aceita',
  rejected: 'Rejeitada',
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}min atrás`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h atrás`
  const days = Math.floor(hours / 24)
  return `${days}d atrás`
}

function formatDuration(seconds) {
  if (!seconds || seconds < 10) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m${s > 0 ? ` ${s}s` : ''}`
}

// Mini analytics panel that loads on expand
function AnalyticsPanel({ proposalId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const d = await getProposalAnalytics(proposalId)
        setData(d)
      } catch { /* ignore */ }
      setLoading(false)
    })()
  }, [proposalId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3">
        <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
        <span className="text-zinc-500 text-xs">Carregando analytics...</span>
      </div>
    )
  }

  if (!data || data.total_views === 0) {
    return <p className="text-zinc-600 text-xs py-2">Nenhuma visualização ainda</p>
  }

  return (
    <div className="space-y-3">
      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-zinc-800/50 rounded-lg p-2.5">
          <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Visualizações</p>
          <p className="text-white text-lg font-bold">{data.total_views}</p>
          <p className="text-zinc-600 text-[10px]">{data.unique_sessions} sessões</p>
        </div>
        <div className="bg-zinc-800/50 rounded-lg p-2.5">
          <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Tempo na Página</p>
          <p className="text-white text-lg font-bold">{formatDuration(data.total_time_seconds)}</p>
          <p className="text-zinc-600 text-[10px]">acumulado</p>
        </div>
        <div className="bg-zinc-800/50 rounded-lg p-2.5">
          <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Scroll Máximo</p>
          <div className="flex items-center gap-2">
            <p className="text-white text-lg font-bold">{data.max_scroll_pct}%</p>
            <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${data.max_scroll_pct}%` }}
              />
            </div>
          </div>
        </div>
        <div className="bg-zinc-800/50 rounded-lg p-2.5">
          <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Engajamento</p>
          <div className="flex items-center gap-3">
            <span className="text-white text-lg font-bold">{data.total_annotations}</span>
            <span className="text-zinc-500 text-xs">anotações</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-white text-lg font-bold">{data.total_downloads}</span>
            <span className="text-zinc-500 text-xs">downloads</span>
          </div>
        </div>
      </div>

      {/* Sections viewed */}
      {data.sections_viewed.length > 0 && (
        <div>
          <p className="text-zinc-500 text-[10px] uppercase tracking-wide mb-1.5">Seções lidas</p>
          <div className="flex flex-wrap gap-1.5">
            {data.sections_viewed.map((s, i) => (
              <span key={i} className="bg-zinc-800 text-zinc-400 text-xs px-2 py-0.5 rounded-md">{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="flex items-center gap-3 text-[10px] text-zinc-600">
        {data.first_view && <span>Primeira visita: {new Date(data.first_view).toLocaleString('pt-BR')}</span>}
        {data.last_view && <span>Última: {timeAgo(data.last_view)}</span>}
      </div>
    </div>
  )
}

export default function Proposals() {
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ slug: '', title: '', client_name: '', client_phone: '', content: '', total_value: '', status: 'draft' })
  const [copiedSlug, setCopiedSlug] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  const baseUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin

  useEffect(() => { loadProposals() }, [])

  const loadProposals = async () => {
    setLoading(true)
    try {
      const data = await getProposals()
      setProposals(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('[Proposals] Load failed:', err)
    }
    setLoading(false)
  }

  const openCreate = () => {
    setEditingId(null)
    setForm({ slug: '', title: '', client_name: '', client_phone: '', content: '', total_value: '', status: 'draft' })
    setShowForm(true)
  }

  const openEdit = (p) => {
    setEditingId(p.id)
    setForm({
      slug: p.slug,
      title: p.title,
      client_name: p.client_name,
      client_phone: p.client_phone || '',
      content: p.content,
      total_value: p.total_value || '',
      status: p.status,
    })
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.slug.trim() || !form.client_name.trim()) return
    setSubmitting(true)
    try {
      if (editingId) {
        await updateProposal(editingId, form)
      } else {
        await createProposal(form)
      }
      setShowForm(false)
      await loadProposals()
    } catch (err) {
      console.error('[Proposals] Save failed:', err)
      alert(err.data?.detail || err.message)
    }
    setSubmitting(false)
  }

  const handleDelete = async (id) => {
    if (!confirm('Excluir esta proposta?')) return
    try {
      await deleteProposal(id)
      await loadProposals()
    } catch (err) {
      console.error('[Proposals] Delete failed:', err)
    }
  }

  const copyLink = (slug) => {
    const url = `${baseUrl}/proposta/${slug}`
    navigator.clipboard.writeText(url)
    setCopiedSlug(slug)
    setTimeout(() => setCopiedSlug(null), 2000)
  }

  const autoSlug = (title) => {
    return title.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Propostas</h1>
        <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg transition-colors">
          + Nova Proposta
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-4">{editingId ? 'Editar Proposta' : 'Nova Proposta'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Título</label>
                  <input
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value, slug: editingId ? f.slug : autoSlug(e.target.value) }))}
                    placeholder="Sistema de Emagrecimento com IA"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Slug (URL)</label>
                  <input
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                    value={form.slug}
                    onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                    placeholder="equipe-emagrecimento-thales"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Cliente</label>
                  <input
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    value={form.client_name}
                    onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
                    placeholder="Thales"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Telefone</label>
                  <input
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    value={form.client_phone}
                    onChange={e => setForm(f => ({ ...f, client_phone: e.target.value }))}
                    placeholder="+55 14 99615-2768"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Valor Total</label>
                  <input
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    value={form.total_value}
                    onChange={e => setForm(f => ({ ...f, total_value: e.target.value }))}
                    placeholder="R$ 2.500,00"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Status</label>
                <select
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                >
                  <option value="draft">Rascunho</option>
                  <option value="sent">Enviada</option>
                  <option value="viewed">Visualizada</option>
                  <option value="accepted">Aceita</option>
                  <option value="rejected">Rejeitada</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Conteúdo (Markdown)</label>
                <textarea
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono h-64 resize-y"
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="# PROPOSTA COMERCIAL..."
                  required
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-6 py-2 rounded-lg transition-colors">
                  {submitting ? 'Salvando...' : editingId ? 'Salvar' : 'Criar Proposta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-lg mb-1">Nenhuma proposta ainda</p>
          <p className="text-sm">Crie sua primeira proposta comercial</p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map(p => (
            <div key={p.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-700 transition-colors">
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-semibold text-sm truncate">{p.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[p.status] || STATUS_COLORS.draft}`}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span>{p.client_name}</span>
                      {p.total_value && <span className="text-emerald-400 font-medium">{p.total_value}</span>}
                      <span>Criada {timeAgo(p.created_at)}</span>
                      {p.viewed_at && <span className="text-yellow-400">Vista {timeAgo(p.viewed_at)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                        expandedId === p.id
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                      }`}
                    >
                      Analytics
                    </button>
                    <button
                      onClick={() => copyLink(p.slug)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                    >
                      {copiedSlug === p.slug ? 'Copiado!' : 'Link'}
                    </button>
                    <a
                      href={`${baseUrl}/proposta/${p.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                    >
                      Ver
                    </a>
                    <button onClick={() => openEdit(p)} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">
                      Editar
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors">
                      Excluir
                    </button>
                  </div>
                </div>
              </div>

              {/* Expandable analytics panel */}
              {expandedId === p.id && (
                <div className="border-t border-zinc-800 bg-zinc-900/80 p-4">
                  <AnalyticsPanel proposalId={p.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
