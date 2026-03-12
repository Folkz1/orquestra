import { useEffect, useRef, useState } from 'react'
import { API_BASE_URL, getAuthToken } from '../api'

function buildSocketUrl(contactId) {
  const origin = API_BASE_URL || window.location.origin
  const url = new URL('/api/realtime/ws/messages', origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  const token = getAuthToken()
  if (token) {
    url.searchParams.set('token', token)
  }

  if (contactId) {
    url.searchParams.set('contact_id', contactId)
  }

  return url.toString()
}

export function useMessageSocket(contactId, onEvent) {
  const callbackRef = useRef(onEvent)
  const reconnectRef = useRef()
  const [status, setStatus] = useState('connecting')

  useEffect(() => {
    callbackRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    let closed = false
    let socket
    let pingTimer

    const connect = () => {
      setStatus('connecting')
      socket = new WebSocket(buildSocketUrl(contactId))

      socket.onopen = () => {
        setStatus('open')
        pingTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }))
          }
        }, 25000)
      }

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          callbackRef.current?.(payload)
        } catch {}
      }

      socket.onerror = () => {
        setStatus('error')
      }

      socket.onclose = () => {
        window.clearInterval(pingTimer)
        if (closed) return
        setStatus('closed')
        reconnectRef.current = window.setTimeout(connect, 2000)
      }
    }

    connect()

    return () => {
      closed = true
      window.clearTimeout(reconnectRef.current)
      window.clearInterval(pingTimer)
      socket?.close()
    }
  }, [contactId])

  return status
}
