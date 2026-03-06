import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''
const TOKEN = () => localStorage.getItem('orquestra_token')

const COLUMNS = [
  { key: 'ideia', label: 'Ideias', color: 'border-zinc-600', bg: 'bg-zinc-800/30' },
  { key: 'thumbnail_pronta', label: 'Thumb Pronta', color: 'border-blue-500/40', bg: 'bg-blue-900/10' },
  { key: 'pronto_gravar', label: 'Pronto p/ Gravar', color: 'border-green-500/40', bg: 'bg-green-900/10' },
  { key: 'publicado', label: 'Publicado', color: 'border-purple-500/40', bg: 'bg-purple-900/10' },
]

const STATUS_CONFIG = {
  ideia: { label: 'Ideia', color: 'bg-zinc-600 text-zinc-200' },
  thumbnail_pronta: { label: 'Thumb Pronta', color: 'bg-blue-500/20 text-blue-400' },
  pronto_gravar: { label: 'Pronto p/ Gravar', color: 'bg-green-500/20 text-green-400' },
  publicado: { label: 'Publicado', color: 'bg-purple-500/20 text-purple-400' },
}

/* ─── Full-screen detail for Diego (recording prep) ──────── */
function VideoDetailDiego({ video, index, briefingDate, onStatusChange, onClose }) {
  const [changing, setChanging] = useState(false)
  const status = video.status || 'ideia'
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.ideia
  const thumbnailUrl = video.thumbnail_file ? `${API_URL}/api/youtube/thumbnails/${video.thumbnail_file}` : null

  const urgenciaColors = {
    'ALTISSIMA': 'text-red-400 bg-red-500/15',
    'Alta': 'text-orange-400 bg-orange-500/15',
    'Media': 'text-yellow-400 bg-yellow-500/15',
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
    <div className="fixed inset-0 z-50 bg-zinc-950/98 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={onClose} className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Voltar ao Kanban
          </button>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${cfg.color}`}>{cfg.label}</span>
            {nextStatus[status] && (
              <button onClick={handleAdvance} disabled={changing}
                className="text-[11px] px-3 py-1 rounded-full bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-50 font-semibold">
                {changing ? '...' : `Mover: ${nextLabel[status]}`}
              </button>
            )}
          </div>
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
            {video.duracao && <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700/50 text-zinc-400">{video.duracao}</span>}
            {briefingDate && <span className="text-[10px] text-zinc-600">Briefing: {briefingDate}</span>}
          </div>
          <h1 className="text-2xl font-bold text-zinc-100 leading-tight">{video.chosen_title || video.title}</h1>

          {/* Alternativas de titulo */}
          {video.alternatives?.length > 0 && (
            <div className="mt-2">
              <span className="text-[10px] text-zinc-600">Alternativas: </span>
              {video.alternatives.map((alt, i) => (
                <span key={i} className="text-[10px] text-zinc-500">{i > 0 && ' | '}{alt}</span>
              ))}
            </div>
          )}

          {/* Quick stats */}
          <div className="flex items-center gap-4 mt-3 text-[11px] text-zinc-500">
            {video.potencial_views && <span>Potencial: <span className="text-zinc-300 font-medium">{video.potencial_views} views</span></span>}
            {video.potencial_b2b && <span>B2B: <span className="text-zinc-300 font-medium">{video.potencial_b2b}</span></span>}
            {video.duracao && <span>Duracao: <span className="text-zinc-300 font-medium">{video.duracao}</span></span>}
          </div>
        </div>

        {/* Thumbnail preview */}
        {thumbnailUrl && (
          <div className="mb-6 rounded-xl overflow-hidden border border-zinc-800">
            <img src={thumbnailUrl} alt="Thumbnail" className="w-full" />
          </div>
        )}

        {/* ─── SECTION: Hook (primeiros 30s) ─── */}
        {video.hook && (
          <Section title="Hook - Primeiros 30 Segundos" accent="amber">
            <div className="bg-amber-500/5 rounded-lg p-4 border-l-3 border-amber-500/50">
              <p className="text-sm text-amber-100 leading-relaxed italic">"{video.hook}"</p>
            </div>
            <p className="text-[10px] text-zinc-600 mt-2">Comece o video com essa paulada. NAO peca inscricao nos primeiros 30s.</p>
          </Section>
        )}

        {/* ─── SECTION: Roteiro Completo (3 Atos) ─── */}
        {video.roteiro && Object.keys(video.roteiro).length > 0 && (
          <Section title="Roteiro - Estrutura em Topicos" accent="green">
            <div className="space-y-3">
              {Object.entries(video.roteiro).map(([key, val]) => {
                const isProblema = key.toLowerCase().includes('problema') || key.includes('1')
                const isExecucao = key.toLowerCase().includes('execu') || key.includes('2')
                const isCTA = key.toLowerCase().includes('cta') || key.includes('3')
                const num = isProblema ? '1' : isExecucao ? '2' : isCTA ? '3' : ''
                const colorMap = { '1': 'text-red-400 bg-red-500/10 border-red-500/20', '2': 'text-blue-400 bg-blue-500/10 border-blue-500/20', '3': 'text-green-400 bg-green-500/10 border-green-500/20' }
                const color = colorMap[num] || 'text-zinc-400 bg-zinc-800/60 border-zinc-700/40'

                return (
                  <div key={key} className={`rounded-lg p-4 border ${color}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {num && <span className="text-lg font-bold leading-none">{num}</span>}
                      <span className="text-xs font-bold uppercase tracking-wider">{key}</span>
                      {isProblema && <span className="text-[9px] text-zinc-500">(30-60s)</span>}
                      {isExecucao && <span className="text-[9px] text-zinc-500">(10-20min)</span>}
                      {isCTA && <span className="text-[9px] text-zinc-500">(30-60s)</span>}
                    </div>
                    <p className="text-sm text-zinc-200 leading-relaxed">{val}</p>
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* ─── SECTION: O que mostrar no video (links) ─── */}
        <Section title="Links para Mostrar no Video" accent="blue">
          <div className="space-y-2">
            {video.keywords?.length > 0 && (
              <LinkItem icon="🔍" label="Pesquisar no Google" desc={video.keywords.slice(0, 3).join(', ')} url={`https://www.google.com/search?q=${encodeURIComponent(video.keywords[0])}`} />
            )}
            <LinkItem icon="📺" label="Canal GuyFolkz" desc="Mostrar outros videos relacionados" url="https://www.youtube.com/@guyfolkz" />
            {video.keywords?.some(k => k.toLowerCase().includes('n8n')) && (
              <LinkItem icon="🔧" label="N8N" desc="Mostrar workflows / documentacao" url="https://n8n.io" />
            )}
            {video.keywords?.some(k => k.toLowerCase().includes('claude') || k.toLowerCase().includes('anthropic')) && (
              <LinkItem icon="🤖" label="Claude AI" desc="Demonstrar na tela" url="https://claude.ai" />
            )}
            {video.keywords?.some(k => k.toLowerCase().includes('chatgpt') || k.toLowerCase().includes('openai')) && (
              <LinkItem icon="💬" label="ChatGPT" desc="Demonstrar na tela" url="https://chat.openai.com" />
            )}
            {video.keywords?.some(k => k.toLowerCase().includes('cursor')) && (
              <LinkItem icon="⌨️" label="Cursor IDE" desc="Mostrar na tela" url="https://cursor.sh" />
            )}
            <LinkItem icon="📱" label="WhatsApp B2B (CTA)" desc="Link na descricao para clientes" url="https://wa.me/555193448124" />
          </div>
          <p className="text-[10px] text-zinc-600 mt-3 italic">Abra essas abas ANTES de gravar para mostrar durante o video.</p>
        </Section>

        {/* ─── SECTION: Keywords e SEO ─── */}
        {video.keywords?.length > 0 && (
          <Section title="Keywords SEO - Descricao e Tags" accent="purple">
            <div className="flex flex-wrap gap-1.5">
              {video.keywords.map((kw, i) => (
                <span key={i} className="text-xs bg-purple-500/10 text-purple-300 px-2.5 py-1 rounded-md border border-purple-500/15 cursor-pointer hover:bg-purple-500/20 transition-colors"
                  onClick={() => navigator.clipboard.writeText(kw)}>
                  {kw}
                </span>
              ))}
            </div>
            <button onClick={() => navigator.clipboard.writeText(video.keywords.join(', '))}
              className="mt-3 text-[10px] text-purple-400 hover:text-purple-300 transition-colors">
              Copiar todas as keywords
            </button>
          </Section>
        )}

        {/* ─── SECTION: Thumbnail ─── */}
        <Section title="Thumbnail" accent="cyan">
          {thumbnailUrl ? (
            <div className="mb-3">
              <img src={thumbnailUrl} alt="Thumbnail" className="w-full max-w-md rounded-lg border border-zinc-700" />
              <p className="text-[10px] text-green-400 mt-1.5 font-medium">Thumbnail pronta (enviada pela Andriely)</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 mb-2">Andriely ainda nao enviou a thumbnail</p>
          )}
          {video.thumbnail_prompt && (
            <div className="bg-zinc-800/60 rounded-lg p-3">
              <label className="text-[10px] text-zinc-500 uppercase font-semibold">Descricao visual</label>
              <p className="text-xs text-zinc-400 mt-1">{video.thumbnail_prompt}</p>
            </div>
          )}
        </Section>

        {/* ─── SECTION: Checklist pre-gravacao ─── */}
        <Section title="Checklist Pre-Gravacao" accent="green">
          <div className="space-y-2">
            <CheckItem done={!!thumbnailUrl} label="Thumbnail pronta" />
            <CheckItem done={!!(video.chosen_title)} label={`Titulo definido: "${video.chosen_title || video.title}"`} />
            <CheckItem done={!!(video.hook)} label="Hook dos primeiros 30s definido" />
            <CheckItem done={!!(video.roteiro && Object.keys(video.roteiro).length > 0)} label="Roteiro com estrutura 3 atos" />
            <CheckItem done={!!(video.keywords?.length > 0)} label="Keywords SEO prontas" />
          </div>
        </Section>

        {/* ─── SECTION: CTA Padrao ─── */}
        <Section title="CTA Final do Video" accent="amber">
          <div className="bg-amber-500/5 rounded-lg p-4 border border-amber-500/15">
            <p className="text-sm text-amber-100 leading-relaxed">
              "Sua empresa esta perdendo dinheiro com processos manuais? Clica no link da descricao e me chama no WhatsApp para desenharmos uma automacao para o seu negocio."
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] text-zinc-500">Link WA:</span>
            <span className="text-[10px] text-green-400 font-mono">wa.me/555193448124</span>
            <button onClick={() => navigator.clipboard.writeText('https://wa.me/555193448124')}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 underline">copiar</button>
          </div>
        </Section>

        {/* ─── SECTION: Formato e potencial ─── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {video.formato && (
            <StatCard label="Formato" value={video.formato} />
          )}
          {video.duracao && (
            <StatCard label="Duracao" value={video.duracao} />
          )}
          {video.potencial_views && (
            <StatCard label="Potencial Views" value={video.potencial_views} />
          )}
          {video.potencial_b2b && (
            <StatCard label="Potencial B2B" value={video.potencial_b2b} />
          )}
        </div>

        {/* ─── Action buttons ─── */}
        <div className="flex gap-3 mt-6">
          {nextStatus[status] && (
            <button onClick={handleAdvance} disabled={changing}
              className="flex-1 py-3 bg-green-500/15 text-green-300 text-sm font-bold rounded-xl hover:bg-green-500/25 transition-colors disabled:opacity-50 border border-green-500/20">
              {changing ? '...' : `Mover para: ${nextLabel[status]}`}
            </button>
          )}
          {status === 'publicado' && (
            <div className="flex-1 py-3 bg-purple-500/10 text-purple-400 text-sm font-semibold rounded-xl border border-purple-500/20 text-center">
              Publicado
            </div>
          )}
        </div>

        <div className="h-12" />
      </div>
    </div>
  )
}

