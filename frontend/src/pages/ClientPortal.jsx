import { useEffect, useState } from 'react'
import {
  createClientPortalLink,
  deleteClientPortalLink,
  getClientPortalLinks,
  getProjects,
  updateClientPortalLink,
} from '../api'

const SECTION_OPTIONS = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'proposals', label: 'Propostas' },
  { key: 'recordings', label: 'Gravações' },
]

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
  if (minutes < 60) return `${minutes}min atrás`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h atrás`
  const days = Math.floor(hours / 24)
  return `${days}d atrás`
}

function formatDate(dateStr) {
  if (!dateStr) return 'Não informado'
  return new Date(dateStr).toLocaleString('pt-BR')
}

function StatusBadge({ active, expiresAt }) {
  if (!active) {
    return <span className="px-2 py-0.5 rounded text-xs font-medium bg-zinc-700/60 text-zinc-300">Inativo</span>
  }
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-300">Expirado</span>
  }
  return <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-300">Ativo</span>
}

export default function ClientPortal() {
  const [links, setLinks] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [linksData, projectsData] = await Promise.all([
        getClientPortalLinks(),
        getProjects(),
      ])
      setLinks(linksData || [])
      setProjects(Array.isArray(projectsData) ? projectsData : projectsData.items || [])
    } catch (error) {
      console.error('[ClientPortal] load failed:', error)
    }
    setLoading(false)
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
      await navigator.clipboard.writeText(result.portal_url)
      alert(`Link criado e copiado.\n\n${result.portal_url}`)
      setShowCreate(false)
      resetForm()
      await loadData()
    } catch (error) {
      alert('Erro ao criar link: ' + (error?.data?.detail || error.message || error))
    }
    setSubmitting(false)
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url)
      alert('Link copiado.')
    } catch (error) {
      alert('Não foi possível copiar o link automaticamente.')
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Portal Cliente</h1>
          <p className="text-sm text-zinc-400 mt-1">Links públicos read-only para acompanhar tarefas, timeline, propostas e gravações.</p>
        </div>
        <button
          onClick={() => setShowCreate((value) => !value)}
          className="px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Novo Link
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
          <h2 className="text-lg font-semibold text-zinc-100">Criar link do portal</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400 font-medium">Projeto</label>
              <select
                value={form.projectId}
                onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))}
                className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
                required
              >
                <option value="">Selecione...</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-zinc-400 font-medium">Nome do cliente</label>
              <input
                value={form.clientName}
                onChange={(event) => setForm((current) => ({ ...current, clientName: event.target.value }))}
                className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
                placeholder="Ex: Alan"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-400 font-medium block mb-2">Mensagem de boas-vindas</label>
            <textarea
              value={form.welcomeMessage}
              onChange={(event) => setForm((current) => ({ ...current, welcomeMessage: event.target.value }))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-3 text-sm text-zinc-100 resize-none"
              rows={3}
              placeholder="Acompanhe aqui a evolução do seu projeto."
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 font-medium block mb-2">Seções visíveis</label>
            <div className="grid sm:grid-cols-2 gap-2">
              {SECTION_OPTIONS.map((section) => {
                const checked = form.visibleSections.includes(section.key)
                return (
                  <label
                    key={section.key}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                      checked
                        ? 'bg-primary/10 border-primary/40 text-zinc-100'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400'
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

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting || form.visibleSections.length === 0}
              className="px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Criando...' : 'Criar e copiar link'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false)
                resetForm()
              }}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {links.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-4">🌐</p>
          <p className="text-zinc-300">Nenhum link de portal criado</p>
          <p className="text-zinc-500 text-sm mt-1">Crie um portal público para o cliente acompanhar o andamento do projeto.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map((link) => {
            const isExpanded = expanded === link.id
            const projectColor = link.project_color || '#3b82f6'
            return (
              <div key={link.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : link.id)}
                  style={{ borderLeft: `4px solid ${projectColor}` }}
                >
                  <div className="flex items-start gap-4">
                    <div className="text-2xl">{link.is_active ? '🌐' : '⏸️'}</div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-zinc-100 font-medium">{link.client_name}</span>
                        <StatusBadge active={link.is_active} expiresAt={link.expires_at} />
                      </div>
                      <p className="text-xs text-zinc-500 mt-1">
                        {link.project_name} · {link.view_count || 0} visualizações · criado {timeAgo(link.created_at)}
                      </p>
                      <p className="text-xs text-zinc-600 mt-1">
                        Último acesso: {link.last_viewed_at ? timeAgo(link.last_viewed_at) : 'nunca'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        copyLink(link.portal_url)
                      }}
                      className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-xs text-zinc-300 transition-colors"
                    >
                      Copiar link
                    </button>
                    <span className="text-zinc-600 text-sm">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-zinc-800 pt-4 space-y-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-4">
                        <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Configuração</p>
                        <p className="text-sm text-zinc-200">{link.welcome_message || 'Sem mensagem personalizada.'}</p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          {(link.visible_sections || []).map((section) => (
                            <span key={section} className="px-2 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20">
                              {SECTION_OPTIONS.find((item) => item.key === section)?.label || section}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-4">
                        <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Tracking</p>
                        <p className="text-sm text-zinc-200">Visualizações: {link.view_count || 0}</p>
                        <p className="text-sm text-zinc-400 mt-1">Último acesso: {formatDate(link.last_viewed_at)}</p>
                        <p className="text-sm text-zinc-400 mt-1">Expira em: {formatDate(link.expires_at)}</p>
                      </div>
                    </div>

                    <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-3">
                      <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">URL pública</p>
                      <p className="text-sm text-zinc-300 break-all">{link.portal_url}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => copyLink(link.portal_url)}
                        className="px-3 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg text-sm"
                      >
                        Copiar novamente
                      </button>
                      <button
                        onClick={() => toggleActive(link)}
                        disabled={busyId === link.id}
                        className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm disabled:opacity-50"
                      >
                        {link.is_active ? 'Desativar' : 'Reativar'}
                      </button>
                      <button
                        onClick={() => handleDeactivate(link)}
                        disabled={busyId === link.id || !link.is_active}
                        className="px-3 py-2 bg-red-500/15 hover:bg-red-500/25 text-red-300 rounded-lg text-sm disabled:opacity-50"
                      >
                        Remover acesso
                      </button>
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
