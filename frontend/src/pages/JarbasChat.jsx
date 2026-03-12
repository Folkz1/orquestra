import { useEffect, useMemo, useRef, useState } from 'react'
import { streamJarbasChat } from '../lib/jarbas-stream'
import { hapticSuccess, hapticTap } from '../lib/haptics'

const QUICK_ACTIONS = [
  'Resumo do dia',
  'Clientes urgentes',
  'Proximas tasks prioritarias',
  'Projetos em risco',
]

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `jarbas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function ensureSessionId() {
  const key = 'orquestra_jarbas_session'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const next = createId()
  localStorage.setItem(key, next)
  return next
}

function ToolIndicator({ tool }) {
  return (
    <div className={`rounded-full border px-2.5 py-1 text-[11px] ${
      tool.status === 'done'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    }`}>
      {tool.status === 'done' ? 'Tool finalizada' : 'Tool em execucao'} · {tool.name}
    </div>
  )
}

export default function JarbasChat() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)
  const sessionId = useMemo(() => ensureSessionId(), [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streaming])

  function updateAssistantMessage(assistantId, updater) {
    setMessages((current) =>
      current.map((message) => (message.id === assistantId ? updater(message) : message))
    )
  }

  async function sendMessage(text) {
    const content = text.trim()
    if (!content || streaming) return

    const userId = createId()
    const assistantId = createId()
    const outgoingMessages = [{ role: 'user', content }]

    setError('')
    setInput('')
    setStreaming(true)
    await hapticTap()

    setMessages((current) => [
      ...current,
      { id: userId, role: 'user', content },
      { id: assistantId, role: 'assistant', content: '', tools: [], pending: true },
    ])

    try {
      await streamJarbasChat({
        messages: outgoingMessages,
        sessionId,
        handlers: {
          onTextDelta: (delta) => {
            const chunk = typeof delta === 'string' ? delta : delta?.text || ''
            if (!chunk) return

            updateAssistantMessage(assistantId, (message) => ({
              ...message,
              content: `${message.content}${chunk}`,
            }))
          },
          onToolStart: async (toolEvent) => {
            const toolName = toolEvent?.toolName || toolEvent?.tool_name || 'tool'
            await hapticTap()
            updateAssistantMessage(assistantId, (message) => ({
              ...message,
              tools: [...(message.tools || []), { id: toolEvent?.toolCallId || createId(), name: toolName, status: 'running' }],
            }))
          },
          onToolFinish: async (toolEvent) => {
            await hapticSuccess()
            updateAssistantMessage(assistantId, (message) => ({
              ...message,
              tools: (message.tools || []).map((tool) =>
                tool.id === toolEvent?.toolCallId ? { ...tool, status: 'done' } : tool
              ),
            }))
          },
          onError: (nextError) => {
            setError(typeof nextError === 'string' ? nextError : 'Falha ao conversar com Jarbas.')
          },
        },
      })
    } catch (streamError) {
      setError(streamError.message || 'Falha ao conversar com Jarbas.')
      updateAssistantMessage(assistantId, (message) => ({
        ...message,
        content: message.content || 'Nao consegui completar essa resposta agora.',
      }))
    } finally {
      updateAssistantMessage(assistantId, (message) => ({
        ...message,
        pending: false,
      }))
      setStreaming(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="surface-panel overflow-hidden">
        <div className="surface-gradient p-5 sm:p-6">
          <p className="eyebrow">Chat operacional</p>
          <h1 className="mt-2 text-2xl font-bold text-white">Jarbas</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-300">
            Streaming em tempo real com tools visiveis, atalhos de prompt e feedback tatil no app nativo.
          </p>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => sendMessage(action)}
            className="rounded-full border border-white/8 bg-white/4 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-white/16 hover:text-white"
          >
            {action}
          </button>
        ))}
      </div>

      <section className="surface-panel p-3 sm:p-4">
        <div ref={scrollRef} className="chat-shell">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-500">
              Jarbas fica melhor com contexto direto. Use um dos chips acima ou mande sua pergunta.
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`chat-bubble ${message.role === 'user' ? 'chat-user' : 'chat-assistant'}`}
            >
              <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                <span>{message.role === 'user' ? 'Diego' : 'Jarbas'}</span>
                {message.pending && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-100">
                {message.content || (message.pending ? 'Pensando...' : 'Sem resposta textual.')}
              </p>
              {message.tools?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.tools.map((tool) => (
                    <ToolIndicator key={tool.id} tool={tool} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-3xl border border-white/8 bg-black/20 p-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Pergunte algo operacional para Jarbas..."
            className="min-h-[96px] w-full resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                sendMessage(input)
              }
            }}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              {streaming ? 'Streaming ativo...' : 'Enter envia · Shift+Enter quebra linha'}
            </p>
            <button type="button" onClick={() => sendMessage(input)} disabled={streaming} className="btn-primary">
              {streaming ? 'Respondendo...' : 'Enviar'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </section>
    </div>
  )
}
