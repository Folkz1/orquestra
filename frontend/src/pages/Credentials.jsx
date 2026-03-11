import { useState, useEffect } from 'react'
import { getCredentialLinks, createCredentialLink, getProjects, getProjectCredentials } from '../api'

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

function StatusBadge({ submitted, expiresAt }) {
  if (submitted) {
    return <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400">Preenchido</span>
  }
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">Expirado</span>
  }
  return <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">Pendente</span>
}

function CredentialViewer({ projectId }) {
  const [creds, setCreds] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const data = await getProjectCredentials(projectId)
        setCreds(data.credentials || {})
      } catch { /* ignore */ }
      setLoading(false)
    })()
  }, [projectId])

  if (loading) return <p className="text-xs text-zinc-500 mt-2">Carregando...</p>
  if (!creds || Object.keys(creds).length === 0) return <p className="text-xs text-zinc-500 mt-2">Nenhuma credencial salva</p>

  return (
    <div className="mt-3 space-y-1.5">
      {Object.entries(creds).map(([key, val]) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="text-zinc-400 font-medium min-w-[140px]">{val.label || key}:</span>
          <code className="text-zinc-300 bg-zinc-800 px-2 py-0.5 rounded font-mono">{val.masked}</code>
          <span className="text-zinc-600">{timeAgo(val.updated_at)}</span>
        </div>
      ))}
    </div>
  )
}

export default function Credentials() {
  const [links, setLinks] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [creating, setCreating] = useState(false)

  // Create form
  const [form, setForm] = useState({
    projectId: '',
    clientName: '',
    fields: [{ name: '', label: '', type: 'password', placeholder: '' }],
  })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [linksData, projectsData] = await Promise.all([
        getCredentialLinks(),
        getProjects(),
      ])
      setLinks(linksData)
      const items = Array.isArray(projectsData) ? projectsData : projectsData.items || []
      setProjects(items)
    } catch (err) {
      console.error('Failed to load:', err)
    }
    setLoading(false)
  }

  function addField() {
    setForm(f => ({
      ...f,
      fields: [...f.fields, { name: '', label: '', type: 'password', placeholder: '' }],
    }))
  }

  function removeField(idx) {
    setForm(f => ({ ...f, fields: f.fields.filter((_, i) => i !== idx) }))
  }

  function updateField(idx, key, value) {
    setForm(f => ({
      ...f,
      fields: f.fields.map((field, i) =>
        i === idx ? { ...field, [key]: value, ...(key === 'label' && !field.name ? { name: value.toLowerCase().replace(/[^a-z0-9]+/g, '_') } : {}) } : field
      ),
    }))
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.projectId || !form.clientName || form.fields.some(f => !f.label)) return

    setCreating(true)
    try {
      const result = await createCredentialLink({
        project_id: form.projectId,
        client_name: form.clientName,
        fields: form.fields.filter(f => f.label),
        expires_hours: 720,
      })
      // Copy link
      await navigator.clipboard.writeText(result.portal_url)
      alert(`Link criado e copiado!\n\n${result.portal_url}`)
      setShowCreate(false)
      setForm({ projectId: '', clientName: '', fields: [{ name: '', label: '', type: 'password', placeholder: '' }] })
      loadData()
    } catch (err) {
      alert('Erro ao criar link: ' + (err.message || err))
    }
    setCreating(false)
  }

  function copyLink(token) {
    const url = `${window.location.protocol}//${window.location.host.replace('orquestra.', 'orquestra-backend.')}/api/credentials/portal/${token}`
    // Fallback: use the backend URL directly
    const backendUrl = `https://orquestra-backend.jz9bd8.easypanel.host/api/credentials/portal/${token}`
    navigator.clipboard.writeText(backendUrl)
    alert('Link copiado!')
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Credenciais</h1>
          <p className="text-sm text-zinc-400 mt-1">Portal seguro para clientes preencherem API keys</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Novo Link
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-zinc-100">Criar Link de Credenciais</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400 font-medium">Projeto</label>
              <select
                value={form.projectId}
                onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}
                className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
                required
              >
                <option value="">Selecione...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400 font-medium">Nome do Cliente</label>
              <input
                value={form.clientName}
                onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
                className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
                placeholder="Ex: Alan"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-400 font-medium mb-2 block">Campos para o cliente preencher</label>
            {form.fields.map((field, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <input
                  value={field.label}
                  onChange={e => updateField(idx, 'label', e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100"
                  placeholder="Nome do campo (ex: N8N API Key)"
                  required
                />
                <select
                  value={field.type}
                  onChange={e => updateField(idx, 'type', e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-300 w-28"
                >
                  <option value="password">Senha</option>
                  <option value="text">Texto</option>
                  <option value="url">URL</option>
                </select>
                {form.fields.length > 1 && (
                  <button type="button" onClick={() => removeField(idx)} className="text-red-400 hover:text-red-300 px-2">✕</button>
                )}
              </div>
            ))}
            <button type="button" onClick={addField} className="text-xs text-primary hover:text-primary/80 mt-1">+ Adicionar campo</button>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {creating ? 'Criando...' : 'Criar e Copiar Link'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Links List */}
      {links.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-4">🔐</p>
          <p className="text-zinc-400">Nenhum link de credenciais criado</p>
          <p className="text-zinc-500 text-sm mt-1">Crie um link para seu cliente preencher as credenciais de forma segura</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map(link => (
            <div key={link.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                onClick={() => setExpanded(expanded === link.id ? null : link.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="text-2xl">{link.submitted ? '✅' : '⏳'}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-100 font-medium">{link.client_name}</span>
                      <StatusBadge submitted={link.submitted} expiresAt={link.expires_at} />
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {link.project_name} · {link.fields.length} campos · {timeAgo(link.created_at)}
                      {link.submitted_at && <span className="text-emerald-400"> · Preenchido {timeAgo(link.submitted_at)}</span>}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); copyLink(link.token.replace('...', '')) }}
                    className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-xs text-zinc-300 transition-colors"
                    title="Copiar link do portal"
                  >
                    Copiar Link
                  </button>
                  <span className="text-zinc-600 text-sm">{expanded === link.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {expanded === link.id && (
                <div className="px-4 pb-4 border-t border-zinc-800 pt-3">
                  <p className="text-xs text-zinc-500 mb-1">Campos solicitados: {link.fields.join(', ')}</p>
                  {link.submitted && <CredentialViewer projectId={link.id} />}
                  {!link.submitted && (
                    <p className="text-xs text-yellow-400 mt-2">Aguardando o cliente preencher o formulário</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
