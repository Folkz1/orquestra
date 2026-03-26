import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { getYouTubeWorkspace } from '../api'

const API_URL = import.meta.env.VITE_API_URL || ''

function getThumbUrl(video) {
  if (video.thumbnail_data) return video.thumbnail_data
  if (video.thumbnail_file) return `${API_URL}/api/youtube/thumbnails/${video.thumbnail_file}`
  return null
}

function getBriefingVideoUrl(video) {
  const videoIndex = video?.video_index ?? video?.index ?? 0
  if (video?.briefing_id) {
    return `${API_URL}/api/youtube/briefings/${encodeURIComponent(video.briefing_id)}/videos/${videoIndex}`
  }
  return `${API_URL}/api/youtube/briefings/latest/videos/${videoIndex}`
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
  if (video.descricao_youtube) return video.descricao_youtube

  const keywords = video.keywords || []
  const roteiro = video.roteiro || {}
  const hookText = video.hook || ''
  let desc = ''

  if (hookText) {
    desc += hookText.replace(/^["']|["']$/g, '') + '\n\n'
  }

  const pontos = video.pontos_chave || []
  if (pontos.length > 0) {
    desc += 'Neste video voce vai ver:\n'
    pontos.forEach(p => { desc += `- ${p}\n` })
    desc += '\n'
  } else if (Object.keys(roteiro).length > 0) {
    desc += 'Neste video:\n'
    Object.entries(roteiro).forEach(([, v]) => {
      desc += `- ${v.substring(0, 100)}${v.length > 100 ? '...' : ''}\n`
    })
    desc += '\n'
  }

  desc += '---\n'
  desc += '00:00 - Intro\n'
  if (roteiro['Problema'] || roteiro['1-Problema']) desc += '00:30 - O Problema\n'
  if (roteiro['Execucao'] || roteiro['2-Execucao']) desc += '02:00 - Execucao na Pratica\n'
  if (roteiro['CTA'] || roteiro['3-CTA']) desc += 'XX:XX - Resultado + Proximo Passo\n'
  desc += '\n'

  desc += '---\n'
  desc += 'Sua empresa perde dinheiro com processos manuais?\n'
  desc += 'Me chama no WhatsApp e vamos desenhar uma automacao pro seu negocio:\n'
  desc += 'https://wa.me/5551993448124\n\n'

  desc += '---\n'
  desc += 'Canal GuyFolkz: https://youtube.com/@guyfolkz\n'
  if (video.referencias?.length > 0) {
    video.referencias.forEach(ref => {
      if (ref.url) desc += `${ref.title || 'Link'}: ${ref.url}\n`
    })
  }
  desc += '\n'

  if (keywords.length > 0) {
    desc += keywords.map(k => `#${k.replace(/\s+/g, '').toLowerCase()}`).join(' ') + '\n'
  }

  return desc
}

/* ─── Detalhe do video (sem teleprompter, sem upload) ────── */
function VideoDetailDiego({ video, index, briefingDate, onStatusChange, onClose }) {
  const [changing, setChanging] = useState(false)
  const [copied, setCopied] = useState(null)
  const [editingRoteiro, setEditingRoteiro] = useState(() => {
    const rot = video.roteiro || {}
    const normalized = {}
    for (const [k, v] of Object.entries(rot)) {
      if (/problema/i.test(k) || k === '1') normalized['Problema'] = v
      else if (/execu/i.test(k) || k === '2') normalized['Execucao'] = v
      else if (/cta/i.test(k) || k === '3') normalized['CTA'] = v
      else normalized[k] = v
    }
    return normalized
  })
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
      const res = await fetch(getBriefingVideoUrl(video), { method: 'PATCH', body: form })
      const data = await res.json()
      if (data.ok) onStatusChange(video, data.video)
    } catch (e) { console.error(e) }
    setChanging(false)
  }

  function copyText(text, id) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-zinc-950 overflow-y-auto">
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
            <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${cfg.color}`}>{cfg.label}</span>
            {nextStatus[status] && (
              <button onClick={handleAdvance} disabled={changing}
                className="text-[11px] px-3 py-1 rounded-full bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-50 font-semibold">
                {changing ? '...' : `Mover: ${nextLabel[status]}`}
              </button>
            )}
          </div>
        </div>

        {/* Header */}
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

        {/* 1. Briefing */}
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

        {/* 2. O que falar */}
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

        {/* 3. Hook */}
        {video.hook && (
          <Section title="Hook - Primeiros 30 Segundos" subtitle="Comece o video com essa fala. NAO peca inscricao." accent="red" num="3">
            <div className="bg-red-500/5 rounded-lg p-4 border border-red-500/15 relative">
              <p className="text-base text-red-100 leading-relaxed font-medium pr-16">"{video.hook}"</p>
              <CopyBtn text={video.hook} id="hook" copied={copied} onCopy={copyText} />
            </div>
          </Section>
        )}

        {/* 4. Editar Roteiro */}
        <Section title="Editar Roteiro" subtitle="Preencha os 3 atos do video" accent="indigo" num="4">
          <div className="space-y-3">
            {['Problema', 'Execucao', 'CTA'].map((label, i) => (
              <div key={label}>
                <label className="text-xs font-semibold text-zinc-300 mb-1 block">
                  {i + 1}. {label}
                  {label === 'Problema' && <span className="text-zinc-600 ml-1">(0:00 - 0:30)</span>}
                  {label === 'Execucao' && <span className="text-zinc-600 ml-1">(0:30 - 15:00+)</span>}
                  {label === 'CTA' && <span className="text-zinc-600 ml-1">(Final)</span>}
                </label>
                <textarea
                  value={editingRoteiro?.[label] || editingRoteiro?.[`${i+1}-${label}`] || editingRoteiro?.[label.normalize('NFD').replace(/[\u0300-\u036f]/g, '')] || ''}
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
                  const res = await fetch(getBriefingVideoUrl(video), { method: 'PATCH', body: form })
                  const data = await res.json()
                  if (data.ok) {
                    onStatusChange(video, data.video)
                    alert('Roteiro salvo com sucesso!')
                  }
                } catch (e) {
                  console.error(e)
                  alert('Erro ao salvar roteiro')
                }
              }}
              className="mt-2 w-full px-3 py-2 bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 rounded-lg text-sm font-semibold transition-colors"
            >
              Salvar Roteiro
            </button>
          </div>
        </Section>

        {/* 5. Roteiro visual */}
        {((editingRoteiro && Object.keys(editingRoteiro).length > 0) || (video.roteiro && Object.keys(video.roteiro).length > 0)) && (
          <Section title="Roteiro - Estrutura Completa" subtitle="Os 3 atos do video com tempos sugeridos" accent="blue" num="5">
            <div className="space-y-3">
              {Object.entries(editingRoteiro && Object.keys(editingRoteiro).length > 0 ? editingRoteiro : video.roteiro).filter(([, val]) => val).map(([key, val]) => {
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

        {/* 6. Dinamica */}
        {video.dinamica && (
          <Section title="Dinamica de Producao" subtitle="Como conduzir: camera, tela, transicoes" accent="purple" num="6">
            <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-line">{video.dinamica}</p>
          </Section>
        )}

        {/* 7. Referencias */}
        <Section title="Referencias e Links" subtitle="Abrir ANTES de gravar para mostrar na tela" accent="cyan" num="7">
          <div className="space-y-2">
            {video.referencias?.length > 0 && video.referencias.map((ref, i) => (
              <LinkItem key={i} icon="[link]" label={ref.title || ref.url} desc={ref.nota || ''} url={ref.url} />
            ))}
            {video.keywords?.length > 0 && (
              <LinkItem icon="[busca]" label={`Google: ${video.keywords[0]}`} desc="Pesquisar para mostrar na tela"
                url={`https://www.google.com/search?q=${encodeURIComponent(video.keywords[0])}`} />
            )}
            <LinkItem icon="[yt]" label="Canal GuyFolkz" desc="Mostrar videos relacionados" url="https://www.youtube.com/@guyfolkz" />
            {hasKeyword(video, 'n8n') && <LinkItem icon="[tool]" label="N8N" desc="Mostrar workflow" url="https://n8n.io" />}
            {hasKeyword(video, 'claude') && <LinkItem icon="[ai]" label="Claude" desc="Demonstrar" url="https://claude.ai" />}
            {hasKeyword(video, 'chatgpt', 'openai', 'gpt') && <LinkItem icon="[ai]" label="ChatGPT" desc="Demonstrar" url="https://chat.openai.com" />}
            <LinkItem icon="[wa]" label="WhatsApp B2B" desc="CTA final" url="https://wa.me/5551993448124" />
          </div>
        </Section>

        {/* 8. Keywords */}
        {video.keywords?.length > 0 && (
          <Section title="Keywords SEO" subtitle="Para descricao, tags e hashtags" accent="zinc" num="8">
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

        {/* 9. Descricao YouTube */}
        <Section title="Descricao do YouTube" subtitle="Copiar e colar direto na publicacao" accent="red" num="9">
          <div className="bg-zinc-800/80 rounded-lg p-4 border border-zinc-700/50 relative">
            <pre className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap font-sans">{descricaoYT}</pre>
            <CopyBtn text={descricaoYT} id="desc" copied={copied} onCopy={copyText} />
          </div>
        </Section>

        {/* 10. Titulo */}
        <Section title="Titulo para Publicacao" subtitle="Copiar direto pro YouTube" accent="amber" num="10">
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

        {/* 11. Checklist */}
        <Section title="Checklist" subtitle="Tudo pronto antes de gravar?" accent="green" num="11">
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

        {/* CTA padrao */}
        <div className="bg-gradient-to-r from-amber-500/5 to-green-500/5 rounded-xl border border-amber-500/15 p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider">CTA Final (falar no video)</h3>
            <CopyBtn text="Sua empresa esta perdendo dinheiro com processos manuais? Clica no link da descricao e me chama no WhatsApp para desenharmos uma automacao para o seu negocio." id="cta" copied={copied} onCopy={copyText} />
          </div>
          <p className="text-sm text-amber-100 leading-relaxed italic">
            "Sua empresa esta perdendo dinheiro com processos manuais? Clica no link da descricao e me chama no WhatsApp para desenharmos uma automacao para o seu negocio."
          </p>
          <p className="text-[10px] text-zinc-500 mt-2">wa.me/5551993448124</p>
        </div>

        {/* Status action */}
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
    </div>,
    document.body
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
    indigo: 'border-indigo-500/20',
  }
  const titleColor = {
    amber: 'text-amber-400', green: 'text-green-400', blue: 'text-blue-400',
    purple: 'text-purple-400', cyan: 'text-cyan-400', red: 'text-red-400', zinc: 'text-zinc-400',
    indigo: 'text-indigo-400',
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
      <span className="text-xs text-zinc-500 flex-shrink-0 font-mono">{icon}</span>
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

/* ─── Kanban Card ─────────────────────────────────────────── */

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
      const res = await fetch(getBriefingVideoUrl(video), { method: 'PATCH', body: form })
      const data = await res.json()
      if (data.ok) onStatusChange(video, data.video)
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

/* ─── Hero: Proximo a Gravar ─────────────────────────────── */

function NextToRecord({ videos, onSelect }) {
  // Videos prontos para gravar ou com thumb pronta, ordenados por urgencia
  const candidates = videos.filter(v => v.status === 'pronto_gravar' || v.status === 'thumbnail_pronta')
  const urgencyOrder = { 'ALTISSIMA': 0, 'Alta': 1, 'Media': 2 }
  const sorted = [...candidates].sort((a, b) => {
    const ua = urgencyOrder[a.urgencia] ?? 3
    const ub = urgencyOrder[b.urgencia] ?? 3
    if (ua !== ub) return ua - ub
    // Pronto gravar tem prioridade sobre thumb pronta
    if (a.status === 'pronto_gravar' && b.status !== 'pronto_gravar') return -1
    if (b.status === 'pronto_gravar' && a.status !== 'pronto_gravar') return 1
    return 0
  })

  if (sorted.length === 0) return null

  const urgenciaColors = {
    'ALTISSIMA': 'border-red-500/40 bg-red-500/10 text-red-400',
    'Alta': 'border-orange-500/40 bg-orange-500/10 text-orange-400',
    'Media': 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400',
  }

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
        <span className="text-xs font-bold text-green-400 uppercase tracking-wider">Proximo a gravar</span>
        <span className="text-[10px] text-zinc-600">{sorted.length} {sorted.length === 1 ? 'video pronto' : 'videos prontos'}</span>
      </div>
      <div className="space-y-2">
        {sorted.map((video) => {
          const thumbnailUrl = getThumbUrl(video)
          const statusLabel = video.status === 'pronto_gravar' ? 'Pronto' : 'Thumb OK'
          const statusColor = video.status === 'pronto_gravar' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'
          return (
            <div key={`${video.briefing_id}-${video.video_index}`}
              onClick={() => onSelect(video)}
              className="rounded-xl border border-green-500/20 bg-zinc-900/60 p-4 cursor-pointer hover:border-green-500/40 hover:bg-zinc-900/80 transition-all">
              <div className="flex gap-4 items-start">
                {thumbnailUrl && (
                  <div className="w-32 h-20 rounded-lg overflow-hidden border border-zinc-700 flex-shrink-0">
                    <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${statusColor}`}>{statusLabel}</span>
                    {video.urgencia && (
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold border ${urgenciaColors[video.urgencia] || urgenciaColors.Media}`}>
                        {video.urgencia}
                      </span>
                    )}
                    {video.formato && <span className="text-[9px] px-2 py-0.5 rounded-full bg-zinc-700/50 text-zinc-400">{video.formato}</span>}
                  </div>
                  <h3 className="text-sm font-bold text-zinc-100 leading-snug line-clamp-2">
                    {video.chosen_title || video.title}
                  </h3>
                  {video.hook && (
                    <p className="text-[11px] text-zinc-500 line-clamp-1 mt-1 italic">"{video.hook}"</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-zinc-600">
                    {video.duracao && <span>{video.duracao}</span>}
                    {video.briefing_date && <span>{video.briefing_date}</span>}
                  </div>
                </div>
                <svg className="w-5 h-5 text-green-500/50 flex-shrink-0 mt-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Main Kanban Page ────────────────────────────────────── */

export default function YouTubeKanban({ embedded = false }) {
  const [loading, setLoading] = useState(true)
  const [activeVideo, setActiveVideo] = useState(null)
  const [workspace, setWorkspace] = useState(null)

  useEffect(() => {
    loadWorkspace()
  }, [])

  async function loadWorkspace({ silent = false } = {}) {
    if (!silent) setLoading(true)
    try {
      const workspaceData = await getYouTubeWorkspace().catch(() => null)
      if (workspaceData?.status === 'ok') {
        setWorkspace(workspaceData.data || null)
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }

  function handleStatusChange(sourceVideo, updatedVideo) {
    setWorkspace((current) => {
      if (!current) return current
      const board = Array.isArray(current.pipeline_board) ? current.pipeline_board : []
      return {
        ...current,
        pipeline_board: board.map((item) => {
          if (item.briefing_id !== sourceVideo.briefing_id || item.video_index !== sourceVideo.video_index) return item
          return { ...item, ...updatedVideo }
        }),
      }
    })
    setActiveVideo((current) => {
      if (!current) return current
      if (current.briefing_id !== sourceVideo.briefing_id || current.video_index !== sourceVideo.video_index) return current
      return { ...current, ...updatedVideo }
    })
    loadWorkspace({ silent: true })
  }

  const allVideos = Array.isArray(workspace?.pipeline_board) ? workspace.pipeline_board : []

  // Videos candidatos a gravar (ordenados por urgencia no componente)

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
        video={activeVideo}
        index={activeVideo.video_index}
        briefingDate={activeVideo.briefing_date}
        onStatusChange={handleStatusChange}
        onClose={() => setActiveVideo(null)}
      />
    )
  }

  return (
    <div>
      {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-zinc-100">Pipeline YouTube</h1>
            <p className="text-xs text-zinc-500 mt-1">{allVideos.length} videos no pipeline</p>
          </div>
          <a href="/youtube-briefing" target="_blank" rel="noopener noreferrer"
            className="text-xs bg-red-500/15 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/25 transition-colors">
            Briefing Andriely
          </a>
        </div>
      )}

      {/* Hero: proximo a gravar (todos os candidatos, Diego escolhe) */}
      <NextToRecord videos={allVideos} onSelect={(video) => setActiveVideo(video)} />

      {/* Kanban board */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 min-h-[60vh]">
        {COLUMNS.map(col => {
          const videos = allVideos.filter(v => (v.status || 'ideia') === col.key)
          return (
            <div key={col.key} className={`rounded-xl border ${col.color} ${col.bg} p-3`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{col.label}</h3>
                <span className="text-[10px] bg-zinc-700/50 text-zinc-400 px-1.5 py-0.5 rounded-full">{videos.length}</span>
              </div>
              <div className="space-y-3">
                {videos.map((v) => (
                  <KanbanCard
                    key={`${v.briefing_id || 'briefing'}-${v.video_index}`}
                    video={v}
                    index={v.video_index}
                    briefingDate={v.briefing_date}
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
