import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''

function VideoCard({ video, index }) {
  const [expanded, setExpanded] = useState(index === 0)
  const urgenciaColors = {
    'ALTISSIMA': 'bg-red-500/20 text-red-400 border-red-500/30',
    'Alta': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    'Media': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  }

  return (
    <div className="bg-zinc-800/60 rounded-2xl border border-zinc-700/50 overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-5 hover:bg-zinc-800/80 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs font-bold text-zinc-500">VIDEO {index + 1}</span>
              {video.urgencia && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${urgenciaColors[video.urgencia] || urgenciaColors.Media}`}>
                  {video.urgencia}
                </span>
              )}
              {video.formato && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20">
                  {video.formato}
                </span>
              )}
              {video.duracao && (
                <span className="text-[10px] text-zinc-500">{video.duracao}</span>
              )}
            </div>
            <h3 className="text-lg font-bold text-zinc-100 leading-snug">{video.title}</h3>
            {video.potencial_views && (
              <p className="text-xs text-zinc-500 mt-1">Potencial: {video.potencial_views} views | B2B: {video.potencial_b2b}</p>
            )}
          </div>
          <svg className={`w-5 h-5 text-zinc-500 transition-transform flex-shrink-0 mt-1 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-zinc-700/30 pt-4">
          {/* Alternatives */}
          {video.alternatives?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Titulos Alternativos</h4>
              <ul className="space-y-1">
                {video.alternatives.map((alt, i) => (
                  <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                    <span className="text-zinc-600 flex-shrink-0">-</span>
                    {alt}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Hook */}
          {video.hook && (
            <div>
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Hook (primeiros 30s)</h4>
              <p className="text-sm text-zinc-200 italic bg-zinc-900/60 rounded-xl p-3 border-l-2 border-amber-500/50">
                {video.hook}
              </p>
            </div>
          )}

          {/* Roteiro */}
          {video.roteiro && Object.keys(video.roteiro).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Roteiro 3 Atos (B2B)</h4>
              <div className="space-y-2">
                {Object.entries(video.roteiro).map(([key, val]) => (
                  <div key={key} className="bg-zinc-900/60 rounded-lg p-3">
                    <span className="text-xs font-semibold text-amber-400 uppercase">{key}</span>
                    <p className="text-sm text-zinc-300 mt-1">{val}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Thumbnail */}
          {(video.thumbnail_prompt || video.thumbnail_whisk_refine) && (
            <div>
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Thumbnail (Google Whisk)
                <a href="https://labs.google/fx/tools/whisk" target="_blank" rel="noopener noreferrer"
                   className="ml-2 text-blue-400 hover:text-blue-300 normal-case font-normal">
                  Abrir Whisk
                </a>
              </h4>
              {video.thumbnail_prompt && (
                <div className="bg-zinc-900/60 rounded-lg p-3 mb-2">
                  <span className="text-[10px] text-zinc-500 uppercase">Descricao visual</span>
                  <p className="text-sm text-zinc-300 mt-1">{video.thumbnail_prompt}</p>
                </div>
              )}
              {video.thumbnail_whisk_refine && (
                <div className="bg-zinc-900/60 rounded-lg p-3 relative group">
                  <span className="text-[10px] text-zinc-500 uppercase">Prompt para Whisk Refine (copiar e colar)</span>
                  <p className="text-sm text-green-300 mt-1 font-mono">{video.thumbnail_whisk_refine}</p>
                  <button
                    onClick={() => { navigator.clipboard.writeText(video.thumbnail_whisk_refine) }}
                    className="absolute top-2 right-2 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-800 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Copiar
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Keywords */}
          {video.keywords?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Keywords SEO</h4>
              <div className="flex flex-wrap gap-1.5">
                {video.keywords.map((kw, i) => (
                  <span key={i} className="text-xs bg-zinc-700/50 text-zinc-300 px-2 py-1 rounded-md">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function YouTubeBriefing() {
  const [briefing, setBriefing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${API_URL}/api/youtube/briefings/latest`)
      .then(res => res.json())
      .then(data => {
        setBriefing(data.briefing)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-green-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !briefing) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500">
        <div className="text-center">
          <p className="text-4xl mb-4">📺</p>
          <p className="text-lg">Nenhum briefing disponivel</p>
          {error && <p className="text-sm mt-2 text-red-400">{error}</p>}
        </div>
      </div>
    )
  }

  const videos = briefing.videos || []
  const tendencias = briefing.tendencias || []
  const metricas = briefing.metricas_canal || {}

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-red-500/10 text-red-400 px-4 py-1.5 rounded-full text-sm font-semibold mb-4 border border-red-500/20">
            <span>📺</span> GuyFolkz - Briefing YouTube
          </div>
          <h1 className="text-3xl font-bold text-zinc-100 mb-2">
            {briefing.tipo === 'noticias-ia' ? 'Noticias de IA' : briefing.tipo || 'Briefing'}
          </h1>
          <p className="text-zinc-500">
            {briefing.date} | {videos.length} videos | {briefing.calendario}
          </p>
        </div>

        {/* Videos */}
        <div className="space-y-4 mb-8">
          {videos.map((video, i) => (
            <VideoCard key={i} video={video} index={i} />
          ))}
        </div>

        {/* Tendencias */}
        {tendencias.length > 0 && (
          <div className="bg-zinc-800/40 rounded-2xl p-5 mb-6 border border-zinc-700/30">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-3">Tendencias da Semana</h2>
            <div className="space-y-2">
              {tendencias.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    t.level === 'HOT' ? 'bg-red-500/20 text-red-400' :
                    t.level === 'WARM' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-zinc-700 text-zinc-400'
                  }`}>
                    {t.level || 'INFO'}
                  </span>
                  <span className="text-sm text-zinc-300">{t.topic}</span>
                  {t.source && <span className="text-xs text-zinc-600">({t.source})</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metricas do Canal */}
        {Object.keys(metricas).length > 0 && (
          <div className="bg-zinc-800/40 rounded-2xl p-5 mb-6 border border-zinc-700/30">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-3">Metricas do Canal</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {metricas.subscribers && (
                <div className="bg-zinc-900/60 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-zinc-100">{metricas.subscribers}</div>
                  <div className="text-[10px] text-zinc-500 uppercase">Inscritos</div>
                </div>
              )}
              {metricas.avg_views && (
                <div className="bg-zinc-900/60 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-zinc-100">{metricas.avg_views}</div>
                  <div className="text-[10px] text-zinc-500 uppercase">Media Views</div>
                </div>
              )}
              {metricas.max_views && (
                <div className="bg-zinc-900/60 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-zinc-100">{metricas.max_views}</div>
                  <div className="text-[10px] text-zinc-500 uppercase">Maior Hit</div>
                </div>
              )}
              {metricas.total_videos && (
                <div className="bg-zinc-900/60 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-zinc-100">{metricas.total_videos}</div>
                  <div className="text-[10px] text-zinc-500 uppercase">Videos</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Insight Estrategico */}
        {briefing.insight_estrategico && (
          <div className="bg-gradient-to-br from-green-500/10 to-blue-500/10 rounded-2xl p-5 mb-6 border border-green-500/20">
            <h2 className="text-sm font-semibold text-green-400 uppercase tracking-wider mb-2">Insight Estrategico</h2>
            <p className="text-sm text-zinc-300 leading-relaxed">{briefing.insight_estrategico}</p>
          </div>
        )}

        {/* Thumbnail Template */}
        {briefing.thumbnail_template && (
          <div className="bg-zinc-800/40 rounded-2xl p-5 mb-6 border border-zinc-700/30">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-2">Template de Thumbnail</h2>
            <p className="text-sm text-zinc-400 whitespace-pre-wrap">{briefing.thumbnail_template}</p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6 border-t border-zinc-800">
          <p className="text-xs text-zinc-600">Gerado por Jarbas - Orquestra | Metodo D.P.E. + B2B</p>
          <a href="https://labs.google/fx/tools/whisk" target="_blank" rel="noopener noreferrer"
             className="inline-block mt-2 text-xs text-blue-400 hover:text-blue-300">
            Google Whisk (gerar thumbnails)
          </a>
        </div>
      </div>
    </div>
  )
}
