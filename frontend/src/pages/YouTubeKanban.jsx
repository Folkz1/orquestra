import { useState, useEffect, useRef } from 'react'
import { getYouTubeWorkspace, publishYouTubeVideo, scheduleYouTubeVideo, uploadYouTubeVideo } from '../api'

const API_URL = import.meta.env.VITE_API_URL || ''
const TOKEN = () => localStorage.getItem('orquestra_token')

// Thumbnail: prefer base64 from DB (persists), fallback to file endpoint
function getThumbUrl(video) {
  if (video.thumbnail_data) return video.thumbnail_data
  if (video.thumbnail_file) return `${API_URL}/api/youtube/thumbnails/${video.thumbnail_file}`
  return null
}

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

/* ─── Gerar descricao do YouTube automaticamente ─────────── */
function gerarDescricaoYouTube(video) {
  // Se ja tem descricao manual/gerada, usar ela
  if (video.descricao_youtube) return video.descricao_youtube

  const title = video.chosen_title || video.title
  const keywords = video.keywords || []
  const roteiro = video.roteiro || {}
  const hookText = video.hook || ''

  // Construir descricao automatica
  let desc = ''

  // Intro baseada no hook
  if (hookText) {
    desc += hookText.replace(/^["']|["']$/g, '') + '\n\n'
  }

  // O que voce vai aprender
  const pontos = video.pontos_chave || []
  if (pontos.length > 0) {
    desc += 'Neste video voce vai ver:\n'
    pontos.forEach(p => { desc += `- ${p}\n` })
    desc += '\n'
  } else if (Object.keys(roteiro).length > 0) {
    desc += 'Neste video:\n'
    Object.entries(roteiro).forEach(([k, v]) => {
      desc += `- ${v.substring(0, 100)}${v.length > 100 ? '...' : ''}\n`
    })
    desc += '\n'
  }

  // Timestamps template
  desc += '---\n'
  desc += '00:00 - Intro\n'
  if (roteiro['Problema'] || roteiro['1-Problema']) desc += '00:30 - O Problema\n'
  if (roteiro['Execucao'] || roteiro['2-Execucao']) desc += '02:00 - Execucao na Pratica\n'
  if (roteiro['CTA'] || roteiro['3-CTA']) desc += 'XX:XX - Resultado + Proximo Passo\n'
  desc += '\n'

  // CTA B2B
  desc += '---\n'
  desc += 'Sua empresa perde dinheiro com processos manuais?\n'
  desc += 'Me chama no WhatsApp e vamos desenhar uma automacao pro seu negocio:\n'
  desc += 'https://wa.me/555193448124\n\n'

  // Links
  desc += '---\n'
  desc += 'Canal GuyFolkz: https://youtube.com/@guyfolkz\n'
  if (video.referencias?.length > 0) {
    video.referencias.forEach(ref => {
      if (ref.url) desc += `${ref.title || 'Link'}: ${ref.url}\n`
    })
  }
  desc += '\n'

  // Hashtags
  if (keywords.length > 0) {
    desc += keywords.map(k => `#${k.replace(/\s+/g, '').toLowerCase()}`).join(' ') + '\n'
  }

  return desc
}

/* ─── Tela completa de producao para Diego ───────────────── */
function VideoDetailDiego({ video, index, briefingDate, onStatusChange, onClose }) {
  const [changing, setChanging] = useState(false)
  const [copied, setCopied] = useState(null) // track which section was copied
  const [uploadState, setUploadState] = useState({ step: 'idle', progress: '', error: '', videoId: video.youtube_video_id || '' })
  const [scheduleDate, setScheduleDate] = useState('')
  const [teleprompter, setTeleprompter] = useState(false)
  const [teleSpeed, setTeleSpeed] = useState(2) // pixels per frame tick
  const [telePaused, setTelePaused] = useState(true)
  const [editingRoteiro, setEditingRoteiro] = useState(video.roteiro || {})
  const videoFileRef = useRef()
  const teleRef = useRef()
  const teleScrollRef = useRef(null)
  const status = video.status || 'ideia'
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.ideia
  const thumbnailUrl = getThumbUrl(video)

  const urgenciaColors = {
    'ALTISSIMA': 'text-red-400 bg-red-500/15',
    'Alta': 'text-orange-400 bg-orange-500/15',
    'Media': 'text-yellow-400 bg-yellow-500/15',
  }

  const nextStatus = { ideia: 'thumbnail_pronta', thumbnail_pronta: 'pronto_gravar', pronto_gravar: 'publicado' }
  const nextLabel = { ideia: 'Thumb Pronta', thumbnail_pronta: 'Pronto p/ Gravar', pronto_gravar: 'Publicado' }

  const descricaoYT = gerarDescricaoYouTube(video)
  const tagsYT = video.tags_youtube?.length > 0
    ? video.tags_youtube
    : (video.keywords || []).map(k => k.toLowerCase())

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

  function copyText(text, id) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  // Teleprompter auto-scroll
  useEffect(() => {
    if (!teleprompter || telePaused) {
      if (teleScrollRef.current) { cancelAnimationFrame(teleScrollRef.current); teleScrollRef.current = null }
      return
    }
    function tick() {
      if (teleRef.current) {
        teleRef.current.scrollTop += teleSpeed * 0.5
      }
      teleScrollRef.current = requestAnimationFrame(tick)
    }
    teleScrollRef.current = requestAnimationFrame(tick)
    return () => { if (teleScrollRef.current) cancelAnimationFrame(teleScrollRef.current) }
  }, [teleprompter, telePaused, teleSpeed])

  // Teleprompter keyboard: space=pause, up/down=speed
  useEffect(() => {
    if (!teleprompter) return
    function handleKey(e) {
      if (e.code === 'Space') { e.preventDefault(); setTelePaused(p => !p) }
      if (e.code === 'ArrowUp') { e.preventDefault(); setTeleSpeed(s => Math.min(s + 1, 10)) }
      if (e.code === 'ArrowDown') { e.preventDefault(); setTeleSpeed(s => Math.max(s - 1, 1)) }
      if (e.code === 'Escape') { setTeleprompter(false); setTelePaused(true) }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [teleprompter])

  // Build teleprompter text
  function buildTeleprompterText() {
    const parts = []
    const title = video.chosen_title || video.title
    parts.push(title.toUpperCase())
    parts.push('')
    if (video.hook) { parts.push('── HOOK (primeiros 30s) ──'); parts.push(video.hook); parts.push('') }
    if (video.pontos_chave?.length > 0) {
      parts.push('── O QUE FALAR ──')
      video.pontos_chave.forEach((p, i) => parts.push(`${i + 1}. ${p}`))
      parts.push('')
    }
    if (video.roteiro && Object.keys(video.roteiro).length > 0) {
      parts.push('── ROTEIRO ──')
      Object.entries(video.roteiro).forEach(([key, val]) => { parts.push(`[${key.toUpperCase()}]`); parts.push(val); parts.push('') })
    }
    if (video.dinamica) { parts.push('── DINAMICA ──'); parts.push(video.dinamica); parts.push('') }
    parts.push('── CTA FINAL ──')
    parts.push('Sua empresa esta perdendo dinheiro com processos manuais? Clica no link da descricao e me chama no WhatsApp.')
    return parts.join('\n')
  }

  // Teleprompter fullscreen mode
  if (teleprompter) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col">
        {/* Controls */}
        <div className="flex items-center justify-between px-6 py-3 bg-zinc-900/80 border-b border-zinc-800">
          <button onClick={() => { setTeleprompter(false); setTelePaused(true) }}
            className="text-zinc-400 hover:text-zinc-200 text-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Fechar Teleprompter
          </button>
          <div className="flex items-center gap-4">
            <button onClick={() => setTelePaused(p => !p)}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${telePaused ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {telePaused ? '▶ Play' : '⏸ Pausar'}
            </button>
            <div className="flex items-center gap-2 text-zinc-400 text-xs">
              <span>Velocidade:</span>
              <button onClick={() => setTeleSpeed(s => Math.max(s - 1, 1))} className="w-6 h-6 bg-zinc-800 rounded hover:bg-zinc-700 flex items-center justify-center">-</button>
              <span className="text-zinc-200 font-bold w-4 text-center">{teleSpeed}</span>
              <button onClick={() => setTeleSpeed(s => Math.min(s + 1, 10))} className="w-6 h-6 bg-zinc-800 rounded hover:bg-zinc-700 flex items-center justify-center">+</button>
            </div>
            <span className="text-[10px] text-zinc-600">Space=pausar | ↑↓=velocidade | Esc=fechar</span>
          </div>
        </div>
        {/* Content */}
        <div ref={teleRef} className="flex-1 overflow-y-auto px-8 sm:px-16 md:px-32">
          {/* Top spacer so text starts at center */}
          <div className="h-[45vh]" />
          <div className="text-2xl sm:text-3xl md:text-4xl text-zinc-100 leading-relaxed font-medium whitespace-pre-line text-center max-w-3xl mx-auto">
            {buildTeleprompterText()}
          </div>
          {/* Bottom spacer */}
          <div className="h-[80vh]" />
        </div>
        {/* Center line indicator */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-red-500/30 pointer-events-none" />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-zinc-950/98 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6 sticky top-0 bg-zinc-950/95 backdrop-blur-sm py-3 -mx-4 px-4 z-10 border-b border-zinc-800/50">
          <button onClick={onClose} className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Kanban
          </button>
          <div className="flex items-center gap-2">
            {/* Teleprompter button */}
            <button onClick={() => { setTeleprompter(true); setTelePaused(true) }}
              className="text-[11px] px-3 py-1 rounded-full bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors font-semibold">
              Teleprompter
            </button>
            <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${cfg.color}`}>{cfg.label}</span>
            {nextStatus[status] && (
              <button onClick={handleAdvance} disabled={changing}
                className="text-[11px] px-3 py-1 rounded-full bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-50 font-semibold">
                {changing ? '...' : `Mover: ${nextLabel[status]}`}
              </button>
            )}
          </div>
        </div>

        {/* ═══ HEADER ═══ */}
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
            {briefingDate && <span className="text-[10px] text-zinc-600">Briefing {briefingDate}</span>}
          </div>
          <h1 className="text-2xl font-bold text-zinc-100 leading-tight mb-1">{video.chosen_title || video.title}</h1>
          {video.alternatives?.length > 0 && (
            <p className="text-[11px] text-zinc-500">Alt: {video.alternatives.join(' | ')}</p>
          )}
          <div className="flex items-center gap-4 mt-2 text-[11px] text-zinc-500">
            {video.potencial_views && <span>~{video.potencial_views} views</span>}
            {video.potencial_b2b && <span>B2B: {video.potencial_b2b}</span>}
            {video.duracao && <span>{video.duracao}</span>}
          </div>
        </div>

        {/* Thumbnail */}
        {thumbnailUrl && (
          <div className="mb-6 rounded-xl overflow-hidden border border-zinc-800">
            <img src={thumbnailUrl} alt="Thumbnail" className="w-full" />
          </div>
        )}

        {/* ═══ 1. BRIEFING DO ASSUNTO ═══ */}
        <Section title="Briefing do Assunto" subtitle="O que e, por que importa agora" accent="amber" num="1">
          {video.contexto ? (
            <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-line">{video.contexto}</p>
          ) : (
            <div className="space-y-2">
              {video.hook && (
                <div className="bg-amber-500/5 rounded-lg p-3 border-l-2 border-amber-500/40">
                  <p className="text-sm text-zinc-200 leading-relaxed italic">"{video.hook}"</p>
                </div>
              )}
              {video.roteiro && Object.values(video.roteiro)[0] && (
                <p className="text-sm text-zinc-400 leading-relaxed">{Object.values(video.roteiro)[0]}</p>
              )}
              {!video.hook && !video.roteiro && (
                <p className="text-xs text-zinc-600 italic">Contexto sera gerado no proximo briefing</p>
              )}
            </div>
          )}
        </Section>

        {/* ═══ 2. O QUE FALAR ═══ */}
        <Section title="O Que Falar" subtitle="Pontos-chave para mencionar durante o video" accent="green" num="2">
          {video.pontos_chave?.length > 0 ? (
            <div className="space-y-2">
              {video.pontos_chave.map((ponto, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <span className="text-green-500 font-bold text-sm mt-0.5 flex-shrink-0">{i + 1}.</span>
                  <p className="text-sm text-zinc-200 leading-relaxed">{ponto}</p>
                </div>
              ))}
            </div>
          ) : (
            /* Fallback: extrair do roteiro */
            <div className="space-y-2">
              {video.roteiro && Object.entries(video.roteiro).map(([key, val]) => (
                <div key={key} className="flex gap-3 items-start">
                  <span className="text-green-500 font-bold text-xs mt-1 flex-shrink-0 uppercase">{key.replace(/^\d+-?/, '')}</span>
                  <p className="text-sm text-zinc-200 leading-relaxed">{val}</p>
                </div>
              ))}
              {(!video.roteiro || Object.keys(video.roteiro).length === 0) && (
                <p className="text-xs text-zinc-600 italic">Pontos-chave serao gerados no proximo briefing</p>
              )}
            </div>
          )}
        </Section>

        {/* ═══ 3. HOOK (primeiros 30s) ═══ */}
        {video.hook && (
          <Section title="Hook - Primeiros 30 Segundos" subtitle="Comece o video com essa fala. NAO peca inscricao." accent="red" num="3">
            <div className="bg-red-500/5 rounded-lg p-4 border border-red-500/15 relative">
              <p className="text-base text-red-100 leading-relaxed font-medium pr-16">"{video.hook}"</p>
              <CopyBtn text={video.hook} id="hook" copied={copied} onCopy={copyText} />
            </div>
          </Section>
        )}

        {/* ═══ 3.5 EDITAR ROTEIRO ═══ */}
        <Section title="Editar Roteiro" subtitle="Preencha os 3 atos do video (ou deixe em branco para IA gerar)" accent="indigo" num="3.5">
          <div className="space-y-3">
            {['Problema', 'Execução', 'CTA'].map((label, i) => (
              <div key={label}>
                <label className="text-xs font-semibold text-zinc-300 mb-1 block">
                  {i + 1}. {label}
                  {label === 'Problema' && <span className="text-zinc-600 ml-1">(0:00 - 0:30)</span>}
                  {label === 'Execução' && <span className="text-zinc-600 ml-1">(0:30 - 15:00+)</span>}
                  {label === 'CTA' && <span className="text-zinc-600 ml-1">(Final)</span>}
                </label>
                <textarea
                  value={editingRoteiro?.[label] || editingRoteiro?.[`${i+1}-${label}`] || ''}
                  placeholder={`Descreva o que acontece nesta parte...`}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none resize-none"
                  rows="3"
                  onChange={(e) => {
                    const updated = { ...editingRoteiro || {} }
                    updated[label] = e.target.value
                    setEditingRoteiro(updated)
                  }}
                />
              </div>
            ))}
            <button
              onClick={async () => {
                const form = new FormData()
                form.append('roteiro', JSON.stringify(editingRoteiro || {}))
                try {
                  const res = await fetch(`${API_URL}/api/youtube/briefings/latest/videos/${index}`, {
                    method: 'PATCH',
                    body: form
                  })
                  const data = await res.json()
                  if (data.ok) {
                    onStatusChange(index, data.video)
                    alert('Roteiro salvo com sucesso!')
                  }
                } catch (e) {
                  console.error(e)
                  alert('Erro ao salvar roteiro')
                }
              }}
              className="mt-2 w-full px-3 py-2 bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 rounded-lg text-sm font-semibold transition-colors"
            >
              💾 Salvar Roteiro
            </button>
          </div>
        </Section>

        {/* ═══ 4. ROTEIRO - ESTRUTURA DO VIDEO ═══ */}
        {video.roteiro && Object.keys(video.roteiro).length > 0 && (
          <Section title="Roteiro - Estrutura Completa" subtitle="Os 3 atos do video com tempos sugeridos" accent="blue" num="4">
            <div className="space-y-3">
              {Object.entries(video.roteiro).map(([key, val]) => {
                const isProblema = key.toLowerCase().includes('problema') || key.startsWith('1')
                const isExecucao = key.toLowerCase().includes('execu') || key.startsWith('2')
                const isCTA = key.toLowerCase().includes('cta') || key.startsWith('3')

                const config = isProblema
                  ? { num: '1', label: 'PROBLEMA', time: '0:00 - 0:30', icon: 'bg-red-500/15 text-red-400 border-red-500/20', desc: 'Fale pra camera. Contextualize a dor.' }
                  : isExecucao
                  ? { num: '2', label: 'EXECUCAO', time: '0:30 - 15:00+', icon: 'bg-blue-500/15 text-blue-400 border-blue-500/20', desc: 'Mostre a tela. Foque na logica de NEGOCIO.' }
                  : isCTA
                  ? { num: '3', label: 'CTA + RESULTADO', time: 'Final', icon: 'bg-green-500/15 text-green-400 border-green-500/20', desc: 'Volte pra camera. Mostre resultado e mande pro WhatsApp.' }
                  : { num: '', label: key, time: '', icon: 'bg-zinc-700/50 text-zinc-400 border-zinc-700', desc: '' }

                return (
                  <div key={key} className={`rounded-lg border ${config.icon} overflow-hidden`}>
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-inherit">
                      {config.num && <span className="text-lg font-black">{config.num}</span>}
                      <span className="text-xs font-bold uppercase tracking-wider">{config.label}</span>
                      {config.time && <span className="text-[10px] opacity-60 ml-auto">{config.time}</span>}
                    </div>
                    <div className="px-4 py-3">
                      {config.desc && <p className="text-[10px] text-zinc-500 mb-2 italic">{config.desc}</p>}
                      <p className="text-sm text-zinc-200 leading-relaxed">{val}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* ═══ 5. DINAMICA DO VIDEO ═══ */}
        {video.dinamica && (
          <Section title="Dinamica de Producao" subtitle="Como conduzir: camera, tela, transicoes" accent="purple" num="5">
            <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-line">{video.dinamica}</p>
          </Section>
        )}

        {/* Dinamica fallback quando nao tem o campo */}
        {!video.dinamica && video.roteiro && Object.keys(video.roteiro).length > 0 && (
          <Section title="Dinamica Sugerida" subtitle="Baseado no roteiro 3 atos B2B" accent="purple" num="5">
            <div className="space-y-2 text-sm text-zinc-300">
              <div className="flex gap-2 items-start">
                <span className="text-purple-400 flex-shrink-0">1.</span>
                <p><strong className="text-zinc-100">Camera</strong> - Comece olhando pra camera. Fale o hook com energia. Crie tensao.</p>
              </div>
              <div className="flex gap-2 items-start">
                <span className="text-purple-400 flex-shrink-0">2.</span>
                <p><strong className="text-zinc-100">Tela</strong> - Mostre a ferramenta/codigo/fluxo. Foque na logica de negocio, nao em cada detalhe tecnico. Empresario precisa entender o VALOR.</p>
              </div>
              <div className="flex gap-2 items-start">
                <span className="text-purple-400 flex-shrink-0">3.</span>
                <p><strong className="text-zinc-100">Camera</strong> - Volte pra camera no final. Mostre o resultado. CTA pro WhatsApp. NAO peca inscricao.</p>
              </div>
            </div>
          </Section>
        )}

        {/* ═══ 6. REFERENCIAS E LINKS ═══ */}
        <Section title="Referencias e Links" subtitle="Abrir ANTES de gravar para mostrar na tela" accent="cyan" num="6">
          <div className="space-y-2">
            {/* Referencias do briefing */}
            {video.referencias?.length > 0 && video.referencias.map((ref, i) => (
              <LinkItem key={i} icon="📎" label={ref.title || ref.url} desc={ref.nota || ''} url={ref.url} />
            ))}

            {/* Links inteligentes baseados nas keywords */}
            {video.keywords?.length > 0 && (
              <LinkItem icon="🔍" label={`Google: ${video.keywords[0]}`} desc="Pesquisar para mostrar na tela"
                url={`https://www.google.com/search?q=${encodeURIComponent(video.keywords[0])}`} />
            )}
            <LinkItem icon="📺" label="Canal GuyFolkz" desc="Mostrar videos relacionados" url="https://www.youtube.com/@guyfolkz" />

            {/* Links contextuais */}
            {hasKeyword(video, 'n8n') && <LinkItem icon="🔧" label="N8N" desc="Mostrar workflow" url="https://n8n.io" />}
            {hasKeyword(video, 'claude') && <LinkItem icon="🤖" label="Claude" desc="Demonstrar" url="https://claude.ai" />}
            {hasKeyword(video, 'chatgpt', 'openai', 'gpt') && <LinkItem icon="💬" label="ChatGPT" desc="Demonstrar" url="https://chat.openai.com" />}
            {hasKeyword(video, 'cursor') && <LinkItem icon="⌨️" label="Cursor" desc="Mostrar IDE" url="https://cursor.sh" />}
            {hasKeyword(video, 'github', 'copilot') && <LinkItem icon="🐙" label="GitHub" desc="Mostrar repo/copilot" url="https://github.com" />}
            {hasKeyword(video, 'make', 'zapier') && <LinkItem icon="⚡" label="Make/Zapier" desc="Comparar com N8N" url="https://www.make.com" />}
            {hasKeyword(video, 'supabase') && <LinkItem icon="🗄️" label="Supabase" desc="Mostrar dashboard" url="https://supabase.com" />}
            {hasKeyword(video, 'licitac') && <LinkItem icon="📜" label="PNCP" desc="Portal licitacoes" url="https://pncp.gov.br" />}

            <LinkItem icon="📱" label="WhatsApp B2B" desc="CTA final - link da descricao" url="https://wa.me/555193448124" />
          </div>
        </Section>

        {/* ═══ 7. KEYWORDS SEO ═══ */}
        {video.keywords?.length > 0 && (
          <Section title="Keywords SEO" subtitle="Para descricao, tags e hashtags" accent="zinc" num="7">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {video.keywords.map((kw, i) => (
                <span key={i} onClick={() => copyText(kw, `kw-${i}`)}
                  className="text-xs bg-zinc-800 text-zinc-300 px-2.5 py-1 rounded-md border border-zinc-700/50 cursor-pointer hover:bg-zinc-700 hover:text-zinc-100 transition-colors">
                  {kw}
                </span>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => copyText(video.keywords.join(', '), 'all-kw')}
                className={`text-[10px] px-3 py-1.5 rounded-lg transition-colors ${copied === 'all-kw' ? 'bg-green-500/15 text-green-400' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {copied === 'all-kw' ? 'Copiado!' : 'Copiar keywords'}
              </button>
              <button onClick={() => copyText(tagsYT.join(', '), 'tags')}
                className={`text-[10px] px-3 py-1.5 rounded-lg transition-colors ${copied === 'tags' ? 'bg-green-500/15 text-green-400' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {copied === 'tags' ? 'Copiado!' : 'Copiar tags YouTube'}
              </button>
            </div>
          </Section>
        )}

        {/* ═══ 8. DESCRICAO DO YOUTUBE (pronta) ═══ */}
        <Section title="Descricao do YouTube" subtitle="Copiar e colar direto na publicacao" accent="red" num="8">
          <div className="bg-zinc-800/80 rounded-lg p-4 border border-zinc-700/50 relative">
            <pre className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap font-sans">{descricaoYT}</pre>
            <CopyBtn text={descricaoYT} id="desc" copied={copied} onCopy={copyText} />
          </div>
        </Section>

        {/* ═══ 9. TITULO (pronto) ═══ */}
        <Section title="Titulo para Publicacao" subtitle="Copiar direto pro YouTube" accent="amber" num="9">
          <div className="bg-zinc-800/80 rounded-lg p-4 border border-zinc-700/50 relative">
            <p className="text-lg text-zinc-100 font-bold pr-16">{video.chosen_title || video.title}</p>
            <CopyBtn text={video.chosen_title || video.title} id="title" copied={copied} onCopy={copyText} />
          </div>
          {video.alternatives?.length > 0 && (
            <div className="mt-2 space-y-1">
              {video.alternatives.map((alt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-600">Alt {i + 1}:</span>
                  <span className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-200" onClick={() => copyText(alt, `alt-${i}`)}>
                    {alt}
                  </span>
                  {copied === `alt-${i}` && <span className="text-[9px] text-green-400">copiado</span>}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ═══ 10. CHECKLIST ═══ */}
        <Section title="Checklist" subtitle="Tudo pronto antes de gravar?" accent="green" num="10">
          <div className="space-y-1.5">
            <CheckItem done={!!thumbnailUrl} label="Thumbnail recebida da Andriely" />
            <CheckItem done={!!(video.chosen_title)} label="Titulo final definido" />
            <CheckItem done={!!(video.hook)} label="Hook dos primeiros 30s" />
            <CheckItem done={!!(video.roteiro && Object.keys(video.roteiro).length > 0)} label="Roteiro 3 atos" />
            <CheckItem done={!!(video.contexto || video.hook)} label="Briefing do assunto" />
            <CheckItem done={!!(video.keywords?.length > 0)} label="Keywords SEO" />
            <CheckItem done={true} label="CTA WhatsApp B2B" />
            <CheckItem done={true} label="Descricao do YouTube gerada" />
          </div>
        </Section>

        {/* ═══ 11. PUBLICAR NO YOUTUBE ═══ */}
        <Section title="Publicar no YouTube" subtitle="Upload, agendar ou publicar direto" accent="red" num="11">
          {uploadState.videoId ? (
            /* Vídeo já uploaded - opções de agendar/publicar */
            <div className="space-y-3">
              <div className="bg-green-500/10 rounded-lg p-3 border border-green-500/20">
                <p className="text-xs text-green-400 font-semibold">Video enviado ao YouTube</p>
                <a href={`https://www.youtube.com/watch?v=${uploadState.videoId}`} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-green-300 hover:text-green-200 underline">
                  youtube.com/watch?v={uploadState.videoId}
                </a>
              </div>

              {/* Agendar */}
              <div className="bg-zinc-800/60 rounded-lg p-3">
                <label className="text-[10px] text-zinc-500 uppercase font-semibold block mb-2">Agendar publicacao</label>
                <div className="flex gap-2">
                  <input type="datetime-local" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
                    className="flex-1 px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500" />
                  <button onClick={async () => {
                    if (!scheduleDate) return
                    setUploadState(s => ({ ...s, step: 'scheduling' }))
                    try {
                      const isoDate = new Date(scheduleDate).toISOString()
                      await scheduleYouTubeVideo(uploadState.videoId, isoDate)
                      setUploadState(s => ({ ...s, step: 'scheduled', progress: `Agendado para ${scheduleDate}` }))
                      // Salvar youtube_video_id e status no briefing
                      const form = new FormData()
                      form.append('status', 'publicado')
                      await fetch(`${API_URL}/api/youtube/briefings/latest/videos/${index}`, { method: 'PATCH', body: form })
                      onStatusChange(index, { ...video, status: 'publicado', youtube_video_id: uploadState.videoId })
                    } catch (e) {
                      setUploadState(s => ({ ...s, step: 'error', error: e.message }))
                    }
                  }} disabled={uploadState.step === 'scheduling' || !scheduleDate}
                    className="px-4 py-2 bg-amber-500/15 text-amber-300 text-sm font-semibold rounded-lg hover:bg-amber-500/25 transition-colors disabled:opacity-50">
                    {uploadState.step === 'scheduling' ? '...' : 'Agendar'}
                  </button>
                </div>
              </div>

              {/* Publicar agora */}
              <button onClick={async () => {
                if (!confirm('Publicar o video AGORA no YouTube?')) return
                setUploadState(s => ({ ...s, step: 'publishing' }))
                try {
                  await publishYouTubeVideo(uploadState.videoId)
                  setUploadState(s => ({ ...s, step: 'published', progress: 'Video publicado!' }))
                  const form = new FormData()
                  form.append('status', 'publicado')
                  await fetch(`${API_URL}/api/youtube/briefings/latest/videos/${index}`, { method: 'PATCH', body: form })
                  onStatusChange(index, { ...video, status: 'publicado', youtube_video_id: uploadState.videoId })
                } catch (e) {
                  setUploadState(s => ({ ...s, step: 'error', error: e.message }))
                }
              }} disabled={uploadState.step === 'publishing'}
                className="w-full py-3 bg-red-500/15 text-red-300 text-sm font-bold rounded-lg hover:bg-red-500/25 transition-colors disabled:opacity-50 border border-red-500/20">
                {uploadState.step === 'publishing' ? 'Publicando...' : 'Publicar Agora (publico)'}
              </button>

              {uploadState.step === 'scheduled' && (
                <p className="text-xs text-green-400 text-center">{uploadState.progress}</p>
              )}
              {uploadState.step === 'published' && (
                <p className="text-xs text-green-400 text-center font-bold">Video PUBLICO no YouTube!</p>
              )}
            </div>
          ) : (
            /* Upload do video */
            <div className="space-y-3">
              <input ref={videoFileRef} type="file" accept="video/*" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setUploadState({ step: 'uploading', progress: `Enviando ${file.name} (${(file.size / 1024 / 1024).toFixed(0)}MB)...`, error: '', videoId: '' })

                const title = video.chosen_title || video.title
                const tags = video.tags_youtube?.length > 0 ? video.tags_youtube : (video.keywords || [])

                const form = new FormData()
                form.append('file', file)
                form.append('title', title)
                form.append('description', descricaoYT)
                form.append('tags', JSON.stringify(tags))
                form.append('category_id', '28')
                form.append('privacy_status', 'private')

                // Enviar thumbnail junto se existir
                if (thumbnailUrl && video.thumbnail_data) {
                  try {
                    const resp = await fetch(video.thumbnail_data)
                    const blob = await resp.blob()
                    form.append('thumbnail', blob, 'thumbnail.png')
                  } catch {} // best effort
                }

                try {
                  const result = await uploadYouTubeVideo(form)
                  const vid = result?.data?.video_id || result?.video_id
                  if (vid) {
                    setUploadState({ step: 'uploaded', progress: 'Upload completo!', error: '', videoId: vid })
                    // Salvar youtube_video_id no briefing
                    const patchForm = new FormData()
                    patchForm.append('youtube_video_id', vid)
                    fetch(`${API_URL}/api/youtube/briefings/latest/videos/${index}`, { method: 'PATCH', body: patchForm }).catch(() => {})
                  } else {
                    setUploadState(s => ({ ...s, step: 'error', error: 'Resposta sem video_id' }))
                  }
                } catch (err) {
                  setUploadState(s => ({ ...s, step: 'error', error: err.message || 'Erro no upload' }))
                }
              }} />

              <button onClick={() => videoFileRef.current?.click()} disabled={uploadState.step === 'uploading'}
                className="w-full py-4 bg-red-500/10 text-red-300 rounded-xl border-2 border-dashed border-red-500/20 hover:border-red-500/40 hover:bg-red-500/15 transition-all disabled:opacity-50 flex flex-col items-center gap-2">
                {uploadState.step === 'uploading' ? (
                  <>
                    <span className="w-6 h-6 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                    <span className="text-sm font-semibold">{uploadState.progress}</span>
                  </>
                ) : (
                  <>
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <span className="text-sm font-bold">Selecionar Video (.mp4)</span>
                    <span className="text-[10px] text-zinc-500">Envia como privado, depois voce agenda ou publica</span>
                  </>
                )}
              </button>
            </div>
          )}

          {uploadState.error && (
            <div className="mt-2 bg-red-500/10 rounded-lg p-2 border border-red-500/20">
              <p className="text-xs text-red-400">{uploadState.error}</p>
            </div>
          )}
        </Section>

        {/* ═══ CTA PADRAO ═══ */}
        <div className="bg-gradient-to-r from-amber-500/5 to-green-500/5 rounded-xl border border-amber-500/15 p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider">CTA Final (falar no video)</h3>
            <CopyBtn text="Sua empresa esta perdendo dinheiro com processos manuais? Clica no link da descricao e me chama no WhatsApp para desenharmos uma automacao para o seu negocio." id="cta" copied={copied} onCopy={copyText} />
          </div>
          <p className="text-sm text-amber-100 leading-relaxed italic">
            "Sua empresa esta perdendo dinheiro com processos manuais? Clica no link da descricao e me chama no WhatsApp para desenharmos uma automacao para o seu negocio."
          </p>
          <p className="text-[10px] text-zinc-500 mt-2">wa.me/555193448124</p>
        </div>

        {/* Action */}
        {nextStatus[status] && (
          <button onClick={handleAdvance} disabled={changing}
            className="w-full py-3.5 bg-green-500/15 text-green-300 text-sm font-bold rounded-xl hover:bg-green-500/25 transition-colors disabled:opacity-50 border border-green-500/20 mb-4">
            {changing ? '...' : `Mover para: ${nextLabel[status]}`}
          </button>
        )}
        {status === 'publicado' && (
          <div className="w-full py-3 bg-purple-500/10 text-purple-400 text-sm font-semibold rounded-xl border border-purple-500/20 text-center mb-4">
            Publicado
          </div>
        )}

        <div className="h-12" />
      </div>
    </div>
  )
}

/* ─── Helpers ─────────────────────────────────────────────── */

function hasKeyword(video, ...terms) {
  const all = (video.keywords || []).join(' ').toLowerCase() + ' ' + (video.title || '').toLowerCase()
  return terms.some(t => all.includes(t.toLowerCase()))
}

function Section({ title, subtitle, accent = 'zinc', num, children }) {
  const border = {
    amber: 'border-amber-500/20', green: 'border-green-500/20', blue: 'border-blue-500/20',
    purple: 'border-purple-500/20', cyan: 'border-cyan-500/20', red: 'border-red-500/20', zinc: 'border-zinc-800',
  }
  const titleColor = {
    amber: 'text-amber-400', green: 'text-green-400', blue: 'text-blue-400',
    purple: 'text-purple-400', cyan: 'text-cyan-400', red: 'text-red-400', zinc: 'text-zinc-400',
  }
  return (
    <div className={`bg-zinc-900/60 rounded-xl border ${border[accent]} p-4 mb-4`}>
      <div className="flex items-center gap-2 mb-3">
        {num && <span className={`text-[10px] ${titleColor[accent]} font-bold bg-zinc-800 w-5 h-5 rounded-full flex items-center justify-center`}>{num}</span>}
        <div>
          <h3 className={`text-xs font-semibold ${titleColor[accent]} uppercase tracking-wider`}>{title}</h3>
          {subtitle && <p className="text-[10px] text-zinc-600">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

function CopyBtn({ text, id, copied, onCopy }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onCopy(text, id) }}
      className={`absolute top-3 right-3 text-[10px] px-2 py-1 rounded transition-colors ${
        copied === id ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-600'
      }`}>
      {copied === id ? 'Copiado!' : 'Copiar'}
    </button>
  )
}

function LinkItem({ icon, label, desc, url }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 bg-zinc-800/60 rounded-lg p-3 hover:bg-zinc-800 transition-colors group">
      <span className="text-lg flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-cyan-400 font-medium group-hover:text-cyan-300 truncate">{label}</p>
        {desc && <p className="text-[10px] text-zinc-500 truncate">{desc}</p>}
      </div>
      <svg className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  )
}

function CheckItem({ done, label }) {
  return (
    <div className={`flex items-center gap-2.5 p-2 rounded-lg ${done ? 'bg-green-500/5' : 'bg-zinc-800/40'}`}>
      <div className={`w-4.5 h-4.5 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-green-500/20' : 'bg-zinc-700/50'}`}>
        {done ? (
          <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />}
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

function WorkspaceMetric({ label, value, sub, tone = 'zinc' }) {
  const tones = {
    zinc: 'text-zinc-100',
    red: 'text-red-400',
    amber: 'text-amber-400',
    green: 'text-green-400',
    blue: 'text-blue-400',
  }

  return (
    <div className="bg-zinc-900/60 rounded-xl border border-zinc-800 p-3">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`text-xl font-bold mt-1 ${tones[tone] || tones.zinc}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-500 mt-1">{sub}</p>}
    </div>
  )
}

function StrategySeriesCard({ series }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">{series.content_role}</p>
          <h3 className="text-base font-bold text-zinc-100 mt-1">{series.name}</h3>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-amber-500/10 text-amber-400">{series.cadence}</span>
      </div>
      <p className="text-sm text-zinc-300 leading-relaxed">{series.summary}</p>
      <div className="grid grid-cols-3 gap-2 mt-4">
        <StatCard label="Pipeline" value={series.ideas_in_pipeline || 0} />
        <StatCard label="Planejados" value={series.episodes_planned || 0} />
        <StatCard label="Serie" value={series.episodes_total || 0} />
      </div>
      {series.next_episode?.title && (
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Proximo episodio</p>
          <p className="text-sm text-zinc-200 mt-1">{series.next_episode.title}</p>
        </div>
      )}
    </div>
  )
}

function IdeaLaneCard({ lane }) {
  const ideas = lane.ideas || []
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Serie</p>
          <h3 className="text-base font-bold text-zinc-100">{lane.series}</h3>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-zinc-800 text-zinc-400">{ideas.length} ideias</span>
      </div>
      {lane.objective && <p className="text-xs text-zinc-500 mb-3">{lane.objective}</p>}
      <div className="space-y-2">
        {ideas.slice(0, 4).map((idea, index) => (
          <div key={`${lane.series}-${index}`} className="rounded-lg bg-zinc-950/70 border border-zinc-800 p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">{idea.status || 'seed'}</span>
              {idea.urgency && <span className="text-[10px] text-amber-400">{idea.urgency}</span>}
            </div>
            <p className="text-sm text-zinc-200 leading-snug">{idea.title}</p>
            {idea.hook && <p className="text-[11px] text-zinc-500 mt-2 line-clamp-2">{idea.hook}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Kanban Card ─────────────────────────────────────────── */

function PlaybookList({ title, items = [], tone = 'amber' }) {
  const toneClass = {
    amber: 'text-amber-400 border-amber-500/20 bg-amber-500/5',
    blue: 'text-blue-400 border-blue-500/20 bg-blue-500/5',
    green: 'text-green-400 border-green-500/20 bg-green-500/5',
  }

  if (!items.length) return null

  return (
    <div className={`rounded-xl border p-4 ${toneClass[tone] || toneClass.amber}`}>
      <p className="text-[10px] uppercase tracking-wider mb-3">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item, index) => (
          <span key={`${title}-${index}`} className="text-[11px] px-2.5 py-1 rounded-full bg-zinc-950/70 border border-zinc-800 text-zinc-300">
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

function KanbanCard({ video, index, briefingDate, onStatusChange, onClick }) {
  const [changing, setChanging] = useState(false)
  const status = video.status || 'ideia'
  const thumbnailUrl = getThumbUrl(video)

  const urgenciaColors = {
    'ALTISSIMA': 'bg-red-500/15 text-red-400',
    'Alta': 'bg-orange-500/15 text-orange-400',
    'Media': 'bg-yellow-500/15 text-yellow-400',
  }

  const nextStatus = { ideia: 'thumbnail_pronta', thumbnail_pronta: 'pronto_gravar', pronto_gravar: 'publicado' }
  const nextLabel = { ideia: 'Thumb Pronta', thumbnail_pronta: 'Pronto p/ Gravar', pronto_gravar: 'Publicado' }

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
  const [activeVideo, setActiveVideo] = useState(null)
  const [workspace, setWorkspace] = useState(null)

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/api/youtube/briefings/latest`)
        .then(res => res.json())
        .catch(() => ({ briefing: null })),
      getYouTubeWorkspace().catch(() => null),
    ])
      .then(([data, workspaceData]) => {
        setBriefings(data?.briefing ? [data.briefing] : [])
        if (workspaceData?.status === 'ok') {
          setWorkspace(workspaceData.data || null)
        }
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
    if (activeVideo && activeVideo.index === videoIndex) {
      setActiveVideo(prev => ({ ...prev, video: { ...prev.video, ...updatedVideo } }))
    }
  }

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
          <h1 className="text-xl font-bold text-zinc-100">YouTube Workspace</h1>
          <p className="text-xs text-zinc-500 mt-1">{allVideos.length} videos no pipeline</p>
        </div>
        <a href="/youtube-briefing" target="_blank" rel="noopener noreferrer"
          className="text-xs bg-red-500/15 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/25 transition-colors">
          Abrir Briefing Andriely
        </a>
      </div>

      {workspace && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
            <div className="xl:col-span-2 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Sistema Editorial</p>
                  <h2 className="text-lg font-bold text-zinc-100 mt-1">{workspace.strategy?.north_star || 'YouTube como topo de funil B2B'}</h2>
                  <p className="text-sm text-zinc-400 mt-2 max-w-2xl">{workspace.strategy?.positioning}</p>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-amber-500">Meta</p>
                  <p className="text-sm font-semibold text-amber-300">{workspace.strategy?.goal || 'Motor 100K'}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(workspace.series_health || []).map(series => (
                  <StrategySeriesCard key={series.name} series={series} />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Diagnostico do Canal</p>
                  <h2 className="text-lg font-bold text-zinc-100 mt-1">{workspace.channel_audit?.stage || 'Canal em crescimento'}</h2>
                </div>
                {workspace.channel_audit?.warning && <span className="text-[10px] text-amber-400">fallback</span>}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <WorkspaceMetric label="Inscritos" value={workspace.channel_audit?.subscribers || 0} tone="red" />
                <WorkspaceMetric label="Media Views" value={workspace.channel_audit?.avg_views || 0} tone="amber" />
                <WorkspaceMetric label="Mediana" value={workspace.channel_audit?.median_views || 0} tone="green" />
                <WorkspaceMetric
                  label="Melhor video"
                  value={workspace.channel_audit?.best_video?.views || 0}
                  sub={workspace.channel_audit?.best_video?.title || 'Sem dados'}
                  tone="blue"
                />
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">O que esta funcionando</p>
                  <div className="space-y-2">
                    {(workspace.channel_audit?.top_patterns || []).slice(0, 3).map((item, index) => (
                      <div key={index} className="rounded-lg bg-zinc-900/70 border border-zinc-800 p-3 text-sm text-zinc-300">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Gaps e oportunidades</p>
                  <div className="space-y-2">
                    {(workspace.channel_audit?.opportunity_gaps || []).slice(0, 3).map((item, index) => (
                      <div key={index} className="rounded-lg bg-zinc-900/70 border border-zinc-800 p-3 text-sm text-zinc-300">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
            <div className="xl:col-span-2 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Manual do Canal</p>
                  <h2 className="text-lg font-bold text-zinc-100 mt-1">{workspace.playbook?.big_idea || 'Operar sistemas atraves de IA'}</h2>
                  {workspace.playbook?.brand_narrative && (
                    <p className="text-sm text-zinc-400 mt-2 max-w-2xl">{workspace.playbook.brand_narrative}</p>
                  )}
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Formula</p>
                  <p className="text-sm font-semibold text-zinc-200">{workspace.playbook?.editorial_formula || 'busca, prova, oferta'}</p>
                </div>
              </div>

              <div className="space-y-4">
                <PlaybookList title="Pilares" items={workspace.playbook?.content_pillars || []} tone="amber" />
                <PlaybookList title="Padroes de Titulo" items={workspace.playbook?.title_patterns || []} tone="blue" />
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Origem Editorial</p>
              <h2 className="text-lg font-bold text-zinc-100 mt-1">Centralizado na Orquestra</h2>

              <div className="grid grid-cols-2 gap-3 mt-4 mb-4">
                <WorkspaceMetric label="Arquivos fonte" value={workspace.playbook?.source_count || 0} tone="blue" />
                <WorkspaceMetric
                  label="Ultima sync"
                  value={workspace.playbook?.last_synced_at ? 'ok' : 'pendente'}
                  tone={workspace.playbook?.last_synced_at ? 'green' : 'amber'}
                  sub={workspace.playbook?.last_synced_at || 'sem importacao ainda'}
                />
              </div>

              {workspace.playbook?.voice_promise_style && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 mb-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Promessa na abertura</p>
                  <p className="text-sm text-zinc-300 leading-relaxed">{workspace.playbook.voice_promise_style}</p>
                </div>
              )}

              <PlaybookList title="Frases de assinatura" items={workspace.playbook?.signature_phrases || []} tone="green" />
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
            <div className="xl:col-span-2 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Ideias Novas na Plataforma</p>
                  <h2 className="text-lg font-bold text-zinc-100 mt-1">Toda ideia nova precisa cair em uma das duas series</h2>
                </div>
                <div className="text-[10px] text-zinc-500">{workspace.pipeline?.videos_total || 0} itens no pipeline</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(workspace.series_lanes || []).map(lane => (
                  <IdeaLaneCard key={lane.series} lane={lane} />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Proximas Acoes</p>
              <h2 className="text-lg font-bold text-zinc-100 mt-1 mb-4">O que fazer agora</h2>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <WorkspaceMetric label="Ideias" value={workspace.pipeline?.by_status?.ideia || 0} />
                <WorkspaceMetric label="Thumb pronta" value={workspace.pipeline?.by_status?.thumbnail_pronta || 0} tone="blue" />
                <WorkspaceMetric label="Pronto gravar" value={workspace.pipeline?.by_status?.pronto_gravar || 0} tone="green" />
                <WorkspaceMetric label="Publicado" value={workspace.pipeline?.by_status?.publicado || 0} tone="amber" />
              </div>

              <div className="space-y-2">
                {(workspace.next_actions || []).map((action, index) => (
                  <div key={index} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 text-[10px] font-bold text-amber-400">{index + 1}</span>
                      <p className="text-sm text-zinc-300 leading-relaxed">{action}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 min-h-[60vh]">
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
