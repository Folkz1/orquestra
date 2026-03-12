import MessageAttachment from './MessageAttachment'

function formatStamp(dateString) {
  if (!dateString) return '--:--'
  return new Date(dateString).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
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
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(7,10,15,0.98),rgba(11,14,19,0.98))]">
      <div className="flex items-center justify-between gap-4 border-b border-white/8 px-5 py-4">
        <div className="min-w-0">
          <p className="eyebrow">Workspace ativo</p>
          <h2 className="mt-2 truncate text-2xl font-semibold text-white">
            {conversation?.contact_name || 'Chat Orquestra'}
          </h2>
          <p className="mt-1 truncate text-sm text-zinc-500">
            {conversation?.project_name || conversation?.contact_phone || 'Selecione uma conversa no sidebar'}
          </p>
        </div>

        <div className={`rounded-full px-3 py-1 text-xs font-medium ${socketStatus === 'open' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
          {socketStatus === 'open' ? 'online' : 'reconectando'}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {!conversation && (
          <div className="flex h-full items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-white/[0.03] text-sm text-zinc-500">
            Abra uma conversa para ver o historico, as transcricoes e os arquivos.
          </div>
        )}

        {conversation && loading && (
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-[24px] bg-white/[0.04]" />
            ))}
          </div>
        )}

        {conversation && !loading && (
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {messages.map((message) => {
              const outgoing = message.direction === 'outgoing'

              return (
                <article
                  key={message.id}
                  className={`rounded-[26px] border px-4 py-4 sm:px-5 ${outgoing ? 'border-lime-300/15 bg-lime-300/[0.05]' : 'border-white/10 bg-white/[0.03]'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {outgoing ? 'Diego' : conversation.contact_name}
                      </p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                        {message.message_type}
                      </p>
                    </div>
                    <p className="text-xs text-zinc-500">{formatStamp(message.timestamp)}</p>
                  </div>

                  {message.content && (
                    <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-zinc-100">
                      {message.content}
                    </p>
                  )}

                  {hasAttachment(message) && (
                    <MessageAttachment message={message} outgoing={outgoing} />
                  )}

                  {!message.content && !hasAttachment(message) && message.transcription && (
                    <div className="mt-4 rounded-[22px] border border-white/10 bg-black/20 p-4">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                        Conteudo processado
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
                        {message.transcription}
                      </p>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>

      <div className="border-t border-white/8 bg-black/20 px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-4xl">
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

          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-3">
            <div className="flex flex-col gap-3">
              <textarea
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                rows={4}
                placeholder="Responder no WhatsApp com contexto do projeto..."
                className="min-h-[120px] w-full resize-none border-0 bg-transparent px-2 py-2 text-sm leading-7 text-zinc-100 placeholder-zinc-500 outline-none"
                disabled={!conversation || sending}
              />

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">
                  Audio, imagem e documento ficam visiveis com descricao e download.
                </p>
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!conversation || !draft.trim() || sending}
                  className="btn-primary min-w-[140px]"
                >
                  {sending ? 'Enviando...' : 'Enviar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
