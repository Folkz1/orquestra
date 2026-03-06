import { useState, useEffect, useRef } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''

const STATUS_CONFIG = {
  ideia: { label: 'Ideia', color: 'bg-zinc-600 text-zinc-200', dot: 'bg-zinc-400' },
  thumbnail_pronta: { label: 'Thumb Pronta', color: 'bg-blue-500/20 text-blue-400', dot: 'bg-blue-400' },
  pronto_gravar: { label: 'Pronto p/ Gravar', color: 'bg-green-500/20 text-green-400', dot: 'bg-green-400' },
  publicado: { label: 'Publicado', color: 'bg-purple-500/20 text-purple-400', dot: 'bg-purple-400' },
}

/* ─── Full-screen detail modal ──────────────────────────────── */
function VideoDetail({ video, index, onUpdate, onClose }) {
  const [selectedTitle, setSelectedTitle] = useState(video.chosen_title || video.title)
  const [customTitle, setCustomTitle] = useState(video.chosen_title || '')
  const [isCustom, setIsCustom] = useState(!!video.chosen_title && ![video.title, ...(video.alternatives || [])].includes(video.chosen_title))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [thumbPreview, setThumbPreview] = useState(null)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef()

  const status = video.status || 'ideia'
  const allTitles = [video.title, ...(video.alternatives || [])]
  const finalTitle = isCustom ? customTitle : selectedTitle

  const thumbnailUrl = video.thumbnail_file
    ? `${API_URL}/api/youtube/thumbnails/${video.thumbnail_file}`
    : null

  const urgenciaColors = {
    'ALTISSIMA': 'text-red-400 bg-red-500/15',
    'Alta': 'text-orange-400 bg-orange-500/15',
    'Media': 'text-yellow-400 bg-yellow-500/15',
  }

  async function handleSaveTitle() {
    setSaving(true)
    const form = new FormData()
    form.append('chosen_title', finalTitle)
    try {
      const res = await fetch(`${API_URL}/api/youtube/briefings/latest/videos/${index}`, { method: 'PATCH', body: form })
      const data = await res.json()
      if (data.ok) { onUpdate(index, data.video); setSaved(true); setTimeout(() => setSaved(false), 2000) }
    } catch (e) { console.error(e) }
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
    if (finalTitle !== video.title) form.append('chosen_title', finalTitle)
    try {
      const res = await fetch(`${API_URL}/api/youtube/briefings/latest/videos/${index}`, { method: 'PATCH', body: form })
      const data = await res.json()
      if (data.ok) onUpdate(index, data.video)
    } catch (e) { console.error(e) }
    setUploading(false)
  }

  async function handleMarkReady() {
    setSaving(true)
    const form = new FormData()
    form.append('status', 'pronto_gravar')
    try {
      const res = await fetch(`${API_URL}/api/youtube/briefings/latest/videos/${index}`, { method: 'PATCH', body: form })
      const data = await res.json()
      if (data.ok) onUpdate(index, data.video)
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/95 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={onClose} className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Voltar
          </button>
          <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${(STATUS_CONFIG[status] || STATUS_CONFIG.ideia).color}`}>
            {(STATUS_CONFIG[status] || STATUS_CONFIG.ideia).label}
          </span>
        </div>

        {/* Video header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs font-bold text-zinc-500">VIDEO {index + 1}</span>
            {video.urgencia && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${urgenciaColors[video.urgencia] || urgenciaColors.Media}`}>
                {video.urgencia}
              </span>
            )}
            {video.formato && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">{video.formato}</span>}
            {video.duracao && <span className="text-[10px] text-zinc-500">{video.duracao}</span>}
            {video.potencial_views && <span className="text-[10px] text-zinc-500">~{video.potencial_views} views</span>}
          </div>
          <h1 className="text-2xl font-bold text-zinc-100 leading-tight">{video.chosen_title || video.title}</h1>
        </div>

        {/* ─── SECTION: Contexto do Video ─── */}
        <Section title="Contexto do Video" icon="info">
          {video.hook && (
            <div className="mb-3">
              <label className="text-[10px] text-zinc-500 uppercase font-semibold">Hook (primeiros 30s)</label>
              <p className="text-sm text-zinc-200 italic mt-1 bg-zinc-800/60 rounded-lg p-3 border-l-2 border-amber-500/50">{video.hook}</p>
            </div>
          )}
          {video.roteiro && Object.keys(video.roteiro).length > 0 && (
            <div className="mb-3">
              <label className="text-[10px] text-zinc-500 uppercase font-semibold">Roteiro 3 Atos</label>
              <div className="space-y-2 mt-1">
                {Object.entries(video.roteiro).map(([key, val]) => (
                  <div key={key} className="bg-zinc-800/60 rounded-lg p-3">
                    <span className="text-[10px] font-semibold text-amber-400 uppercase">{key}</span>
                    <p className="text-sm text-zinc-300 mt-1">{val}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {video.keywords?.length > 0 && (
            <div>
              <label className="text-[10px] text-zinc-500 uppercase font-semibold">Keywords SEO</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {video.keywords.map((kw, i) => (
                  <span key={i} className="text-xs bg-zinc-700/50 text-zinc-300 px-2 py-1 rounded-md">{kw}</span>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* ─── SECTION: Escolha do Titulo ─── */}
        <Section title="Escolha o Titulo" icon="title">
          <div className="space-y-2">
            {allTitles.map((t, i) => (
              <label key={i} className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                !isCustom && selectedTitle === t
                  ? 'bg-amber-500/10 border border-amber-500/30 shadow-sm shadow-amber-500/10'
                  : 'bg-zinc-800/40 border border-transparent hover:border-zinc-700'
              }`}>
                <input type="radio" name={`title-${index}`} checked={!isCustom && selectedTitle === t}
                  onChange={() => { setSelectedTitle(t); setIsCustom(false) }}
                  className="mt-0.5 accent-amber-500" />
                <div>
                  <span className={`text-sm ${!isCustom && selectedTitle === t ? 'text-amber-200 font-semibold' : 'text-zinc-300'}`}>{t}</span>
                  {i === 0 && <span className="ml-2 text-[10px] text-zinc-600">(principal)</span>}
                </div>
              </label>
            ))}

            {/* Custom */}
            <label className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all ${
              isCustom ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-zinc-800/40 border border-transparent hover:border-zinc-700'
            }`}>
              <input type="radio" name={`title-${index}`} checked={isCustom}
                onChange={() => { setIsCustom(true); if (!customTitle) setCustomTitle(selectedTitle) }}
                className="mt-0.5 accent-amber-500" />
              <span className={`text-sm ${isCustom ? 'text-amber-200 font-semibold' : 'text-zinc-400'}`}>Personalizado</span>
            </label>
            {isCustom && (
              <input type="text" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Digite seu titulo..."
                className="w-full px-3 py-2.5 bg-zinc-800 border border-amber-500/30 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-400" />
            )}
          </div>

          <button onClick={handleSaveTitle} disabled={saving}
            className={`mt-3 w-full py-2.5 text-sm font-semibold rounded-lg transition-all ${
              saved ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
            } disabled:opacity-50`}>
            {saving ? 'Salvando...' : saved ? 'Titulo Salvo!' : 'Salvar Titulo Escolhido'}
          </button>
        </Section>

        {/* ─── SECTION: Thumbnail ─── */}
        <Section title="Thumbnail" icon="image" extra={
          <a href="https://labs.google/fx/tools/whisk" target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-blue-400 hover:text-blue-300">Abrir Google Whisk</a>
        }>
          {/* Description */}
          {video.thumbnail_prompt && (
            <div className="bg-zinc-800/60 rounded-lg p-3 mb-4">
              <label className="text-[10px] text-zinc-500 uppercase font-semibold">Descricao Visual</label>
              <p className="text-sm text-zinc-300 mt-1">{video.thumbnail_prompt}</p>
            </div>
          )}

          {/* 3 Prompts PT-BR */}
          {(video.thumbnail_prompts_ptbr?.length > 0) ? (
            <div className="space-y-3 mb-4">
              <label className="text-[10px] text-zinc-500 uppercase font-semibold">3 Prompts para Whisk (copie e teste)</label>
              {video.thumbnail_prompts_ptbr.map((prompt, pi) => {
                const styles = [
                  { label: 'CLEAN', color: 'bg-emerald-500/20 text-emerald-400' },
                  { label: 'DRAMATICO', color: 'bg-red-500/20 text-red-400' },
                  { label: 'FUTURISTA', color: 'bg-cyan-500/20 text-cyan-400' },
                ]
                const s = styles[pi] || styles[0]
                return (
                  <div key={pi} className="bg-zinc-800/60 rounded-lg p-3 relative group">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${s.color}`}>{s.label}</span>
                    <p className="text-sm text-green-300 font-mono mt-2 pr-12 leading-relaxed">{prompt}</p>
                    <button onClick={() => { navigator.clipboard.writeText(prompt) }}
                      className="absolute top-3 right-3 text-[10px] text-zinc-500 hover:text-zinc-200 bg-zinc-700 hover:bg-zinc-600 px-2 py-1 rounded transition-colors">
                      Copiar
                    </button>
                  </div>
                )
              })}
              <p className="text-[10px] text-zinc-600 italic">* Textos escritos na thumbnail devem ser sempre em portugues</p>
            </div>
          ) : video.thumbnail_whisk_refine ? (
            <div className="bg-zinc-800/60 rounded-lg p-3 mb-4 relative group">
              <label className="text-[10px] text-zinc-500 uppercase font-semibold">Prompt Whisk</label>
              <p className="text-sm text-green-300 font-mono mt-1 pr-12">{video.thumbnail_whisk_refine}</p>
              <button onClick={() => navigator.clipboard.writeText(video.thumbnail_whisk_refine)}
                className="absolute top-3 right-3 text-[10px] text-zinc-500 hover:text-zinc-200 bg-zinc-700 px-2 py-1 rounded">Copiar</button>
            </div>
          ) : null}

          {/* Preview / Existing */}
          {(thumbPreview || thumbnailUrl) && (
            <div className="mb-4">
              <img src={thumbPreview || thumbnailUrl} alt="Thumbnail" className="w-full rounded-lg border border-zinc-700" />
              {video.thumbnail_file && !thumbPreview && <p className="text-[10px] text-green-400 mt-1">Thumbnail enviada</p>}
            </div>
          )}

          {/* Upload */}
          <input ref={fileRef} type="file" accept="image/*" onChange={handleUploadThumb} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="w-full py-2.5 bg-blue-500/15 text-blue-300 text-sm font-semibold rounded-lg hover:bg-blue-500/25 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {uploading ? (
              <><span className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /> Enviando...</>
            ) : (
              <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>{video.thumbnail_file ? 'Trocar Thumbnail' : 'Enviar Thumbnail'}</>
            )}
          </button>
        </Section>

        {/* ─── Action: Mark Ready ─── */}
        {status === 'thumbnail_pronta' && (
          <button onClick={handleMarkReady} disabled={saving}
            className="w-full py-3.5 mt-4 bg-green-500/15 text-green-300 text-sm font-bold rounded-xl hover:bg-green-500/25 transition-colors disabled:opacity-50 border border-green-500/20 flex items-center justify-center gap-2">
            {saving ? <span className="w-4 h-4 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" /> :
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>}
            Marcar como Pronto para Gravar
          </button>
        )}
        {status === 'pronto_gravar' && (
          <div className="w-full py-3 mt-4 bg-green-500/10 text-green-400 text-sm font-semibold rounded-xl border border-green-500/20 text-center">
            Pronto para o Diego gravar!
          </div>
        )}

        <div className="h-12" />
      </div>
    </div>
  )
}

/* ─── Reusable section wrapper ──────────────────────────────── */
function Section({ title, children, extra }) {
  return (
    <div className="bg-zinc-900/60 rounded-xl border border-zinc-800 p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</h3>
        {extra}
      </div>
      {children}
    </div>
  )
}

/* ─── Video card (grid view) ────────────────────────────────── */
function VideoCard({ video, index, onClick }) {
  const status = video.status || 'ideia'
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.ideia

  const thumbnailUrl = video.thumbnail_file
    ? `${API_URL}/api/youtube/thumbnails/${video.thumbnail_file}`
    : null

  const urgenciaColors = {
    'ALTISSIMA': 'bg-red-500/15 text-red-400',
    'Alta': 'bg-orange-500/15 text-orange-400',
    'Media': 'bg-yellow-500/15 text-yellow-400',
  }

  return (
    <button onClick={onClick}
      className={`w-full text-left rounded-xl border overflow-hidden transition-all hover:scale-[1.01] hover:shadow-lg active:scale-[0.99] ${
        status === 'pronto_gravar' ? 'bg-green-900/10 border-green-500/20 hover:border-green-500/40' :
        status === 'thumbnail_pronta' ? 'bg-blue-900/10 border-blue-500/20 hover:border-blue-500/40' :
        status === 'publicado' ? 'bg-purple-900/10 border-purple-500/20' :
        'bg-zinc-800/50 border-zinc-700/40 hover:border-zinc-600'
      }`}>

      {/* Thumbnail preview strip */}
      {thumbnailUrl ? (
        <div className="w-full h-32 bg-zinc-800">
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="w-full h-20 bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center">
          <span className="text-3xl opacity-30">📺</span>
        </div>
      )}

      <div className="p-4">
        {/* Badges row */}
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${cfg.color}`}>{cfg.label}</span>
          {video.urgencia && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${urgenciaColors[video.urgencia] || urgenciaColors.Media}`}>
              {video.urgencia}
            </span>
          )}
          {video.formato && <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700/50 text-zinc-400">{video.formato}</span>}
        </div>

        {/* Title */}
        <h3 className="text-sm font-bold text-zinc-100 leading-snug line-clamp-2 mb-1">
          {video.chosen_title || video.title}
        </h3>

        {/* Meta */}
        <div className="flex items-center gap-3 text-[10px] text-zinc-500 mt-2">
          {video.duracao && <span>{video.duracao}</span>}
          {video.potencial_views && <span>~{video.potencial_views} views</span>}
          {video.thumbnail_file && <span className="text-green-500">Thumb OK</span>}
        </div>
      </div>
    </button>
  )
}

/* ─── Main page ─────────────────────────────────────────────── */
export default function YouTubeBriefing() {
  const [briefing, setBriefing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeVideo, setActiveVideo] = useState(null) // index or null

  useEffect(() => {
    fetch(`${API_URL}/api/youtube/briefings/latest`)
      .then(res => res.json())
      .then(data => { setBriefing(data.briefing); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
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

  // If a video is selected, show detail view
  if (activeVideo !== null && videos[activeVideo]) {
    return (
      <VideoDetail
        video={videos[activeVideo]}
        index={activeVideo}
        onUpdate={handleVideoUpdate}
        onClose={() => setActiveVideo(null)}
      />
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-red-500/10 text-red-400 px-4 py-1.5 rounded-full text-sm font-semibold mb-4 border border-red-500/20">
            📺 GuyFolkz - Briefing YouTube
          </div>
          <h1 className="text-2xl font-bold text-zinc-100 mb-1">
            {briefing.tipo === 'noticias-ia' ? 'Noticias de IA' : briefing.tipo || 'Briefing'}
          </h1>
          <p className="text-zinc-500 text-sm">
            {briefing.date} | {videos.length} videos | {briefing.calendario}
          </p>

          {(readyCount > 0 || thumbCount > 0) && (
            <div className="flex items-center justify-center gap-3 mt-3">
              {thumbCount > 0 && <span className="text-[10px] bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full">{thumbCount} com thumbnail</span>}
              {readyCount > 0 && <span className="text-[10px] bg-green-500/15 text-green-400 px-3 py-1 rounded-full">{readyCount} prontos</span>}
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="bg-amber-500/5 rounded-xl p-4 mb-6 border border-amber-500/15">
          <p className="text-xs text-zinc-400">
            <span className="text-amber-400 font-semibold">Como usar:</span>{' '}
            Clique em um video para ver detalhes, escolher titulo, gerar thumbnail no Whisk e enviar.
          </p>
        </div>

        {/* Video grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {videos.map((video, i) => (
            <VideoCard key={i} video={video} index={i} onClick={() => setActiveVideo(i)} />
          ))}
        </div>

        {/* Tendencias */}
        {tendencias.length > 0 && (
          <div className="bg-zinc-900/60 rounded-xl p-4 mb-4 border border-zinc-800">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Tendencias da Semana</h2>
            <div className="space-y-2">
              {tendencias.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    t.level === 'HOT' ? 'bg-red-500/20 text-red-400' :
                    t.level === 'WARM' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-zinc-700 text-zinc-400'
                  }`}>{t.level || 'INFO'}</span>
                  <span className="text-sm text-zinc-300">{t.topic}</span>
                  {t.source && <span className="text-[10px] text-zinc-600">({t.source})</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metricas */}
        {Object.keys(metricas).length > 0 && (
          <div className="bg-zinc-900/60 rounded-xl p-4 mb-4 border border-zinc-800">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Metricas do Canal</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {metricas.subscribers && (
                <div className="bg-zinc-800/60 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-zinc-100">{metricas.subscribers}</div>
                  <div className="text-[10px] text-zinc-500 uppercase">Inscritos</div>
                </div>
              )}
              {metricas.avg_views && (
                <div className="bg-zinc-800/60 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-zinc-100">{metricas.avg_views}</div>
                  <div className="text-[10px] text-zinc-500 uppercase">Media Views</div>
                </div>
              )}
              {metricas.max_views && (
                <div className="bg-zinc-800/60 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-zinc-100">{metricas.max_views}</div>
                  <div className="text-[10px] text-zinc-500 uppercase">Maior Hit</div>
                </div>
              )}
              {metricas.total_videos && (
                <div className="bg-zinc-800/60 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-zinc-100">{metricas.total_videos}</div>
                  <div className="text-[10px] text-zinc-500 uppercase">Videos</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Insight */}
        {briefing.insight_estrategico && (
          <div className="bg-gradient-to-br from-green-500/5 to-blue-500/5 rounded-xl p-4 mb-4 border border-green-500/15">
            <h2 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2">Insight Estrategico</h2>
            <p className="text-sm text-zinc-300 leading-relaxed">{briefing.insight_estrategico}</p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6 border-t border-zinc-800/50 mt-4">
          <p className="text-[10px] text-zinc-600">Gerado por Jarbas - Orquestra | Metodo D.P.E. + B2B</p>
        </div>
      </div>
    </div>
  )
}
