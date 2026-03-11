import { useState, useEffect, useMemo } from 'react'
import { getYouTubeChannelStats, getYouTubeVideos, getYouTubeAnalyticsHistory, saveYouTubeAnalytics } from '../api'

function formatNumber(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n || 0)
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  return formatDate(dateStr)
}

function StatCard({ label, value, sub, color = 'text-zinc-100', icon }) {
  return (
    <div className="card flex flex-col">
      <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
        {icon && <span>{icon}</span>}
        <span>{label}</span>
      </div>
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
      {sub && <span className="text-xs text-zinc-500 mt-0.5">{sub}</span>}
    </div>
  )
}

function MiniBar({ value, max, color = 'bg-primary' }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function VideoRow({ video, maxViews, rank, onClick }) {
  const isPublic = video.privacy_status === 'public'
  return (
    <div
      onClick={() => onClick?.(video)}
      className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-zinc-800/50 cursor-pointer transition-colors animate-fade-in"
    >
      {/* Rank */}
      <span className={`text-sm font-mono w-6 text-center flex-shrink-0 ${
        rank <= 3 ? 'text-yellow-400 font-bold' : 'text-zinc-600'
      }`}>
        {rank}
      </span>

      {/* Thumbnail */}
      {video.thumbnail_url ? (
        <img
          src={video.thumbnail_url}
          alt=""
          className="w-24 h-14 rounded object-cover flex-shrink-0 bg-zinc-800"
          loading="lazy"
        />
      ) : (
        <div className="w-24 h-14 rounded bg-zinc-800 flex items-center justify-center flex-shrink-0 text-xl">
          🎬
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-medium text-zinc-100 truncate">{video.title}</h4>
        <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
          <span>{timeAgo(video.published_at)}</span>
          {!isPublic && (
            <span className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px]">
              {video.privacy_status}
            </span>
          )}
        </div>
        <MiniBar value={video.views || 0} max={maxViews} />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 flex-shrink-0 text-right">
        <div className="text-center">
          <div className="text-sm font-semibold text-zinc-100">{formatNumber(video.views)}</div>
          <div className="text-[10px] text-zinc-600">views</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-green-400">{formatNumber(video.likes)}</div>
          <div className="text-[10px] text-zinc-600">likes</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-blue-400">{formatNumber(video.comments)}</div>
          <div className="text-[10px] text-zinc-600">comments</div>
        </div>
      </div>
    </div>
  )
}

function VideoDetail({ video, onClose }) {
  const engagementRate = video.views > 0
    ? (((video.likes || 0) + (video.comments || 0)) / video.views * 100).toFixed(2)
    : '0.00'

  return (
    <div className="animate-fade-in">
      <button
        onClick={onClose}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 mb-4 transition-colors"
      >
        <span>&#8592;</span> Voltar
      </button>

      <div className="card mb-4">
        <div className="flex gap-4">
          {video.thumbnail_url && (
            <img src={video.thumbnail_url} alt="" className="w-48 h-28 rounded object-cover flex-shrink-0" />
          )}
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-zinc-100">{video.title}</h2>
            <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1">
              <span>{formatDate(video.published_at)}</span>
              <span className={`px-1.5 py-0.5 rounded ${
                video.privacy_status === 'public' ? 'bg-green-500/20 text-green-400' : 'bg-zinc-800 text-zinc-400'
              }`}>{video.privacy_status}</span>
            </div>
            <a
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline mt-1 inline-block"
            >
              Abrir no YouTube
            </a>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Views" value={formatNumber(video.views)} icon="👁️" />
        <StatCard label="Likes" value={formatNumber(video.likes)} color="text-green-400" icon="👍" />
        <StatCard label="Comentarios" value={formatNumber(video.comments)} color="text-blue-400" icon="💬" />
        <StatCard label="Engajamento" value={`${engagementRate}%`} color="text-yellow-400" icon="📈" />
      </div>

      {video.analytics && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {video.analytics.watch_time != null && (
            <StatCard
              label="Tempo assistido"
              value={`${formatNumber(video.analytics.watch_time)} min`}
              icon="⏱️"
            />
          )}
          {video.analytics.average_view_duration != null && (
            <StatCard
              label="Duração média"
              value={`${Math.floor(video.analytics.average_view_duration / 60)}:${String(video.analytics.average_view_duration % 60).padStart(2, '0')}`}
              icon="📊"
            />
          )}
        </div>
      )}

      {video.description && (
        <div className="card">
          <h3 className="text-sm font-semibold text-zinc-400 mb-2">Descrição</h3>
          <p className="text-sm text-zinc-300 whitespace-pre-wrap max-h-60 overflow-y-auto">{video.description}</p>
        </div>
      )}

      {video.tags && video.tags.length > 0 && (
        <div className="card mt-3">
          <h3 className="text-sm font-semibold text-zinc-400 mb-2">Tags</h3>
          <div className="flex flex-wrap gap-1.5">
            {video.tags.map((tag, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">{tag}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function YouTubeAnalytics() {
  const [channelStats, setChannelStats] = useState(null)
  const [videos, setVideos] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedVideo, setSelectedVideo] = useState(null)
  const [sortBy, setSortBy] = useState('date') // date, views, likes, engagement
  const [filterPrivacy, setFilterPrivacy] = useState('') // '', public, private, unlisted
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [statsRes, videosRes, historyRes] = await Promise.all([
        getYouTubeChannelStats().catch(e => ({ status: 'error', data: { message: e.message } })),
        getYouTubeVideos(50).catch(e => ({ status: 'error', data: { items: [] } })),
        getYouTubeAnalyticsHistory(30).catch(() => []),
      ])

      if (statsRes?.status === 'ok' && statsRes.data) {
        setChannelStats(statsRes.data)
      } else if (statsRes?.status === 'error') {
        setError(statsRes.data?.message || 'Erro ao carregar stats do canal')
      }

      if (videosRes?.status === 'ok' && videosRes.data?.items) {
        setVideos(videosRes.data.items)
      }

      setHistory(Array.isArray(historyRes) ? historyRes : [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function handleSaveSnapshot() {
    if (!channelStats || saving) return
    setSaving(true)
    try {
      const publicVideos = videos.filter(v => v.privacy_status === 'public')
      const viewsList = publicVideos.map(v => v.views || 0).filter(v => v > 0)
      const sorted = [...viewsList].sort((a, b) => a - b)
      const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0
      const avg = viewsList.length > 0 ? Math.round(viewsList.reduce((a, b) => a + b, 0) / viewsList.length) : 0

      await saveYouTubeAnalytics({
        date: new Date().toISOString().slice(0, 10),
        subscribers: channelStats.subscribers || 0,
        total_views: channelStats.total_views || 0,
        videos_count: channelStats.total_videos || 0,
        avg_views: avg,
        median_views: median,
        max_views: Math.max(...viewsList, 0),
        videos: publicVideos.slice(0, 10).map(v => ({
          video_id: v.video_id,
          title: v.title,
          views: v.views,
          likes: v.likes,
        })),
      })
      // Reload history
      const newHistory = await getYouTubeAnalyticsHistory(30).catch(() => [])
      setHistory(Array.isArray(newHistory) ? newHistory : [])
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  // Computed
  const publicVideos = useMemo(() => videos.filter(v => v.privacy_status === 'public'), [videos])
  const viewsList = useMemo(() => publicVideos.map(v => v.views || 0).filter(v => v > 0), [publicVideos])
  const avgViews = useMemo(() => {
    if (viewsList.length === 0) return 0
    return Math.round(viewsList.reduce((a, b) => a + b, 0) / viewsList.length)
  }, [viewsList])
  const medianViews = useMemo(() => {
    if (viewsList.length === 0) return 0
    const sorted = [...viewsList].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }, [viewsList])
  const totalLikes = useMemo(() => publicVideos.reduce((s, v) => s + (v.likes || 0), 0), [publicVideos])
  const totalComments = useMemo(() => publicVideos.reduce((s, v) => s + (v.comments || 0), 0), [publicVideos])

  const filteredVideos = useMemo(() => {
    let list = [...videos]
    if (filterPrivacy) {
      list = list.filter(v => v.privacy_status === filterPrivacy)
    }
    switch (sortBy) {
      case 'views':
        list.sort((a, b) => (b.views || 0) - (a.views || 0))
        break
      case 'likes':
        list.sort((a, b) => (b.likes || 0) - (a.likes || 0))
        break
      case 'engagement':
        list.sort((a, b) => {
          const ea = a.views > 0 ? ((a.likes || 0) + (a.comments || 0)) / a.views : 0
          const eb = b.views > 0 ? ((b.likes || 0) + (b.comments || 0)) / b.views : 0
          return eb - ea
        })
        break
      default: // date
        list.sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0))
    }
    return list
  }, [videos, sortBy, filterPrivacy])

  const maxViews = useMemo(() => Math.max(...videos.map(v => v.views || 0), 1), [videos])

  // Growth from history
  const growth = useMemo(() => {
    if (history.length < 2) return null
    const latest = history[0]
    const prev = history[history.length - 1]
    if (!latest || !prev) return null
    return {
      subscribers: (latest.subscribers || 0) - (prev.subscribers || 0),
      views: (latest.total_views || 0) - (prev.total_views || 0),
      period: history.length,
    }
  }, [history])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  if (selectedVideo) {
    return <VideoDetail video={selectedVideo} onClose={() => setSelectedVideo(null)} />
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="text-red-500">▶</span> YouTube Analytics
          </h1>
          {channelStats && (
            <p className="text-xs text-zinc-500 mt-0.5">
              {channelStats.title || 'GuyFolkz'} · @guyfolkz
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveSnapshot}
            disabled={saving || !channelStats}
            className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar Snapshot'}
          </button>
          <button
            onClick={loadData}
            className="text-xs px-3 py-1.5 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
          >
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="card mb-4 border-red-500/30 bg-red-500/5">
          <p className="text-sm text-red-400">{error}</p>
          <p className="text-xs text-zinc-500 mt-1">
            Verifique se o YouTube OAuth esta conectado em /settings ou via API
          </p>
        </div>
      )}

      {/* Channel Overview */}
      {channelStats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard
              label="Inscritos"
              value={formatNumber(channelStats.subscribers)}
              color="text-red-400"
              icon="👥"
              sub={growth ? `${growth.subscribers >= 0 ? '+' : ''}${growth.subscribers} recentes` : undefined}
            />
            <StatCard
              label="Views totais"
              value={formatNumber(channelStats.total_views)}
              icon="👁️"
              sub={growth ? `+${formatNumber(growth.views)} recentes` : undefined}
            />
            <StatCard
              label="Videos"
              value={channelStats.total_videos}
              icon="🎬"
              sub={`${publicVideos.length} publicos`}
            />
            <StatCard
              label="Media views"
              value={formatNumber(avgViews)}
              color="text-yellow-400"
              icon="📊"
              sub={`Mediana: ${formatNumber(medianViews)}`}
            />
          </div>

          {/* Performance Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Total likes" value={formatNumber(totalLikes)} color="text-green-400" icon="👍" />
            <StatCard label="Total comentarios" value={formatNumber(totalComments)} color="text-blue-400" icon="💬" />
            <StatCard
              label="Engajamento medio"
              value={channelStats.total_views > 0
                ? `${((totalLikes + totalComments) / channelStats.total_views * 100).toFixed(2)}%`
                : '0%'
              }
              color="text-purple-400"
              icon="📈"
            />
            <StatCard
              label="Views/video"
              value={formatNumber(channelStats.total_videos > 0
                ? Math.round(channelStats.total_views / channelStats.total_videos)
                : 0
              )}
              icon="🎯"
            />
          </div>
        </>
      )}

      {/* Analytics History (mini chart representation) */}
      {history.length > 1 && (
        <div className="card mb-4">
          <h3 className="text-sm font-semibold text-zinc-400 mb-3">Historico de Snapshots</h3>
          <div className="flex items-end gap-1 h-16">
            {history.slice().reverse().map((h, i) => {
              const maxSubs = Math.max(...history.map(x => x.subscribers || 0), 1)
              const pct = ((h.subscribers || 0) / maxSubs) * 100
              return (
                <div
                  key={i}
                  className="flex-1 bg-red-500/30 hover:bg-red-500/50 rounded-t transition-colors cursor-default"
                  style={{ height: `${Math.max(pct, 5)}%` }}
                  title={`${h.date}: ${h.subscribers} subs, ${h.avg_views} avg views`}
                />
              )
            })}
          </div>
          <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
            <span>{history[history.length - 1]?.date}</span>
            <span>{history[0]?.date}</span>
          </div>
        </div>
      )}

      {/* Top 5 */}
      {publicVideos.length > 0 && (
        <div className="card mb-4">
          <h3 className="text-sm font-semibold text-yellow-400 mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
            Top 5 Videos
          </h3>
          {[...publicVideos].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5).map((v, i) => (
            <VideoRow
              key={v.video_id}
              video={v}
              maxViews={maxViews}
              rank={i + 1}
              onClick={setSelectedVideo}
            />
          ))}
        </div>
      )}

      {/* All Videos */}
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-zinc-300 flex-1">
          Todos os videos ({filteredVideos.length})
        </h3>
        <select
          value={filterPrivacy}
          onChange={e => setFilterPrivacy(e.target.value)}
          className="input text-xs w-28"
        >
          <option value="">Todos</option>
          <option value="public">Publicos</option>
          <option value="private">Privados</option>
          <option value="unlisted">Nao listados</option>
        </select>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="input text-xs w-32"
        >
          <option value="date">Mais recentes</option>
          <option value="views">Mais views</option>
          <option value="likes">Mais likes</option>
          <option value="engagement">Engajamento</option>
        </select>
      </div>

      {filteredVideos.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-4xl mb-3">📺</p>
          <p>Nenhum video encontrado</p>
          {!channelStats && (
            <p className="text-xs mt-2">Conecte o YouTube OAuth primeiro</p>
          )}
        </div>
      ) : (
        <div className="card">
          {filteredVideos.map((v, i) => (
            <VideoRow
              key={v.video_id}
              video={v}
              maxViews={maxViews}
              rank={i + 1}
              onClick={setSelectedVideo}
            />
          ))}
        </div>
      )}
    </div>
  )
}
