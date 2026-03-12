import { useDeferredValue, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ChatContextRail from '../components/chat/ChatContextRail'
import ChatThread from '../components/chat/ChatThread'
import ConversationList from '../components/chat/ConversationList'
import {
  getConversation,
  getConversationContext,
  getConversations,
  getReplySuggestion,
  markConversationRead,
  sendChatMessage,
} from '../api'
import { useMessageSocket } from '../hooks/useMessageSocket'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { isStandalonePWA } from '../lib/native'

function upsertConversation(list, nextConversation) {
  const filtered = list.filter((item) => item.contact_id !== nextConversation.contact_id)
  return [nextConversation, ...filtered]
}

function upsertMessage(list, nextMessage) {
  const exists = list.some((item) => item.id === nextMessage.id)
  if (exists) return list
  return [...list, nextMessage]
}

function mergeMessage(list, nextMessage) {
  const index = list.findIndex((item) => item.id === nextMessage.id)
  if (index === -1) {
    return upsertMessage(list, nextMessage)
  }

  const copy = [...list]
  copy[index] = { ...copy[index], ...nextMessage }
  return copy
}

function formatConversationTime(dateString) {
  if (!dateString) return ''

  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now - date
  const diffHours = Math.floor(diffMs / 3600000)

  if (diffHours < 1) return 'agora'
  if (diffHours < 24) return `${diffHours}h`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function getQuickReplies(context, suggestion) {
  const replies = [
    'Recebi aqui. Vou validar isso e te atualizo ainda hoje.',
    'Consegue me mandar um print rapido desse ponto para eu testar?',
    'Se isso estiver ok para voce, eu sigo para a proxima etapa.',
  ]

  if (context?.tasks?.length) {
    replies.unshift(`Estou fechando agora: ${context.tasks[0].title}.`)
  }

  if (suggestion) {
    replies.unshift(suggestion)
  }

  return replies.slice(0, 4)
}

export default function WhatsAppChat({ appMode = false }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [context, setContext] = useState(null)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingThread, setLoadingThread] = useState(false)
  const [loadingContext, setLoadingContext] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [suggestion, setSuggestion] = useState('')
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const selectedContactId = searchParams.get('contact') || ''
  const { permission, requestPermission, notify } = usePushNotifications()
  const installedApp = isStandalonePWA()

  function selectConversation(contactId) {
    if (!contactId) return
    setSearchParams({ contact: contactId }, { replace: true })
  }

  async function loadConversations() {
    setLoadingList(true)
    try {
      const data = await getConversations({
        search: deferredSearch,
        unread_only: unreadOnly,
      })
      setConversations(data)

      if (!selectedContactId && data[0]?.contact_id) {
        selectConversation(data[0].contact_id)
      }
    } finally {
      setLoadingList(false)
    }
  }

  async function loadActiveConversation(contactId) {
    if (!contactId) return

    setLoadingThread(true)
    setLoadingContext(true)
    try {
      const [conversationData, contextData] = await Promise.all([
        getConversation(contactId),
        getConversationContext(contactId),
      ])
      setMessages(conversationData)
      setContext({
        ...contextData,
        contact: { ...contextData.contact, unread_count: 0 },
      })
      setSuggestion('')
      await markConversationRead(contactId)
      setConversations((current) =>
        current.map((item) =>
          item.contact_id === contactId ? { ...item, unread_count: 0 } : item
        )
      )
    } finally {
      setLoadingThread(false)
      setLoadingContext(false)
    }
  }

  useEffect(() => {
    loadConversations().catch(() => {})
  }, [deferredSearch, unreadOnly])

  useEffect(() => {
    loadActiveConversation(selectedContactId).catch(() => {})
  }, [selectedContactId])

  useEffect(() => {
    function handleInstallPrompt(event) {
      event.preventDefault()
      setInstallPrompt(event)
    }

    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
  }, [])

  useEffect(() => {
    if (appMode && selectedContactId) {
      setShowSwitcher(false)
    }
  }, [appMode, selectedContactId])

  const socketStatus = useMessageSocket(selectedContactId, async (event) => {
    if (event.type === 'message.created') {
      const incomingConversation = {
        contact_id: event.contact_id,
        contact_name: event.contact.name,
        contact_phone: event.contact.phone,
        project_id: event.contact.project_id,
        project_name: event.contact.project_name || event.message.project_name,
        profile_pic_url: event.contact.profile_pic_url,
        pipeline_stage: event.contact.pipeline_stage,
        unread_count: event.contact.unread_count,
        last_message_preview: event.contact.last_message_preview,
        last_message_at: event.contact.last_message_at,
      }

      setConversations((current) => upsertConversation(current, incomingConversation))

      if (event.contact_id === selectedContactId) {
        setMessages((current) => upsertMessage(current, event.message))

        if (event.message.direction === 'incoming') {
          await markConversationRead(event.contact_id)
          setConversations((current) =>
            current.map((item) =>
              item.contact_id === event.contact_id ? { ...item, unread_count: 0 } : item
            )
          )
          setContext((current) =>
            current?.contact?.id === event.contact_id
              ? {
                  ...current,
                  contact: {
                    ...current.contact,
                    unread_count: 0,
                    last_message_preview: event.contact.last_message_preview,
                    last_message_at: event.contact.last_message_at,
                  },
                }
              : current
          )
        }
      }

      if (event.message.direction === 'incoming' && document.hidden) {
        notify({
          title: event.contact.name,
          body: event.message.content || `[${event.message.message_type}]`,
          data: { url: `/app/chat?contact=${event.contact_id}` },
        })
      }
    }

    if (event.type === 'message.updated' && event.contact_id === selectedContactId) {
      setMessages((current) => mergeMessage(current, event.message))
    }

    if (event.type === 'conversation.read') {
      setConversations((current) =>
        current.map((item) =>
          item.contact_id === event.contact_id ? { ...item, unread_count: 0 } : item
        )
      )
      setContext((current) =>
        current?.contact?.id === event.contact_id
          ? { ...current, contact: { ...current.contact, unread_count: 0 } }
          : current
      )
    }
  })

  const activeConversation = conversations.find((item) => item.contact_id === selectedContactId) || null
  const quickReplies = getQuickReplies(context, suggestion)

  async function handleSend() {
    if (!selectedContactId || !draft.trim()) return
    setSending(true)
    try {
      const sentMessage = await sendChatMessage({
        contact_id: selectedContactId,
        content: draft.trim(),
      })
      setDraft('')
      setMessages((current) => upsertMessage(current, sentMessage))
      setConversations((current) =>
        upsertConversation(current, {
          ...(activeConversation || {}),
          contact_id: selectedContactId,
          contact_name:
            activeConversation?.contact_name ||
            context?.contact?.name ||
            context?.contact?.push_name ||
            context?.contact?.phone,
          contact_phone: activeConversation?.contact_phone || context?.contact?.phone,
          profile_pic_url: activeConversation?.profile_pic_url || context?.contact?.profile_pic_url,
          pipeline_stage: activeConversation?.pipeline_stage || context?.contact?.pipeline_stage,
          project_name: activeConversation?.project_name || context?.project_name,
          unread_count: 0,
          last_message_preview: sentMessage.content,
          last_message_at: sentMessage.timestamp,
        })
      )
      setContext((current) =>
        current
          ? {
              ...current,
              contact: {
                ...current.contact,
                unread_count: 0,
                last_message_preview: sentMessage.content,
                last_message_at: sentMessage.timestamp,
              },
            }
          : current
      )
    } finally {
      setSending(false)
    }
  }

  async function handleGenerateSuggestion() {
    if (!selectedContactId) return
    const data = await getReplySuggestion(selectedContactId)
    setSuggestion(data.suggestion)
    setDraft((current) => current || data.suggestion)
  }

  async function handleInstallApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    setInstallPrompt(null)
  }

  const unreadTotal = conversations.reduce((total, item) => total + (item.unread_count || 0), 0)

  if (appMode) {
    return (
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#06080d]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(94,166,255,0.16),transparent_26%),radial-gradient(circle_at_top_right,rgba(139,212,80,0.12),transparent_20%),linear-gradient(180deg,#06080d_0%,#0a0d14_100%)]" />

        <header className="relative z-10 px-3 pt-3 sm:px-5 sm:pt-5">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 rounded-[28px] border border-white/10 bg-zinc-950/80 px-3 py-3 shadow-[0_20px_70px_rgba(0,0,0,0.35)] backdrop-blur">
            <button
              type="button"
              onClick={() => setShowSwitcher(true)}
              className="btn-secondary px-4 py-2.5 text-sm"
            >
              Conversas {unreadTotal > 0 ? `(${unreadTotal})` : ''}
            </button>

            <div className="min-w-0 flex-1">
              <p className="eyebrow">Chat direto</p>
              <h1 className="mt-2 truncate text-2xl font-semibold text-white">
                {activeConversation?.contact_name || 'Abrindo conversa'}
              </h1>
              <p className="mt-1 truncate text-sm text-zinc-500">
                {activeConversation?.project_name || activeConversation?.contact_phone || 'WhatsApp em tempo real'}
              </p>
            </div>

            {permission !== 'granted' && (
              <button
                type="button"
                onClick={requestPermission}
                className="btn-secondary px-4 py-2.5 text-sm"
              >
                Ativar alertas
              </button>
            )}

            <div className={`rounded-full px-3 py-2 text-xs font-medium ${socketStatus === 'open' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
              {socketStatus === 'open' ? 'online' : 'reconectando'}
            </div>
          </div>
        </header>

        <main className="relative z-10 flex-1 px-3 py-3 sm:px-5 sm:py-5">
          <div className="mx-auto flex h-[calc(100vh-6.9rem)] max-w-6xl flex-col">
            <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-3">
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">
                  {loadingList ? 'sincronizando inbox' : `${conversations.length} conversas`}
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">
                  {unreadTotal} nao lidas
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">
                  Midias com preview e download
                </span>
                {context?.project_name && (
                  <span className="truncate rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">
                    Projeto: {context.project_name}
                  </span>
                )}
              </div>

              <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-zinc-400">
                Atualizacao em tempo real e resposta na mesma tela
              </div>
            </div>

            <div className="min-h-0 flex-1">
              <ChatThread
                conversation={activeConversation}
                messages={messages}
                loading={loadingThread}
                draft={draft}
                onDraftChange={setDraft}
                onSend={handleSend}
                sending={sending}
                quickReplies={quickReplies}
                socketStatus={socketStatus}
                variant="app"
                showHeader={false}
              />
            </div>
          </div>
        </main>

        {showSwitcher && (
          <div className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm">
            <button
              type="button"
              aria-label="Fechar lista de conversas"
              onClick={() => setShowSwitcher(false)}
              className="absolute inset-0"
            />

            <div className="absolute inset-y-3 left-3 flex w-[min(380px,calc(100vw-1.5rem))] flex-col rounded-[30px] border border-white/10 bg-zinc-950/95 shadow-[0_24px_90px_rgba(0,0,0,0.45)]">
              <div className="border-b border-white/8 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="eyebrow">Trocar cliente</p>
                    <h2 className="mt-2 text-xl font-semibold text-white">Conversas</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSwitcher(false)}
                    className="btn-secondary px-3 py-2 text-xs"
                  >
                    Fechar
                  </button>
                </div>

                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar cliente, projeto ou trecho"
                  className="input mt-4"
                />

                <label className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={unreadOnly}
                    onChange={(event) => setUnreadOnly(event.target.checked)}
                    className="rounded border-white/15 bg-white/5"
                  />
                  Mostrar apenas nao lidas
                </label>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {loadingList && (
                  <div className="space-y-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="animate-pulse rounded-[24px] border border-white/6 bg-white/[0.03] p-4">
                        <div className="h-4 w-28 rounded bg-white/10" />
                        <div className="mt-3 h-3 w-3/4 rounded bg-white/5" />
                      </div>
                    ))}
                  </div>
                )}

                {!loadingList && conversations.length === 0 && (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-zinc-500">
                    Nenhuma conversa encontrada com os filtros atuais.
                  </div>
                )}

                {!loadingList && conversations.map((conversation) => {
                  const selected = conversation.contact_id === selectedContactId

                  return (
                    <button
                      key={conversation.contact_id}
                      type="button"
                      onClick={() => selectConversation(conversation.contact_id)}
                      className={`mb-3 w-full rounded-[24px] border px-4 py-4 text-left transition-colors ${selected ? 'border-lime-300/30 bg-lime-300/[0.08]' : 'border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-sm font-semibold text-white">
                          {(conversation.contact_name || '?').slice(0, 2).toUpperCase()}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white">{conversation.contact_name}</p>
                              <p className="truncate text-xs text-zinc-500">
                                {conversation.project_name || conversation.contact_phone}
                              </p>
                            </div>

                            <div className="flex flex-col items-end gap-2">
                              <span className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                                {formatConversationTime(conversation.last_message_at)}
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
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">WhatsApp PWA</p>
          <h1 className="mt-2 text-3xl font-bold text-white">Chat unico estilo operador</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Conversa central, contexto lateral e arquivos visiveis com download.
          </p>
        </div>

        {!installedApp && (
          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            {installPrompt ? (
              <button type="button" onClick={handleInstallApp} className="btn-primary">
                Instalar
              </button>
            ) : (
              <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
                Chrome/Edge &gt; Instalar Orquestra
              </div>
            )}
          </div>
        )}

        <div className="hidden items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-3 lg:flex">
          <div>
            <p className="metric-label">Nao lidas</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {unreadTotal}
            </p>
          </div>
          <div className="h-10 w-px bg-white/10" />
          <div>
            <p className="metric-label">PWA</p>
            <p className="mt-1 text-lg font-semibold text-white">{permission === 'granted' ? 'ON' : 'OFF'}</p>
          </div>
          {!installedApp && (
            <>
              <div className="h-10 w-px bg-white/10" />
              <div className="min-w-[180px]">
                <p className="metric-label">Instalacao</p>
                {installPrompt ? (
                  <button type="button" onClick={handleInstallApp} className="btn-primary mt-2 px-4 py-2 text-sm">
                    Instalar app
                  </button>
                ) : (
                  <p className="mt-1 text-sm text-zinc-400">
                    No Chrome/Edge: menu do navegador &gt; `Instalar Orquestra`
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="grid h-[calc(100vh-15rem)] gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px] overflow-hidden">
        <ConversationList
          conversations={conversations}
          loading={loadingList}
          search={search}
          onSearchChange={setSearch}
          unreadOnly={unreadOnly}
          onUnreadToggle={setUnreadOnly}
          selectedContactId={selectedContactId}
          onSelect={selectConversation}
        />

        <ChatThread
          conversation={activeConversation}
          messages={messages}
          loading={loadingThread}
          draft={draft}
          onDraftChange={setDraft}
          onSend={handleSend}
          sending={sending}
          quickReplies={quickReplies}
          socketStatus={socketStatus}
        />

        <ChatContextRail
          context={context}
          loading={loadingContext}
          suggestion={suggestion}
          onGenerateSuggestion={handleGenerateSuggestion}
          notificationsEnabled={permission === 'granted'}
          onEnableNotifications={requestPermission}
          onInstallApp={installPrompt ? handleInstallApp : null}
        />
      </section>
    </div>
  )
}
