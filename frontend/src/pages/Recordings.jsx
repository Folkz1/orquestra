import { useState, useEffect } from 'react'
import { getRecordings, getRecording } from '../api'

function formatDuration(seconds) {
  if (!seconds) return '--:--'
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function RecordingDetail({ recording, onClose }) {
  return (
    <div className="animate-fade-in">
      <button
        onClick={onClose}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 mb-4 transition-colors"
      >
        <span>&#8592;</span> Voltar
      </button>

      <div className="card">
        <h2 className="text-lg font-semibold mb-1">
          {recording.title || 'Gravacao sem titulo'}
        </h2>
        <div className="flex gap-4 text-xs text-zinc-500 mb-4">
          <span>{formatDate(recording.recorded_at || recording.created_at)}</span>
          <span>{formatDuration(recording.duration_seconds)}</span>
          {recording.source && <span className="badge-green">{recording.source}</span>}
          {recording.processed && <span className="text-primary">Processado</span>}
        </div>

        {recording.summary && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-primary mb-2">Resumo</h3>
            <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {recording.summary}
            </p>
          </div>
        )}

        {recording.action_items && recording.action_items.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-yellow-400 mb-2">Acoes</h3>
            <ul className="space-y-1">
              {recording.action_items.map((item, i) => (
                <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                  <span className="text-yellow-400 mt-0.5">&#9679;</span>
                  {typeof item === 'string' ? item : item.action || item.description || JSON.stringify(item)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {recording.decisions && recording.decisions.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-blue-400 mb-2">Decisoes</h3>
            <ul className="space-y-1">
              {recording.decisions.map((d, i) => (
                <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">&#9679;</span>
                  {typeof d === 'string' ? d : d.decision || d.description || JSON.stringify(d)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {recording.key_topics && recording.key_topics.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Topicos</h3>
            <div className="flex flex-wrap gap-2">
              {recording.key_topics.map((t, i) => (
                <span key={i} className="badge-green">{t}</span>
              ))}
            </div>
          </div>
        )}

        {recording.transcription && (
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Transcricao</h3>
            <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
              {recording.transcription}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Recordings() {
  const [recordings, setRecordings] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    getRecordings()
      .then((data) => {
        const list = Array.isArray(data) ? data : data.recordings || []
        list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        setRecordings(list)
      })
      .catch((err) => console.error('[Recordings] Load failed:', err))
      .finally(() => setLoading(false))
  }, [])

  const openDetail = async (rec) => {
    setDetailLoading(true)
    try {
      if (rec.id) {
        const full = await getRecording(rec.id)
        setSelected(full)
      } else {
        setSelected(rec)
      }
    } catch {
      setSelected(rec)
    }
    setDetailLoading(false)
  }

  if (detailLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  if (selected) {
    return <RecordingDetail recording={selected} onClose={() => setSelected(null)} />
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Gravacoes</h1>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
        </div>
      ) : recordings.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-4xl mb-3">🎧</p>
          <p>Nenhuma gravacao registrada</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recordings.map((rec, idx) => (
            <div
              key={rec.id || idx}
              onClick={() => openDetail(rec)}
              className="card cursor-pointer hover:border-zinc-700 transition-colors animate-fade-in"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-zinc-100">
                    {rec.title || 'Gravacao sem titulo'}
                  </p>
                  <div className="flex gap-3 text-xs text-zinc-500 mt-1">
                    <span>{formatDate(rec.recorded_at || rec.created_at)}</span>
                    <span>{formatDuration(rec.duration_seconds)}</span>
                    {rec.source && <span>{rec.source}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {rec.processed ? (
                    <span className="text-xs text-primary">Processado</span>
                  ) : (
                    <span className="text-xs text-zinc-600">Pendente</span>
                  )}
                </div>
              </div>
              {rec.transcription && (
                <p className="text-sm text-zinc-500 mt-2 line-clamp-2">
                  {rec.transcription.substring(0, 150)}...
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
