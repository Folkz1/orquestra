import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''
const TOKEN = () => localStorage.getItem('orquestra_token')

const COLUMNS = [
  { key: 'ideia', label: 'Ideias', color: 'border-zinc-600', bg: 'bg-zinc-800/30' },
  { key: 'thumbnail_pronta', label: 'Thumb Pronta', color: 'border-blue-500/40', bg: 'bg-blue-900/10' },
  { key: 'pronto_gravar', label: 'Pronto p/ Gravar', color: 'border-green-500/40', bg: 'bg-green-900/10' },
  { key: 'publicado', label: 'Publicado', color: 'border-purple-500/40', bg: 'bg-purple-900/10' },
]

function KanbanCard({ video, index, briefingDate, onStatusChange }) {
  const [changing, setChanging] = useState(false)
  const status = video.status || 'ideia'
  const thumbnailUrl = video.thumbnail_file ? `${API_URL}/api/youtube/thumbnails/${video.thumbnail_file}` : null

  const urgenciaColors = {
    'ALTISSIMA': 'bg-red-500/15 text-red-400',
    'Alta': 'bg-orange-500/15 text-orange-400',
    'Media': 'bg-yellow-500/15 text-yellow-400',
  }

  const nextStatus = {
    ideia: 'thumbnail_pronta',
    thumbnail_pronta: 'pronto_gravar',
    pronto_gravar: 'publicado',
  }

  const nextLabel = {
    ideia: 'Thumb Pronta',
    thumbnail_pronta: 'Pronto p/ Gravar',
    pronto_gravar: 'Publicado',
  }

  async function handleAdvance() {
    const next = nextStatus[status]
    if (!next) return
    setChanging(true)
    const form = new FormData()
    form.append('status', next)
    try {
      const res = await fetch(`${API_URL}/api/youtube/briefings/latest/videos/${index}`, { method: 'PATCH', body: form })
      const data = await res.json()
      if (data.ok) onStatusChange(index, data.video)
    } catch (e) { console.error(e) }
    setChanging(false)
  }

  return (
    <div className="bg-zinc-800/60 rounded-lg border border-zinc-700/40 overflow-hidden">
      {thumbnailUrl && (
        <div className="w-full h-24 bg-zinc-900">
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          {video.urgencia && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${urgenciaColors[video.urgencia] || urgenciaColors.Media}`}>
              {video.urgencia}
            </span>
          )}
          {video.formato && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-700/50 text-zinc-400">{video.formato}</span>}
          {video.duracao && <span className="text-[9px] text-zinc-500">{video.duracao}</span>}
        </div>

        <h4 className="text-xs font-semibold text-zinc-100 leading-snug line-clamp-2 mb-1.5">
          {video.chosen_title || video.title}
        </h4>

        {video.potencial_views && (
          <p className="text-[9px] text-zinc-500 mb-2">~{video.potencial_views} views | B2B: {video.potencial_b2b}</p>
        )}

        <p className="text-[9px] text-zinc-600 mb-2">{briefingDate}</p>

        {nextStatus[status] && (
          <button onClick={handleAdvance} disabled={changing}
            className="w-full text-[10px] py-1.5 bg-zinc-700/50 text-zinc-300 rounded hover:bg-zinc-700 transition-colors disabled:opacity-50 font-medium">
            {changing ? '...' : `Mover: ${nextLabel[status]}`}
          </button>
        )}
      </div>
    </div>
  )
}

export default function YouTubeKanban() {
  const [briefings, setBriefings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch all briefings to show all videos across briefings
    fetch(`${API_URL}/api/youtube/briefings?limit=10`, {
      headers: { 'Authorization': `Bearer ${TOKEN()}` }
    })
      .then(res => res.json())
      .then(async (list) => {
        // For each briefing, fetch full data
        const fullBriefings = []
        for (const item of list.slice(0, 5)) {
          // We can only get latest, but we have all in list
          // Use the briefing list data + get latest for the most recent
          fullBriefings.push(item)
        }
        // Get the latest full briefing
        const latestRes = await fetch(`${API_URL}/api/youtube/briefings/latest`)
        const latestData = await latestRes.json()
        setBriefings(latestData.briefing ? [latestData.briefing] : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function handleStatusChange(videoIndex, updatedVideo) {
    setBriefings(prev => prev.map((b, bi) => {
      if (bi !== 0) return b
      const videos = [...(b.videos || [])]
      videos[videoIndex] = { ...videos[videoIndex], ...updatedVideo }
      return { ...b, videos }
    }))
  }

  // Collect all videos with their briefing date and original index
  const allVideos = []
  briefings.forEach((b, bi) => {
    (b.videos || []).forEach((v, vi) => {
      allVideos.push({ video: v, index: vi, briefingIndex: bi, date: b.date })
    })
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-green-500 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">YouTube - Videos</h1>
          <p className="text-xs text-zinc-500 mt-1">{allVideos.length} videos no pipeline</p>
        </div>
        <a href="/youtube-briefing" target="_blank" rel="noopener noreferrer"
          className="text-xs bg-red-500/15 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/25 transition-colors">
          Abrir Briefing Andriely
        </a>
      </div>

      <div className="grid grid-cols-4 gap-4 min-h-[60vh]">
        {COLUMNS.map(col => {
          const videos = allVideos.filter(v => (v.video.status || 'ideia') === col.key)
          return (
            <div key={col.key} className={`rounded-xl border ${col.color} ${col.bg} p-3`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{col.label}</h3>
                <span className="text-[10px] bg-zinc-700/50 text-zinc-400 px-1.5 py-0.5 rounded-full">{videos.length}</span>
              </div>
              <div className="space-y-3">
                {videos.map((v, i) => (
                  <KanbanCard
                    key={`${v.date}-${v.index}`}
                    video={v.video}
                    index={v.index}
                    briefingDate={v.date}
                    onStatusChange={handleStatusChange}
                  />
                ))}
                {videos.length === 0 && (
                  <p className="text-[10px] text-zinc-600 text-center py-8">Nenhum video</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
