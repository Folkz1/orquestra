import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRecordings, getRecording, getProjects } from '../api'

function formatDuration(seconds) {
  if (!seconds) return '--:--'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function RecordingDetail({ recording, onClose }) {
  const [showTranscription, setShowTranscription] = useState(false)
  const actionItems = recording.action_items || []
  const decisions = recording.decisions || []
  const topics = recording.key_topics || []

  return (
    <div className="animate-fade-in">
      <button
        onClick={onClose}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 mb-4 transition-colors"
      >
        <span>&#8592;</span> Voltar
      </button>

      {/* Header card */}
      <div className="card mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              {recording.title || 'Gravação sem título'}
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 mt-1">
              <span>{formatDate(recording.recorded_at || recording.created_at)}</span>
              <span className="text-zinc-300 font-medium">{formatDuration(recording.duration_seconds)}</span>
              {recording.file_size_bytes && <span>{formatSize(recording.file_size_bytes)}</span>}
              {recording.source && (
                <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{recording.source}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {recording.processed ? (
              <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">Processado</span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-500">Pendente</span>
            )}
            {recording.project_name && (
              <span className="text-xs px-2 py-0.5 rounded bg-primary/20 text-primary">{recording.project_name}</span>
            )}
          </div>
        </div>

        {/* ID for reference */}
        <div className="mt-2 text-[10px] text-zinc-700 font-mono select-all">
          ID: {recording.id}
        </div>
      </div>

      {/* Summary */}
      {recording.summary && (
        <div className="card mb-3">
          <h3 className="text-sm font-semibold text-primary mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Resumo
          </h3>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
            {recording.summary}
          </p>
        </div>
      )}

      {/* Action items + Decisions side by side */}
      {(actionItems.length > 0 || decisions.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          {actionItems.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-yellow-400 mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                Ações ({actionItems.length})
              </h3>
              <ul className="space-y-2">
                {actionItems.map((item, i) => {
                  const task = typeof item === 'string' ? item : item.task || item.action || item.description || JSON.stringify(item)
                  const assignee = typeof item === 'object' ? item.assignee : null
                  const priority = typeof item === 'object' ? item.priority : null
                  return (
                    <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                      <span className="text-yellow-400 mt-0.5 flex-shrink-0">&#9679;</span>
                      <div>
                        <span>{task}</span>
                        {(assignee || priority) && (
                          <div className="flex gap-2 mt-0.5">
                            {assignee && <span className="text-[10px] text-zinc-500">@{assignee}</span>}
                            {priority && (
                              <span className={`text-[10px] px-1 rounded ${
                                priority === 'high' ? 'bg-red-500/20 text-red-400' :
                                priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                'bg-zinc-800 text-zinc-500'
                              }`}>{priority}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {decisions.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-blue-400 mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Decisões ({decisions.length})
              </h3>
              <ul className="space-y-2">
                {decisions.map((d, i) => {
                  const decision = typeof d === 'string' ? d : d.decision || d.description || JSON.stringify(d)
                  const context = typeof d === 'object' ? d.context : null
                  return (
                    <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                      <span className="text-blue-400 mt-0.5 flex-shrink-0">&#9679;</span>
                      <div>
                        <span>{decision}</span>
                        {context && <p className="text-[11px] text-zinc-500 mt-0.5 italic">{context}</p>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Topics */}
      {topics.length > 0 && (
        <div className="card mb-3">
          <h3 className="text-sm font-semibold text-zinc-400 mb-2">Tópicos</h3>
          <div className="flex flex-wrap gap-1.5">
            {topics.map((t, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Transcription (collapsible) */}
      {recording.transcription && (
        <div className="card">
          <button
            onClick={() => setShowTranscription(!showTranscription)}
            className="w-full flex items-center justify-between text-sm font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              Transcrição ({recording.transcription.length.toLocaleString()} chars)
            </span>
            <span className="text-xs">{showTranscription ? '▼ Ocultar' : '▶ Expandir'}</span>
          </button>
          {showTranscription && (
            <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap mt-3 max-h-[600px] overflow-y-auto">
              {recording.transcription}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function RecordingCard({ recording, onClick }) {
  const hasActions = recording.action_items && recording.action_items.length > 0
  const hasDecisions = recording.decisions && recording.decisions.length > 0
  const topics = recording.key_topics || []

  return (
    <div
      onClick={onClick}
      className="card cursor-pointer hover:border-zinc-600 transition-all animate-fade-in"
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg ${
          recording.processed ? 'bg-primary/10' : 'bg-zinc-800'
        }`}>
          🎧
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm text-zinc-100 truncate">
              {recording.title || 'Gravação sem título'}
            </h3>
            {recording.project_name && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary flex-shrink-0">
                {recording.project_name}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
            <span>{timeAgo(recording.recorded_at || recording.created_at)}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-300">{formatDuration(recording.duration_seconds)}</span>
            {recording.file_size_bytes && (
              <>
                <span className="text-zinc-700">·</span>
                <span>{formatSize(recording.file_size_bytes)}</span>
              </>
            )}
          </div>

          {/* Summary preview */}
          {recording.summary ? (
            <p className="text-xs text-zinc-400 mt-1.5 line-clamp-2 leading-relaxed">
              {recording.summary.substring(0, 200)}
            </p>
          ) : recording.transcription ? (
            <p className="text-xs text-zinc-600 mt-1.5 line-clamp-1 italic">
              {recording.transcription.substring(0, 120)}...
            </p>
          ) : null}

          {/* Bottom row: topics + stats */}
          <div className="flex items-center gap-2 mt-2">
            {topics.slice(0, 3).map((t, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{t}</span>
            ))}
            {topics.length > 3 && (
              <span className="text-[10px] text-zinc-600">+{topics.length - 3}</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {hasActions && (
                <span className="text-[10px] text-yellow-500">{recording.action_items.length} ações</span>
              )}
              {hasDecisions && (
                <span className="text-[10px] text-blue-400">{recording.decisions.length} decisões</span>
              )}
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="flex-shrink-0">
          {recording.processed ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">OK</span>
          ) : (
            <div className="w-4 h-4 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
          )}
        </div>
      </div>
    </div>
  )
}

export default function Recordings() {
  const navigate = useNavigate()
  const [recordings, setRecordings] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('')

  useEffect(() => {
    Promise.all([
      getRecordings().catch(() => ({ items: [] })),
      getProjects().catch(() => []),
    ]).then(([recData, projData]) => {
      const list = Array.isArray(recData) ? recData : recData.items || recData.recordings || []
      list.sort((a, b) => new Date(b.recorded_at || b.created_at || 0) - new Date(a.recorded_at || a.created_at || 0))
      setRecordings(list)
      setProjects(Array.isArray(projData) ? projData : projData.items || [])
    }).finally(() => setLoading(false))
  }, [])

  const openDetail = async (rec) => {
    setDetailLoading(true)
    try {
      const full = rec.id ? await getRecording(rec.id) : rec
      setSelected(full)
    } catch {
      setSelected(rec)
    }
    setDetailLoading(false)
  }

  const filtered = recordings.filter((r) => {
    if (filterProject && r.project_id !== filterProject && r.project_name !== filterProject) return false
    if (!search) return true
    const s = search.toLowerCase()
    return (
      (r.title && r.title.toLowerCase().includes(s)) ||
      (r.summary && r.summary.toLowerCase().includes(s)) ||
      (r.transcription && r.transcription.toLowerCase().includes(s)) ||
      (r.key_topics && r.key_topics.some(t => t.toLowerCase().includes(s)))
    )
  })

  const totalDuration = recordings.reduce((sum, r) => sum + (r.duration_seconds || 0), 0)
  const processedCount = recordings.filter(r => r.processed).length

  if (detailLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  if (selected) {
    return <RecordingDetail recording={selected} onClose={() => setSelected(null)} />
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Gravações</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{recordings.length} gravações</span>
            <span className="text-zinc-700">·</span>
            <span className="text-green-400">{processedCount} processadas</span>
            <span className="text-zinc-700">·</span>
            <span>{formatDuration(totalDuration)} total</span>
          </div>
          <button
            onClick={() => navigate('/gravador')}
            className="btn-primary text-sm px-4 py-1.5 flex items-center gap-1.5"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Gravar
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Buscar por título, resumo, transcrição ou tópico..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input flex-1"
        />
        <select
          value={filterProject}
          onChange={(e) => setFilterProject(e.target.value)}
          className="input w-40"
        >
          <option value="">Todos projetos</option>
          {projects.map(p => (
            <option key={p.id} value={p.name}>{p.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-4xl mb-3">🎧</p>
          <p>Nenhuma gravação encontrada</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((rec, idx) => (
            <RecordingCard
              key={rec.id || idx}
              recording={rec}
              onClick={() => openDetail(rec)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
