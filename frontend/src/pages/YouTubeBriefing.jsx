import { useState, useEffect, useRef } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''

const STATUS_FLOW = {
  ideia: { label: 'Ideia', color: 'bg-zinc-600 text-zinc-200', next: 'thumbnail_pronta' },
  thumbnail_pronta: { label: 'Thumb Pronta', color: 'bg-blue-500/20 text-blue-400 border border-blue-500/30', next: 'pronto_gravar' },
  pronto_gravar: { label: 'Pronto p/ Gravar', color: 'bg-green-500/20 text-green-400 border border-green-500/30', next: 'publicado' },
  publicado: { label: 'Publicado', color: 'bg-purple-500/20 text-purple-400 border border-purple-500/30', next: null },
}

function StatusBadge({ status }) {
  const s = STATUS_FLOW[status] || STATUS_FLOW.ideia
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${s.color}`}>
      {s.label}
    </span>
  )
}

function VideoCard({ video, index, onUpdate }) {
  const [expanded, setExpanded] = useState(index === 0)
  const [selectedTitle, setSelectedTitle] = useState(video.chosen_title || video.title)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [thumbPreview, setThumbPreview] = useState(null)
  const fileRef = useRef()

  const status = video.status || 'ideia'
  const allTitles = [video.title, ...(video.alternatives || [])]

  const urgenciaColors = {
    'ALTISSIMA': 'bg-red-500/20 text-red-400 border-red-500/30',
    'Alta': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    'Media': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  }

  async function handleSaveTitle() {
    setSaving(true)
    const form = new FormData()
    form.append('chosen_title', selectedTitle)
    try {
      const res = await fetch(`${API_URL}/api/youtube/briefings/latest/videos/${index}`, {
        method: 'PATCH',
        body: form,
      })
      const data = await res.json()
      if (data.ok) onUpdate(index, data.video)
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  async function handleUploadThumb(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setThumbPreview(URL.createObjectURL(file))
    setUploading(true)
    const form = new FormData()
    form.append('thumbnail', file)
    form.append('status', 'thumbnail_pronta')
    if (selectedTitle !== video.title) {
      form.append('chosen_title', selectedTitle)
    }
    try {
      const res = await fetch(`${API_URL}/api/youtube/briefings/latest/videos/${index}`, {
        method: 'PATCH',
        body: form,
      })
      const data = await res.json()
      if (data.ok) onUpdate(index, data.video)
    } catch (e) {
      console.error(e)
    }
    setUploading(false)
  }

  async function handleMarkReady() {
    setSaving(true)
    const form = new FormData()
    form.append('status', 'pronto_gravar')
    try {
      const res = await fetch(`${API_URL}/api/youtube/briefings/latest/videos/${index}`, {
        method: 'PATCH',
        body: form,
      })
      const data = await res.json()
      if (data.ok) onUpdate(index, data.video)
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  const thumbnailUrl = video.thumbnail_file
    ? `${API_URL}/api/youtube/thumbnails/${video.thumbnail_file}`
    : null

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${
      status === 'pronto_gravar' ? 'bg-green-900/10 border-green-500/30' :
      status === 'thumbnail_pronta' ? 'bg-blue-900/10 border-blue-500/30' :
      status === 'publicado' ? 'bg-purple-900/10 border-purple-500/30' :
      'bg-zinc-800/60 border-zinc-700/50'
    }`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-5 hover:bg-zinc-800/40 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs font-bold text-zinc-500">VIDEO {index + 1}</span>
              <StatusBadge status={status} />
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
            <h3 className="text-lg font-bold text-zinc-100 leading-snug">
              {video.chosen_title || video.title}
            </h3>
            {video.potencial_views && (
              <p className="text-xs text-zinc-500 mt-1">Potencial: {video.potencial_views} views | B2B: {video.potencial_b2b}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 mt-1">
            {thumbnailUrl && (
              <div className="w-12 h-8 rounded overflow-hidden border border-zinc-600">
                <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <svg className={`w-5 h-5 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-5 pb-5 space-y-5 border-t border-zinc-700/30 pt-4">

          {/* === TITULO SELECTION === */}
          <div className="bg-zinc-900/80 rounded-xl p-4 border border-zinc-700/40">
            <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">
              Escolha o Titulo
            </h4>
            <div className="space-y-2">
              {allTitles.map((t, i) => (
                <label key={i} className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                  selectedTitle === t ? 'bg-amber-500/10 border border-amber-500/30' : 'hover:bg-zinc-800/60 border border-transparent'
                }`}>
                  <input
                    type="radio"
                    name={`title-${index}`}
                    checked={selectedTitle === t}
                    onChange={() => setSelectedTitle(t)}
                    className="mt-1 accent-amber-500"
                  />
                  <div>
                    <span className={`text-sm ${selectedTitle === t ? 'text-amber-200 font-semibold' : 'text-zinc-300'}`}>{t}</span>
                    {i === 0 && <span className="ml-2 text-[10px] text-zinc-600">(principal)</span>}
                  </div>
                </label>
              ))}
            </div>
            {selectedTitle !== (video.chosen_title || video.title) && (
              <button
                onClick={handleSaveTitle}
                disabled={saving}
                className="mt-3 px-4 py-1.5 bg-amber-500/20 text-amber-300 text-xs font-semibold rounded-lg hover:bg-amber-500/30 transition-colors disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar Titulo'}
              </button>
            )}
          </div>

          {/* === THUMBNAIL UPLOAD === */}
          <div className="bg-zinc-900/80 rounded-xl p-4 border border-zinc-700/40">
            <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">
              Thumbnail
              <a href="https://labs.google/fx/tools/whisk" target="_blank" rel="noopener noreferrer"
                 className="ml-2 text-blue-400/70 hover:text-blue-300 normal-case font-normal text-[10px]">
                Abrir Google Whisk
              </a>
            </h4>

            {/* Thumbnail prompt for reference */}
            {video.thumbnail_prompt && (
              <div className="bg-zinc-800/60 rounded-lg p-3 mb-3">
                <span className="text-[10px] text-zinc-500 uppercase">Descricao visual</span>
                <p className="text-sm text-zinc-300 mt-1">{video.thumbnail_prompt}</p>
              </div>
            )}
            {video.thumbnail_whisk_refine && (
              <div className="bg-zinc-800/60 rounded-lg p-3 mb-3 relative group">
                <span className="text-[10px] text-zinc-500 uppercase">Prompt Whisk Refine (copiar)</span>
                <p className="text-sm text-green-300 mt-1 font-mono">{video.thumbnail_whisk_refine}</p>
                <button
                  onClick={() => navigator.clipboard.writeText(video.thumbnail_whisk_refine)}
                  className="absolute top-2 right-2 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-700 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Copiar
                </button>
              </div>
            )}

            {/* Preview / Existing thumbnail */}
            {(thumbPreview || thumbnailUrl) && (
              <div className="mb-3">
                <img
                  src={thumbPreview || thumbnailUrl}
                  alt="Thumbnail"
                  className="w-full max-w-md rounded-lg border border-zinc-600"
                />
                {video.thumbnail_file && !thumbPreview && (
                  <p className="text-[10px] text-green-400 mt-1">Thumbnail enviada</p>
                )}
              </div>
            )}

            {/* Upload button */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleUploadThumb}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-4 py-2 bg-blue-500/20 text-blue-300 text-sm font-semibold rounded-lg hover:bg-blue-500/30 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {uploading ? (
                <>
                  <span className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {video.thumbnail_file ? 'Trocar Thumbnail' : 'Enviar Thumbnail'}
                </>
              )}
            </button>
          </div>

          {/* === MARK AS READY === */}
          {status === 'thumbnail_pronta' && (
            <button
              onClick={handleMarkReady}
              disabled={saving}
              className="w-full py-3 bg-green-500/20 text-green-300 text-sm font-bold rounded-xl hover:bg-green-500/30 transition-colors disabled:opacity-50 border border-green-500/30 flex items-center justify-center gap-2"
            >
              {saving ? (
                <span className="w-4 h-4 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              Marcar como Pronto para Gravar
            </button>
          )}

          {status === 'pronto_gravar' && (
            <div className="w-full py-3 bg-green-500/10 text-green-400 text-sm font-semibold rounded-xl border border-green-500/20 text-center">
              Pronto para o Diego gravar!
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

  function handleVideoUpdate(index, updatedVideo) {
    if (!briefing) return
    const videos = [...(briefing.videos || [])]
    videos[index] = { ...videos[index], ...updatedVideo }
    setBriefing({ ...briefing, videos })
  }

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

  const readyCount = videos.filter(v => v.status === 'pronto_gravar').length
  const thumbCount = videos.filter(v => v.status === 'thumbnail_pronta').length

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

          {/* Status summary */}
          {(readyCount > 0 || thumbCount > 0) && (
            <div className="flex items-center justify-center gap-3 mt-3">
              {thumbCount > 0 && (
                <span className="text-xs bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full border border-blue-500/20">
                  {thumbCount} com thumbnail
                </span>
              )}
              {readyCount > 0 && (
                <span className="text-xs bg-green-500/15 text-green-400 px-3 py-1 rounded-full border border-green-500/20">
                  {readyCount} prontos p/ gravar
                </span>
              )}
            </div>
          )}
        </div>

        {/* Workflow instructions */}
        <div className="bg-amber-500/5 rounded-xl p-4 mb-6 border border-amber-500/15">
          <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">Como usar</h3>
          <ol className="text-xs text-zinc-400 space-y-1">
            <li>1. Escolha o melhor titulo para cada video</li>
            <li>2. Use o prompt do Whisk para gerar a thumbnail</li>
            <li>3. Envie a thumbnail finalizada</li>
            <li>4. Marque como "Pronto para Gravar"</li>
          </ol>
        </div>

        {/* Videos */}
        <div className="space-y-4 mb-8">
          {videos.map((video, i) => (
            <VideoCard key={i} video={video} index={i} onUpdate={handleVideoUpdate} />
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
