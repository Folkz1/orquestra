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

export default function WhatsAppChat() {
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
  const selectedContactId = searchParams.get('contact') || ''
  const { permission, requestPermission, notify } = usePushNotifications()

  async function loadConversations() {
    setLoadingList(true)
    try {
      const data = await getConversations({
        search: deferredSearch,
        unread_only: unreadOnly,
      })
      setConversations(data)

      if (!selectedContactId && data[0]?.contact_id) {
        setSearchParams({ contact: data[0].contact_id })
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
              ? { ...current, contact: { ...current.contact, unread_count: 0, last_message_preview: event.contact.last_message_preview, last_message_at: event.contact.last_message_at } }
              : current
          )
        }
      }

      if (event.message.direction === 'incoming' && document.hidden) {
        notify({
          title: event.contact.name,
          body: event.message.content || `[${event.message.message_type}]`,
          data: { url: `/chat?contact=${event.contact_id}` },
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
          contact_name: activeConversation?.contact_name || context?.contact?.name || context?.contact?.push_name || context?.contact?.phone,
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

        <div className="hidden items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-3 lg:flex">
          <div>
            <p className="metric-label">Nao lidas</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {conversations.reduce((total, item) => total + (item.unread_count || 0), 0)}
            </p>
          </div>
          <div className="h-10 w-px bg-white/10" />
          <div>
            <p className="metric-label">PWA</p>
            <p className="mt-1 text-lg font-semibold text-white">{permission === 'granted' ? 'ON' : 'OFF'}</p>
          </div>
        </div>
      </section>

      <section className="grid min-h-[calc(100vh-15rem)] gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <ConversationList
          conversations={conversations}
          loading={loadingList}
          search={search}
          onSearchChange={setSearch}
          unreadOnly={unreadOnly}
          onUnreadToggle={setUnreadOnly}
          selectedContactId={selectedContactId}
          onSelect={(contactId) => setSearchParams({ contact: contactId })}
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
