function formatTime(dateString) {
  if (!dateString) return '--:--'
  return new Date(dateString).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
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
}) {
  return (
    <section className="surface-panel flex min-h-[72vh] flex-col overflow-hidden">
      <div className="border-b border-white/8 px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Thread ativa</p>
            <h3 className="mt-2 text-xl font-semibold text-white">
              {conversation?.contact_name || 'Selecione uma conversa'}
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              {conversation?.project_name || conversation?.contact_phone || 'WhatsApp em tempo real'}
            </p>
          </div>

          <div className={`rounded-full px-3 py-1 text-xs font-medium ${socketStatus === 'open' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {socketStatus === 'open' ? 'realtime online' : 'reconectando'}
          </div>
        </div>
      </div>

      <div className="chat-shell flex-1">
        {!conversation && (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Escolha um cliente na coluna da esquerda para abrir o chat.
          </div>
        )}

        {conversation && loading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-16 w-3/4 animate-pulse rounded-[24px] bg-white/5" />
            ))}
          </div>
        )}

        {conversation && !loading && messages.map((message) => {
          const outgoing = message.direction === 'outgoing'

          return (
            <div key={message.id} className={`chat-bubble ${outgoing ? 'chat-user' : 'chat-assistant'} animate-fade-in`}>
              <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-100">
                {message.content || message.transcription || `[${message.message_type}]`}
              </p>
              <p className="mt-2 text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                {outgoing ? 'Diego' : 'Cliente'} · {formatTime(message.timestamp)}
              </p>
            </div>
          )
        })}
      </div>

      <div className="border-t border-white/8 p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {quickReplies.map((reply) => (
            <button
              key={reply}
              type="button"
              onClick={() => onDraftChange(reply)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10"
            >
              {reply}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row">
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={4}
            placeholder="Responder no WhatsApp..."
            className="input min-h-[110px] resize-none"
            disabled={!conversation || sending}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!conversation || !draft.trim() || sending}
            className="btn-primary min-w-[140px] self-end"
          >
            {sending ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </section>
  )
}
