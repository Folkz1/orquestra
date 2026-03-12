import { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, getAuthToken } from '../../api'

function buildMediaUrl(messageId, download = false) {
  const base = API_BASE_URL || ''
  return `${base}/api/messages/${messageId}/media${download ? '?download=true' : ''}`
}

function buildFilename(message) {
  const extension = (message.media_mimetype || '').split('/').pop() || 'bin'
  return `${message.message_type || 'media'}-${message.id}.${extension}`
}

function formatDuration(seconds) {
  if (!seconds) return ''
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${minutes}:${String(remaining).padStart(2, '0')}`
}

function useProtectedMedia(message) {
  const [objectUrl, setObjectUrl] = useState('')

  useEffect(() => {
    let active = true
    let currentUrl = ''

    async function load() {
      if (!message?.id || !message?.media_local_path) {
        setObjectUrl('')
        return
      }

      try {
        const response = await fetch(buildMediaUrl(message.id), {
          headers: {
            Authorization: `Bearer ${getAuthToken()}`,
          },
        })

        if (!response.ok) {
          throw new Error(`media-${response.status}`)
        }

        const blob = await response.blob()
        currentUrl = URL.createObjectURL(blob)
        if (active) {
          setObjectUrl(currentUrl)
        }
      } catch {
        if (active) {
          setObjectUrl('')
        }
      }
    }

    load()

    return () => {
      active = false
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
    }
  }, [message?.id, message?.media_local_path])

  return objectUrl
}

export default function MessageAttachment({ message, outgoing }) {
  const objectUrl = useProtectedMedia(message)
  const isAudio = message.message_type === 'audio'
  const isImage = message.message_type === 'image'
  const isVideo = message.message_type === 'video'
  const isDocument = message.message_type === 'document'
  const title = useMemo(() => {
    if (message.content?.trim()) return message.content.trim()
    if (isAudio) return 'Audio recebido'
    if (isImage) return 'Imagem recebida'
    if (isVideo) return 'Video recebido'
    if (isDocument) return 'Documento recebido'
    return 'Midia recebida'
  }, [isAudio, isDocument, isImage, isVideo, message.content])

  const cardTone = outgoing
    ? 'border-lime-300/20 bg-lime-300/[0.06]'
    : 'border-white/10 bg-white/[0.04]'

  async function handleDownload() {
    try {
      const response = await fetch(buildMediaUrl(message.id, true), {
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
      })

      if (!response.ok) {
        throw new Error(`download-${response.status}`)
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = buildFilename(message)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {}
  }

  return (
    <div className={`mt-3 overflow-hidden rounded-[22px] border ${cardTone}`}>
      {isImage && objectUrl && (
        <img
          src={objectUrl}
          alt={message.transcription || title}
          className="max-h-[340px] w-full object-cover"
        />
      )}

      {isVideo && objectUrl && (
        <video controls className="max-h-[340px] w-full bg-black">
          <source src={objectUrl} type={message.media_mimetype || 'video/mp4'} />
        </video>
      )}

      <div className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.22em] text-zinc-500">
              {message.message_type}
              {message.media_duration_seconds ? ` · ${formatDuration(message.media_duration_seconds)}` : ''}
            </p>
          </div>

          {message.media_local_path && (
            <button
              type="button"
              onClick={handleDownload}
              className="btn-secondary whitespace-nowrap px-3 py-1.5 text-xs"
            >
              Baixar
            </button>
          )}
        </div>

        {isAudio && objectUrl && (
          <audio controls className="mt-4 w-full">
            <source src={objectUrl} type={message.media_mimetype || 'audio/ogg'} />
          </audio>
        )}

        {isDocument && (
          <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-3 text-sm text-zinc-300">
            Documento salvo para consulta e download.
          </div>
        )}

        {message.transcription && (
          <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-3">
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
              {isAudio ? 'Transcricao' : isImage ? 'Descricao da imagem' : isDocument ? 'Texto extraido' : 'Descricao'}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
              {message.transcription}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
