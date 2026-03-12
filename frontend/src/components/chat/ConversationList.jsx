function formatRelative(dateString) {
  if (!dateString) return ''
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now - date
  const diffHours = Math.floor(diffMs / 3600000)

  if (diffHours < 1) return 'agora'
  if (diffHours < 24) return `${diffHours}h`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export default function ConversationList({
  conversations,
  loading,
  search,
  onSearchChange,
  unreadOnly,
  onUnreadToggle,
  selectedContactId,
  onSelect,
}) {
  return (
    <section className="surface-panel overflow-hidden">
      <div className="border-b border-white/8 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Inbox</p>
            <h3 className="mt-2 text-xl font-semibold text-white">WhatsApp</h3>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => onUnreadToggle(event.target.checked)}
              className="rounded border-white/15 bg-white/5"
            />
            Nao lidas
          </label>
        </div>

        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar cliente, projeto ou trecho"
          className="input mt-4"
        />
      </div>

      <div className="max-h-[72vh] overflow-y-auto">
        {loading && (
          <div className="space-y-3 p-4">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="animate-pulse rounded-[24px] border border-white/6 bg-white/[0.03] p-4">
                <div className="h-4 w-28 rounded bg-white/10" />
                <div className="mt-3 h-3 w-3/4 rounded bg-white/5" />
              </div>
            ))}
          </div>
        )}

        {!loading && conversations.length === 0 && (
          <div className="p-6 text-sm text-zinc-500">
            Nenhuma conversa encontrada com os filtros atuais.
          </div>
        )}

        {!loading && conversations.map((conversation) => {
          const selected = conversation.contact_id === selectedContactId

          return (
            <button
              key={conversation.contact_id}
              type="button"
              onClick={() => onSelect(conversation.contact_id)}
              className={`w-full border-b border-white/6 px-4 py-4 text-left transition-colors hover:bg-white/[0.04] ${selected ? 'bg-white/[0.06]' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-sm font-semibold text-white">
                  {(conversation.contact_name || '?').slice(0, 2).toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{conversation.contact_name}</p>
                      <p className="truncate text-xs text-zinc-500">{conversation.project_name || conversation.contact_phone}</p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <span className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                        {formatRelative(conversation.last_message_at)}
                      </span>
                      {conversation.unread_count > 0 && (
                        <span className="inline-flex min-w-6 justify-center rounded-full bg-lime-300 px-2 py-0.5 text-[11px] font-semibold text-zinc-950">
                          {conversation.unread_count}
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="mt-2 truncate text-sm text-zinc-400">
                    {conversation.last_message_preview || 'Sem preview ainda.'}
                  </p>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
