import { useState, useEffect } from 'react'

const BASE_URL = import.meta.env.VITE_API_URL || ''

function getToken() {
  return localStorage.getItem('orquestra_token') || ''
}

export default function Memory() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [stats, setStats] = useState(null)

  useEffect(() => { loadStats() }, [])

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)

    try {
      const res = await fetch(
        `${BASE_URL}/api/memory/search?q=${encodeURIComponent(query.trim())}&limit=15`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      )
      if (res.ok) {
        const data = await res.json()
        setResults(Array.isArray(data) ? data : data.results || [])
      }
    } catch (err) {
      console.error('[Memory] Search failed:', err)
    }
    setLoading(false)
  }

  const loadStats = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/memory/stats`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (res.ok) {
        setStats(await res.json())
      }
    } catch (err) {
      console.error('[Memory] Stats failed:', err)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') search()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Memoria RAG</h1>
        <button onClick={loadStats} className="btn-secondary text-sm">
          Stats
        </button>
      </div>

      {stats && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-zinc-400">Total de memorias</p>
            <p className="text-2xl font-bold text-primary">{stats.total || 0}</p>
          </div>
          {stats.by_source && (
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(stats.by_source).map(([source, count]) => (
                <div key={source} className="text-center bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-lg font-bold text-zinc-100">{count}</p>
                  <p className="text-xs text-zinc-500">{source}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          placeholder="Busca semantica... ex: reuniao sobre ROI"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="input flex-1"
          autoFocus
        />
        <button
          onClick={search}
          disabled={loading || !query.trim()}
          className="btn-primary"
        >
          {loading ? '...' : 'Buscar'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
        </div>
      ) : searched && results.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-4xl mb-3">🧠</p>
          <p>Nenhum resultado para "{query}"</p>
        </div>
      ) : (
        <div className="space-y-3">
          {results.map((item, idx) => (
            <div key={item.id || idx} className="card animate-fade-in">
              <div className="flex items-start justify-between mb-2">
                <div className="flex gap-2">
                  {item.source_type && (
                    <span className="badge-green text-xs">{item.source_type}</span>
                  )}
                  {item.similarity !== undefined && (
                    <span className="text-xs text-zinc-500">
                      {(item.similarity * 100).toFixed(0)}% match
                    </span>
                  )}
                </div>
                {item.created_at && (
                  <span className="text-xs text-zinc-600">
                    {new Date(item.created_at).toLocaleDateString('pt-BR')}
                  </span>
                )}
              </div>

              {item.summary && (
                <p className="text-sm font-medium text-zinc-200 mb-1">{item.summary}</p>
              )}

              <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">
                {item.content && item.content.length > 500
                  ? item.content.substring(0, 500) + '...'
                  : item.content}
              </p>

              {item.metadata && Object.keys(item.metadata).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {Object.entries(item.metadata).slice(0, 5).map(([k, v]) => (
                    <span key={k} className="text-xs text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded">
                      {k}: {typeof v === 'string' ? v : JSON.stringify(v)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
