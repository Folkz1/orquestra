function timeAgo(dateStr) {
  if (!dateStr) return 'nunca'
  const date = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now - date) / 1000)

  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)}min atras`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atras`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d atras`
  return date.toLocaleDateString('pt-BR')
}

function statusBadge(status) {
  switch (status) {
    case 'active':
      return <span className="badge-green">ativo</span>
    case 'paused':
      return <span className="badge-yellow">pausado</span>
    case 'archived':
      return <span className="badge-zinc">arquivado</span>
    default:
      return <span className="badge-zinc">{status || 'ativo'}</span>
  }
}

export default function ProjectCard({ project, onEdit, onDelete }) {
  const color = project.color || '#22c55e'

  return (
    <div
      className="card animate-fade-in hover:border-zinc-700 transition-colors"
      style={{ borderLeftWidth: '4px', borderLeftColor: color }}
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-zinc-100">{project.name}</h3>
        {statusBadge(project.status)}
      </div>

      {project.description && (
        <p className="text-sm text-zinc-400 mb-3 line-clamp-2">
          {project.description}
        </p>
      )}

      {project.keywords && project.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {(Array.isArray(project.keywords)
            ? project.keywords
            : project.keywords.split(',')
          ).map((kw, i) => (
            <span key={i} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
              {typeof kw === 'string' ? kw.trim() : kw}
            </span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-zinc-500 mb-3">
        <span>💬 {project.stats?.total_messages ?? 0}</span>
        <span>🎙️ {project.stats?.total_recordings ?? 0}</span>
        <span>🕐 {timeAgo(project.stats?.last_activity || project.updated_at)}</span>
      </div>

      {/* Credentials summary */}
      {project.credentials && Object.keys(project.credentials).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {Object.keys(project.credentials).map((provider) => (
            <span key={provider} className="text-xs bg-zinc-800/80 text-zinc-500 px-1.5 py-0.5 rounded border border-zinc-700/50">
              {provider}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit?.(project) }}
          className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors px-2 py-1 rounded hover:bg-zinc-800"
        >
          Editar
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete?.(project) }}
          className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded hover:bg-zinc-800"
        >
          Excluir
        </button>
      </div>
    </div>
  )
}
