import { useState } from 'react'

function getTypeIcon(type) {
  switch (type) {
    case 'audio': return '🎵'
    case 'image': return '🖼️'
    default: return '💬'
  }
}

function getTypeBadge(type) {
  switch (type) {
    case 'audio': return 'badge-blue'
    case 'image': return 'badge-yellow'
    default: return 'badge-zinc'
  }
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now - date) / 1000)

  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function MessageCard({ message }) {
  const [expanded, setExpanded] = useState(false)

  const contactName = message.contact_name || message.contact_phone || 'Desconhecido'
  const initial = contactName.charAt(0).toUpperCase()
  const content = message.transcription || message.content || message.body || ''
  const preview = content.length > 120 ? content.substring(0, 120) + '...' : content
  const hasMore = content.length > 120

  return (
    <div
      className="card animate-fade-in cursor-pointer hover:border-zinc-700 transition-colors"
      onClick={() => hasMore && setExpanded(!expanded)}
    >
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0 text-sm font-medium text-zinc-300">
          {initial}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm text-zinc-100 truncate">
              {contactName}
            </span>
            <span className="text-xs text-zinc-500 flex-shrink-0">
              {timeAgo(message.timestamp || message.created_at)}
            </span>
          </div>

          <p className="text-sm text-zinc-400 leading-relaxed">
            <span className="mr-1">{getTypeIcon(message.type)}</span>
            {expanded ? content : preview}
          </p>

          {/* Badges */}
          <div className="flex gap-2 mt-2">
            <span className={getTypeBadge(message.type)}>
              {message.type || 'text'}
            </span>
            {message.project_name && (
              <span className="badge-green">{message.project_name}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MessageList({ messages }) {
  if (!messages || messages.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <p className="text-4xl mb-3">📭</p>
        <p>Nenhuma mensagem encontrada</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {messages.map((msg, idx) => (
        <MessageCard key={msg.id || idx} message={msg} />
      ))}
    </div>
  )
}