/* ─── Helper components ───────────────────────────────────── */

function Section({ title, accent = 'zinc', children }) {
  const accentColors = {
    amber: 'border-amber-500/20',
    green: 'border-green-500/20',
    blue: 'border-blue-500/20',
    purple: 'border-purple-500/20',
    cyan: 'border-cyan-500/20',
    zinc: 'border-zinc-800',
  }
  const titleColors = {
    amber: 'text-amber-400',
    green: 'text-green-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    cyan: 'text-cyan-400',
    zinc: 'text-zinc-400',
  }
  return (
    <div className={`bg-zinc-900/60 rounded-xl border ${accentColors[accent]} p-4 mb-4`}>
      <h3 className={`text-xs font-semibold ${titleColors[accent]} uppercase tracking-wider mb-3`}>{title}</h3>
      {children}
    </div>
  )
}

function LinkItem({ icon, label, desc, url }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 bg-zinc-800/60 rounded-lg p-3 hover:bg-zinc-800 transition-colors group">
      <span className="text-lg">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-blue-400 font-medium group-hover:text-blue-300">{label}</p>
        <p className="text-[10px] text-zinc-500 truncate">{desc}</p>
      </div>
      <svg className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  )
}

function CheckItem({ done, label }) {
  return (
    <div className={`flex items-center gap-2.5 p-2.5 rounded-lg ${done ? 'bg-green-500/5' : 'bg-zinc-800/40'}`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-green-500/20' : 'bg-zinc-700/50'}`}>
        {done ? (
          <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <div className="w-2 h-2 rounded-full bg-zinc-600" />
        )}
      </div>
      <span className={`text-xs ${done ? 'text-green-300' : 'text-zinc-500'}`}>{label}</span>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="bg-zinc-900/60 rounded-lg border border-zinc-800 p-3 text-center">
      <div className="text-sm font-bold text-zinc-200">{value}</div>
      <div className="text-[10px] text-zinc-500 uppercase mt-0.5">{label}</div>
    </div>
  )
}

/* ─── Kanban Card ─────────────────────────────────────────── */

function KanbanCard({ video, index, briefingDate, onStatusChange, onClick }) {
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

  async function handleAdvance(e) {
    e.stopPropagation()
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
    <div onClick={onClick}
      className="bg-zinc-800/60 rounded-lg border border-zinc-700/40 overflow-hidden cursor-pointer hover:border-zinc-600 hover:bg-zinc-800/80 transition-all">
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

/* ─── Main Kanban Page ────────────────────────────────────── */

export default function YouTubeKanban() {
  const [briefings, setBriefings] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeVideo, setActiveVideo] = useState(null) // { video, index, date } or null

  useEffect(() => {
    fetch(`${API_URL}/api/youtube/briefings?limit=10`, {
      headers: { 'Authorization': `Bearer ${TOKEN()}` }
    })
      .then(res => res.json())
      .then(async () => {
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
    // Also update activeVideo if open
    if (activeVideo && activeVideo.index === videoIndex) {
      setActiveVideo(prev => ({ ...prev, video: { ...prev.video, ...updatedVideo } }))
    }
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

  // Detail view
  if (activeVideo) {
    return (
      <VideoDetailDiego
        video={activeVideo.video}
        index={activeVideo.index}
        briefingDate={activeVideo.date}
        onStatusChange={handleStatusChange}
        onClose={() => setActiveVideo(null)}
      />
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
                {videos.map((v) => (
                  <KanbanCard
                    key={`${v.date}-${v.index}`}
                    video={v.video}
                    index={v.index}
                    briefingDate={v.date}
                    onStatusChange={handleStatusChange}
                    onClick={() => setActiveVideo(v)}
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
