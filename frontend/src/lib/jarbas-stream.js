import { API_BASE_URL, getAuthToken } from '../api'

function safeParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function handleProtocolLine(line, handlers) {
  const trimmed = line.trim()
  if (!trimmed) return

  const normalized = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
  const separatorIndex = normalized.indexOf(':')

  if (separatorIndex === -1) return

  const code = normalized.slice(0, separatorIndex)
  const payload = normalized.slice(separatorIndex + 1)

  if (code === '0') {
    handlers.onTextDelta?.(safeParse(payload))
    return
  }

  if (code === '9') {
    handlers.onToolStart?.(safeParse(payload))
    return
  }

  if (code === 'a') {
    handlers.onToolFinish?.(safeParse(payload))
    return
  }

  if (code === '3') {
    const error = safeParse(payload)
    handlers.onError?.(error?.message || String(error))
    return
  }

  if (code === 'd' || code === 'e') {
    handlers.onDone?.(safeParse(payload))
  }
}

export async function streamJarbasChat({ messages, sessionId, handlers }) {
  const response = await fetch(`${API_BASE_URL}/api/assistant/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify({
      messages,
      session_id: sessionId,
    }),
  })

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Falha ao iniciar stream (${response.status})`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    lines.forEach((line) => handleProtocolLine(line, handlers))
  }

  if (buffer.trim()) {
    handleProtocolLine(buffer, handlers)
  }
}
