import { useEffect, useRef, useCallback } from 'react'
import MessageAttachment from './MessageAttachment'

function formatStamp(dateString) {
  if (!dateString) return '--:--'
  return new Date(dateString).toLocaleString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDayLabel(dateString) {
  if (!dateString) return ''

  const date = new Date(dateString)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Hoje'
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem'

  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
  })
}

function hasAttachment(message) {
  return ['audio', 'image', 'video', 'document'].includes(message.message_type) && message.media_local_path
}

export default function ChatThread({
  conversation,
  messages,
  loading,
  draft,
  onDraftChange,
  onSend,
  sending,
  quickReplies,
  socketStatus,
  variant = 'workspace',
  showHeader = true,
}) {
  const appVariant = variant === 'app'
  const scrollRef = useRef(null)
  const textareaRef = useRef(null)
  const wasAtBottomRef = useRef(true)

  const shellClass = appVariant
    ? 'rounded-[34px] border-white/12 bg-[radial-gradient(circle_at_top,rgba(94,166,255,0.12),transparent_22%),linear-gradient(180deg,rgba(7,10,15,0.98),rgba(10,13,18,0.98))] shadow-[0_30px_100px_rgba(0,0,0,0.42)]'
    : 'rounded-[30px] border-white/10 bg-[linear-gradient(180deg,rgba(7,10,15,0.98),rgba(11,14,19,0.98))]'
  const maxWidthClass = appVariant ? 'max-w-5xl' : 'max-w-4xl'
  const emptyStateText = appVariant
    ? 'Escolha uma conversa para abrir o chat direto com o cliente.'
    : 'Abra uma conversa para ver o historico, as transcricoes e os arquivos.'

  // Auto-scroll to bottom when messages change (only if user was already at bottom)
  const scrollToBottom = useCallback((force = false) => {
    const el = scrollRef.current
    if (!el) return
    if (force || wasAtBottomRef.current) {
      // Double rAF ensures layout is fully computed before scrolling
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          }
        })
      })
    }
  }, [])

  // Track if user is near bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const threshold = 120
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }, [])

  // Scroll to bottom on conversation change or initial load
  useEffect(() => {
    if (!loading && messages.length > 0) {
      scrollToBottom(true)
    }
  }, [loading, conversation?.contact_id])

  // Scroll to bottom on new messages (if already at bottom)
  useEffect(() => {
    scrollToBottom()
  }, [messages.length])

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }, [])

  useEffect(() => {
    autoResize()
  }, [draft])

  // Enter to send, Shift+Enter for newline
  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSend()
    }
  }

  return (
    <section className={`flex min-h-0 flex-1 flex-col overflow-hidden border ${shellClass} h-full`}>
      {showHeader && (
        <div className="flex items-center justify-between gap-4 border-b border-white/8 px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-white">
              {conversation?.contact_name || 'Chat Orquestra'}
            </h2>
            <p className="truncate text-xs text-zinc-500">
              {conversation?.project_name || conversation?.contact_phone || 'Selecione uma conversa'}
            </p>
          </div>

          <div className={`rounded-full px-3 py-1 text-xs font-medium ${socketStatus === 'open' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {socketStatus === 'open' ? 'online' : 'reconectando'}
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`min-h-0 flex-1 overflow-y-auto ${appVariant ? 'px-3 py-4 sm:px-4' : 'px-4 py-4 sm:px-6'}`}
      >
        {!conversation && (
          <div className="flex h-full items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-white/[0.03] text-sm text-zinc-500">
            {emptyStateText}
          </div>
        )}

        {conversation && loading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-2xl bg-white/[0.04]" />
            ))}
          </div>
        )}

        {conversation && !loading && (
          <div className={`mx-auto flex ${maxWidthClass} flex-col gap-2`}>
            {messages.map((message, index) => {
              const outgoing = message.direction === 'outgoing'
              const previousMessage = messages[index - 1]
              const showDayDivider =
                !previousMessage ||
                new Date(previousMessage.timestamp).toDateString() !==
                  new Date(message.timestamp).toDateString()
              const sameSender = previousMessage && previousMessage.direction === message.direction
              const bubbleClass = outgoing
                ? appVariant
                  ? 'border-lime-300/18 bg-lime-300/[0.10]'
                  : 'border-lime-300/15 bg-lime-300/[0.05]'
                : appVariant
                  ? 'border-white/12 bg-white/[0.04]'
                  : 'border-white/10 bg-white/[0.03]'

              return (
                <div key={message.id}>
                  {showDayDivider && (
                    <div className={`${index > 0 ? 'mt-3' : ''} mb-2 flex justify-center`}>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-0.5 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        {formatDayLabel(message.timestamp)}
                      </span>
                    </div>
                  )}

                  <div className={`flex ${outgoing ? 'justify-end' : 'justify-start'} ${sameSender && !showDayDivider ? '' : 'mt-1'}`}>
                    <article
                      className={`max-w-[80%] rounded-2xl border px-3 py-2 ${bubbleClass}`}
                    >
                      {(!sameSender || showDayDivider) && (
                        <div className="mb-1 flex items-center gap-2">
                          <p className="text-xs font-semibold text-white">
                            {outgoing ? 'Diego' : conversation.contact_name}
                          </p>
                          {message.message_type !== 'text' && (
                            <span className="text-[10px] text-zinc-500">{message.message_type}</span>
                          )}
                        </div>
                      )}

                      {message.content && (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-100">
                          {message.content}
                        </p>
                      )}

                      {hasAttachment(message) && (
                        <MessageAttachment message={message} outgoing={outgoing} />
                      )}

                      {!message.content && !hasAttachment(message) && message.transcription && (
                        <div className="rounded-xl border border-white/10 bg-black/20 p-2.5">
                          <p className="text-[10px] text-zinc-500 mb-1">Transcrito</p>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                            {message.transcription}
                          </p>
                        </div>
                      )}

                      <p className={`text-[10px] text-zinc-600 ${message.content || hasAttachment(message) ? 'mt-1' : ''} text-right`}>
                        {formatStamp(message.timestamp)}
                      </p>
                    </article>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className={`border-t border-white/8 ${appVariant ? 'bg-black/30 px-3 py-2 sm:px-4' : 'bg-black/20 px-4 py-2.5 sm:px-6'}`}>
        <div className={`mx-auto ${maxWidthClass}`}>
          {quickReplies.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {quickReplies.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  onClick={() => onDraftChange(reply)}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10 truncate max-w-[220px]"
                >
                  {reply}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Digite uma mensagem..."
              className="min-h-[40px] max-h-[140px] flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm leading-relaxed text-zinc-100 placeholder-zinc-500 outline-none focus:border-white/20 transition-colors"
              disabled={!conversation || sending}
            />
            <button
              type="button"
              onClick={onSend}
              disabled={!conversation || !draft.trim() || sending}
              className="btn-primary flex-shrink-0 rounded-2xl px-5 py-2.5 text-sm"
            >
              {sending ? '...' : 'Enviar'}
            </button>
          </div>

          <p className="mt-1 text-[10px] text-zinc-600 px-1">
            Enter envia · Shift+Enter nova linha
          </p>
        </div>
      </div>
    </section>
  )
}
