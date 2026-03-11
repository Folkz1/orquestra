import { useState } from 'react'

function getTypeIcon(type) {
  switch (type) {
    case 'audio': return '🎵'
    case 'image': return '🖼️'
    case 'video': return '🎬'
    case 'document': return '📄'
    case 'sticker': return '🏷️'
    default: return '💬'
  }
}

function getTypeBadge(type) {
  switch (type) {
    case 'audio': return 'bg-blue-500/20 text-blue-400'
    case 'image': return 'bg-yellow-500/20 text-yellow-400'
    case 'video': return 'bg-purple-500/20 text-purple-400'
    case 'document': return 'bg-orange-500/20 text-orange-400'
    case 'sticker': return 'bg-pink-500/20 text-pink-400'
    default: return 'bg-zinc-700/50 text-zinc-400'
  }
}

function formatDuration(seconds) {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
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
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatTimestamp(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

function ConversationBubble({ message }) {
  const [showTranscription, setShowTranscription] = useState(false)
  const isOutgoing = message.direction === 'outgoing'
  const type = message.message_type || message.type || 'text'
  const content = message.content || message.body || ''
  const transcription = message.transcription || ''
  const hasTranscription = transcription && transcription !== content
  const isMedia = ['audio', 'image', 'video', 'document'].includes(type)

  return (
    <div className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} mb-2`}>
      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
        isOutgoing
          ? 'bg-primary/20 border border-primary/20 rounded-br-md'
          : 'bg-zinc-800 border border-zinc-700/50 rounded-bl-md'
      }`}>
        {/* Media type indicator */}
        {isMedia && (
          <div className={`flex items-center gap-1.5 mb-1 text-xs ${
            isOutgoing ? 'text-primary/70' : 'text-zinc-500'
          }`}>
            <span>{getTypeIcon(type)}</span>
            <span className="capitalize">{type}</span>
            {message.media_duration_seconds > 0 && (
              <span className="text-zinc-600">({formatDuration(message.media_duration_seconds)})</span>
            )}
            {message.media_mimetype && (
              <span className="text-zinc-700 text-[10px]">{message.media_mimetype.split('/').pop()}</span>
            )}
          </div>
        )}

        {/* Content */}
        {content && (
          <p className={`text-sm leading-relaxed ${
            isOutgoing ? 'text-zinc-200' : 'text-zinc-300'
          }`}>
            {content}
          </p>
        )}

        {/* No content but has transcription */}
        {!content && hasTranscription && !showTranscription && (
          <p className="text-sm text-zinc-500 italic">
            {type === 'audio' ? 'Áudio transcrito' : type === 'document' ? 'Documento processado' : 'Mídia processada'}
          </p>
        )}

        {/* Transcription toggle */}
        {hasTranscription && (
          <div className="mt-1.5">
            <button
              onClick={() => setShowTranscription(!showTranscription)}
              className={`text-[11px] font-medium transition-colors ${
                showTranscription
                  ? 'text-primary/70 hover:text-primary'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {showTranscription ? '▼ Ocultar transcrição' : '▶ Ver transcrição'}
            </button>
            {showTranscription && (
              <div className="mt-1.5 p-2 rounded-lg bg-zinc-900/50 border border-zinc-700/30">
                <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">
                  {transcription}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div className={`text-[10px] mt-1 ${isOutgoing ? 'text-primary/40 text-right' : 'text-zinc-600'}`}>
          {formatTimestamp(message.timestamp || message.created_at)}
        </div>
      </div>
    </div>
  )
}

function MessageCard({ message }) {
  const [expanded, setExpanded] = useState(false)
  const [showTranscription, setShowTranscription] = useState(false)

  const contactName = message.contact_name || message.contact_phone || 'Desconhecido'
  const initial = contactName.charAt(0).toUpperCase()
  const type = message.message_type || message.type || 'text'
  const content = message.content || message.body || ''
  const transcription = message.transcription || ''
  const hasTranscription = transcription && transcription !== content
  const isMedia = ['audio', 'image', 'video', 'document'].includes(type)
  const preview = content.length > 120 ? content.substring(0, 120) + '...' : content
  const hasMore = content.length > 120
  const isOutgoing = message.direction === 'outgoing'

  return (
    <div
      className="card animate-fade-in cursor-pointer hover:border-zinc-600 transition-colors"
      onClick={() => hasMore && setExpanded(!expanded)}
    >
      <div className="flex gap-3">
        {/* Avatar */}
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-medium ${
          isOutgoing ? 'bg-primary/10 text-primary' : 'bg-zinc-800 text-zinc-300'
        }`}>
          {isOutgoing ? '→' : initial}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm text-zinc-100 truncate">
              {isOutgoing ? `→ ${contactName}` : contactName}
            </span>
            <span className="text-xs text-zinc-500 flex-shrink-0">
              {timeAgo(message.timestamp || message.created_at)}
            </span>
          </div>

          {/* Media indicator */}
          {isMedia && (
            <div className="flex items-center gap-1.5 mb-1 text-xs text-zinc-500">
              <span>{getTypeIcon(type)}</span>
              <span className="capitalize">{type}</span>
              {message.media_duration_seconds > 0 && (
                <span className="text-zinc-600">({formatDuration(message.media_duration_seconds)})</span>
              )}
            </div>
          )}

          <p className="text-sm text-zinc-400 leading-relaxed">
            {!isMedia && <span className="mr-1">{getTypeIcon(type)}</span>}
            {expanded ? content : (preview || (hasTranscription ? 'Ver transcrição ▶' : '(sem conteúdo)'))}
          </p>

          {/* Transcription */}
          {hasTranscription && (
            <div className="mt-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); setShowTranscription(!showTranscription) }}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 font-medium transition-colors"
              >
                {showTranscription ? '▼ Ocultar transcrição' : '▶ Transcrição disponível'}
              </button>
              {showTranscription && (
                <div className="mt-1 p-2 rounded-lg bg-zinc-900/50 border border-zinc-700/30">
                  <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">
                    {transcription}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Badges */}
          <div className="flex gap-2 mt-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${getTypeBadge(type)}`}>
              {type || 'text'}
            </span>
            {isOutgoing && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/70">
                enviado
              </span>
            )}
            {message.project_name && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                {message.project_name}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MessageList({ messages, showAsConversation = false }) {
  if (!messages || messages.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <p className="text-4xl mb-3">📭</p>
        <p>Nenhuma mensagem encontrada</p>
      </div>
    )
  }

  // Stats
  const audioCount = messages.filter(m => (m.message_type || m.type) === 'audio').length
  const imageCount = messages.filter(m => (m.message_type || m.type) === 'image').length
  const docCount = messages.filter(m => (m.message_type || m.type) === 'document').length
  const videoCount = messages.filter(m => (m.message_type || m.type) === 'video').length
  const hasMediaStats = audioCount + imageCount + docCount + videoCount > 0

  if (showAsConversation) {
    return (
      <div>
        {/* Media stats bar */}
        {hasMediaStats && (
          <div className="flex gap-3 mb-3 text-xs text-zinc-500">
            {audioCount > 0 && <span>🎵 {audioCount} áudios</span>}
            {imageCount > 0 && <span>🖼️ {imageCount} imagens</span>}
            {docCount > 0 && <span>📄 {docCount} docs</span>}
            {videoCount > 0 && <span>🎬 {videoCount} vídeos</span>}
          </div>
        )}
        <div className="space-y-1">
          {messages.map((msg, idx) => (
            <ConversationBubble key={msg.id || idx} message={msg} />
          ))}
        </div>
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
