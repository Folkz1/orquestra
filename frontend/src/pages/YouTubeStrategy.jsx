import { useState } from 'react'
import { getYouTubeChannelStats, getYouTubeVideos, saveYouTubeAnalytics } from '../api'

const API_URL = import.meta.env.VITE_API_URL || ''
const TOKEN = () => localStorage.getItem('orquestra_token')

// ─── Data extraída do AutoResearch (resource-youtube.md, 2026-03-19) ──────────

const TITLE_PATTERNS = [
  {
    type: 'Funciona',
    color: 'text-green-400',
    bg: 'bg-green-500/10 border-green-500/20',
    dot: 'bg-green-400',
    patterns: [
      '"[Ferramenta] + [Frustração específica] + [Como resolver]"',
      'Tutorial definitivo — "Guia", "Definitivo", "em X Minutos"',
      'Foco na dor — "O ERRO que...", "NUNCA MAIS...", "o problema..."',
      'Nome da ferramenta no título — Claude Code, Automação, Agentes IA',
      'Números concretos — R$, %, quantidade',
    ],
  },
  {
    type: 'Evitar',
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
    dot: 'bg-red-400',
    patterns: [
      'ALL CAPS completo no título',
      'Primeira pessoa — "Eu fiz", "Meu negócio" → -67% views',
      '"IA" ou "Inteligência Artificial" genérico sem ferramenta concreta',
      'Títulos vagos sem ferramenta ou resultado concreto',
      'MCP como ferramenta — Diego não usa MCP na stack dele',
    ],
  },
]

const DURATION_DATA = [
  { range: '3–10 min', avgViews: 375, vsBaseline: '+91%', engagement: '5.1%', highlight: true },
  { range: '30+ min', avgViews: 203, vsBaseline: '+4%', engagement: '7.8%', highlight: false },
  { range: '20–30 min', avgViews: 191, vsBaseline: '-3%', engagement: '6.5%', highlight: false },
  { range: '10–20 min', avgViews: 129, vsBaseline: '-34%', engagement: '9.9%', highlight: false },
]

const TOPICS_DATA = [
  { topic: 'N8N / WhatsApp / Tools', avgViews: 576, vsBaseline: '+194%', note: 'Formato que funciona (tutorial+ferramenta+dor)' },
  { topic: 'Tutorial prático', avgViews: 338, vsBaseline: '+72%', note: 'Claude Code + frustração específica do usuário' },
  { topic: 'IA Notícia / Radar', avgViews: 164, vsBaseline: '-17%', note: 'Bom para base fiel, não para crescimento' },
  { topic: 'Claude / Agentes IA (genérico)', avgViews: 88, vsBaseline: '-55%', note: 'Sem dor concreta = sem resultado' },
  { topic: 'Storytelling pessoal', avgViews: 64, vsBaseline: '-67%', note: '"Minha história" não performa' },
]

const SCHEDULE_DATA = {
  days: [
    { day: 'Seg', avgViews: 255, vsBaseline: '+30%', good: true },
    { day: 'Ter', avgViews: 390, vsBaseline: '+99%', best: true },
    { day: 'Qua', avgViews: 207, vsBaseline: '+5%', good: true },
    { day: 'Qui', avgViews: 221, vsBaseline: '+12%', good: true },
    { day: 'Sex', avgViews: null, vsBaseline: '—', neutral: true },
    { day: 'Sáb', avgViews: 92, vsBaseline: '-53%', bad: true },
    { day: 'Dom', avgViews: 52, vsBaseline: '-74%', bad: true },
  ],
  times: [
    { time: '19h', avgViews: 512, vsBaseline: '+161%', best: true },
    { time: '16h', avgViews: 212, vsBaseline: '+8%', good: true },
    { time: '04h', avgViews: 223, vsBaseline: '+14%', good: true },
    { time: '21h', avgViews: 51, vsBaseline: '-74%', bad: true },
    { time: '08h', avgViews: 46, vsBaseline: '-77%', bad: true },
  ],
}

const TOP_VIDEOS = [
  { rank: 1, title: 'Fiz o Claude Code trabalhar sem pedir permissão', views: 652, note: 'Dor específica + solução direta, +233% vs baseline' },
  { rank: 2, title: 'WhatsApp API em 10 Minutos', views: 801, note: 'Tutorial + ferramenta + tempo no título' },
  { rank: 3, title: 'Instalar N8N Guia Definitivo', views: 684, note: 'Guia definitivo + ferramenta' },
  { rank: 4, title: 'A IA ESCAPOU DA PRÓPRIA JAULA', views: 196, note: 'Notícia impactante — só baseline' },
  { rank: 5, title: 'GPT-5.4 CONTROLA TEU PC', views: 113, note: 'Radar IA notícia — abaixo da média' },
]

const WORKFLOW_RULES = [
  {
    from: 'Ideia',
    to: 'Thumb Pronta',
    fromColor: 'text-zinc-300',
    toColor: 'text-blue-400',
    arrowColor: 'text-zinc-600',
    rule: 'Thumbnail validada — clareza, contraste, texto legível',
    icon: '🖼️',
  },
  {
    from: 'Thumb Pronta',
    to: 'Pronto p/ Gravar',
    fromColor: 'text-blue-400',
    toColor: 'text-green-400',
    arrowColor: 'text-zinc-600',
    rule: 'Roteiro completo + pontos-chave definidos',
    icon: '📝',
  },
  {
    from: 'Pronto p/ Gravar',
    to: 'Publicado',
    fromColor: 'text-green-400',
    toColor: 'text-purple-400',
    arrowColor: 'text-zinc-600',
    rule: 'Gravado + editado + upload feito',
    icon: '✅',
  },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, sub, accent = 'text-zinc-100' }) {
  return (
    <div className="mb-3">
      <h2 className={`text-base font-semibold ${accent} flex items-center gap-2`}>{title}</h2>
      {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function FormulaCard() {
  return (
    <div className="card mb-6 border border-green-500/30 bg-green-500/5">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full bg-green-400" />
        <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">Fórmula do Vídeo Vencedor</span>
        <span className="text-[10px] text-zinc-600 ml-auto">Atualizado 2026-03-19</span>
      </div>
      <p className="text-sm font-mono text-zinc-100 bg-zinc-900/60 rounded px-3 py-2 mb-3">
        [Claude Code] + [Frustração específica] + [Como resolver] | 5–10min | Ter–Qui 19h BRT
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {[
          'Fiz o Claude Code trabalhar sem pedir permissão ← TOP 1 (652 views)',
          'Claude Code: O Erro que Quebra Todo Contexto (e Como Evitar)',
          'Agentes Autônomos com Claude Code — Do Zero em 10 Min',
          'Claude Code: Como 1 Pessoa Opera 7 Projetos SaaS',
        ].map((ex, i) => (
          <div key={i} className="flex items-start gap-1.5 text-xs text-zinc-400">
            <span className="text-green-500 mt-0.5 flex-shrink-0">→</span>
            <span>{ex}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TitlePatterns() {
  return (
    <div className="card mb-4">
      <SectionHeader title="Padrões de Título" sub="Baseado em análise dos 20 vídeos mais recentes" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TITLE_PATTERNS.map((group) => (
          <div key={group.type} className={`rounded-lg border p-3 ${group.bg}`}>
            <div className="flex items-center gap-1.5 mb-2">
              <span className={`w-1.5 h-1.5 rounded-full ${group.dot}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider ${group.color}`}>{group.type}</span>
            </div>
            <ul className="space-y-1">
              {group.patterns.map((p, i) => (
                <li key={i} className="text-xs text-zinc-300 flex items-start gap-1.5">
                  <span className={`mt-0.5 flex-shrink-0 ${group.color}`}>{group.type === 'Funciona' ? '✓' : '✕'}</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function DurationTable() {
  const maxViews = Math.max(...DURATION_DATA.map(d => d.avgViews))
  return (
    <div className="card mb-4">
      <SectionHeader title="Duração vs Performance" sub="Sweet spot: 3–10 min para views (+91%)" />
      <div className="space-y-2">
        {DURATION_DATA.map((row) => (
          <div key={row.range} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${row.highlight ? 'bg-green-500/10 border border-green-500/20' : 'bg-zinc-800/30'}`}>
            <div className="w-20 flex-shrink-0">
              <span className={`text-xs font-semibold ${row.highlight ? 'text-green-400' : 'text-zinc-300'}`}>{row.range}</span>
            </div>
            <div className="flex-1">
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${row.highlight ? 'bg-green-500' : 'bg-zinc-600'}`}
                  style={{ width: `${(row.avgViews / maxViews) * 100}%` }}
                />
              </div>
            </div>
            <div className="w-16 text-right flex-shrink-0">
              <span className="text-sm font-semibold text-zinc-100">{row.avgViews}</span>
              <span className="text-[10px] text-zinc-600 ml-1">views</span>
            </div>
            <div className="w-16 text-right flex-shrink-0">
              <span className={`text-xs font-semibold ${row.vsBaseline.startsWith('+') ? 'text-green-400' : 'text-red-400'}`}>
                {row.vsBaseline}
              </span>
            </div>
            <div className="w-12 text-right flex-shrink-0">
              <span className="text-xs text-zinc-500">{row.engagement}</span>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3 px-3 text-[10px] text-zinc-600">
          <div className="w-20" />
          <div className="flex-1" />
          <div className="w-16 text-right">avg views</div>
          <div className="w-16 text-right">vs base</div>
          <div className="w-12 text-right">eng</div>
        </div>
      </div>
    </div>
  )
}

function TopicsTable() {
  const maxViews = Math.max(...TOPICS_DATA.map(d => d.avgViews))
  return (
    <div className="card mb-4">
      <SectionHeader title="Temas — O Que o Público Quer" sub="Foco atual: Claude Code + frustração específica" />
      <div className="space-y-2">
        {TOPICS_DATA.map((row, i) => (
          <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/30 transition-colors">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-200 truncate">{row.topic}</p>
              <p className="text-[10px] text-zinc-600 mt-0.5">{row.note}</p>
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden mt-1.5">
                <div
                  className={`h-full rounded-full ${i < 2 ? 'bg-green-500/70' : 'bg-zinc-600/70'}`}
                  style={{ width: `${(row.avgViews / maxViews) * 100}%` }}
                />
              </div>
            </div>
            <div className="flex-shrink-0 text-right">
              <div className="text-sm font-semibold text-zinc-100">{row.avgViews}</div>
              <div className={`text-xs font-semibold ${row.vsBaseline.startsWith('+') ? 'text-green-400' : 'text-red-400'}`}>
                {row.vsBaseline}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ScheduleCard() {
  return (
    <div className="card mb-4">
      <SectionHeader title="Melhor Horário de Publicação" sub="Janela de ouro: 19h BRT Ter–Qui (+161%)" />

      {/* Days */}
      <div className="mb-4">
        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Dia da semana</p>
        <div className="flex gap-1">
          {SCHEDULE_DATA.days.map((d) => {
            const cls = d.best
              ? 'bg-green-500 text-white'
              : d.good
              ? 'bg-green-500/20 text-green-400'
              : d.bad
              ? 'bg-red-500/15 text-red-400'
              : 'bg-zinc-800 text-zinc-500'
            return (
              <div key={d.day} className={`flex-1 flex flex-col items-center rounded-lg py-2 px-1 ${cls}`}>
                <span className="text-xs font-semibold">{d.day}</span>
                <span className="text-[9px] mt-0.5 opacity-80">{d.vsBaseline}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Times */}
      <div>
        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Horário (BRT)</p>
        <div className="flex gap-2 flex-wrap">
          {SCHEDULE_DATA.times.map((t) => {
            const cls = t.best
              ? 'bg-green-500 text-white'
              : t.good
              ? 'bg-green-500/20 text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/15'
            return (
              <div key={t.time} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>
                <span>{t.time}</span>
                <span className="opacity-70 text-[10px]">{t.vsBaseline}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TopVideosCard() {
  return (
    <div className="card mb-4">
      <SectionHeader title="Top 5 Vídeos — Referência" sub="Use como modelo de formato, ângulo e título" />
      <div className="space-y-1">
        {TOP_VIDEOS.map((v) => (
          <div key={v.rank} className="flex items-start gap-3 py-2 px-2 rounded-lg hover:bg-zinc-800/30 transition-colors">
            <span className={`text-sm font-mono font-bold w-5 flex-shrink-0 mt-0.5 ${v.rank <= 3 ? 'text-yellow-400' : 'text-zinc-600'}`}>
              {v.rank}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-100 truncate">{v.title}</p>
              <p className="text-[10px] text-zinc-600 mt-0.5">{v.note}</p>
            </div>
            <div className="flex-shrink-0 text-right">
              <span className="text-sm font-semibold text-zinc-100">{v.views.toLocaleString('pt-BR')}</span>
              <span className="text-[10px] text-zinc-600 ml-1">views</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function WorkflowRulesCard() {
  return (
    <div className="card mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
        <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Regras do Kanban — Critérios de Avanço</span>
      </div>
      <div className="space-y-2">
        {WORKFLOW_RULES.map((rule, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-800/40 border border-zinc-700/40">
            <span className="text-base flex-shrink-0">{rule.icon}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0 text-xs font-semibold">
              <span className={rule.fromColor}>{rule.from}</span>
              <span className={rule.arrowColor}>→</span>
              <span className={rule.toColor}>{rule.to}</span>
            </div>
            <div className="w-px h-4 bg-zinc-700 flex-shrink-0" />
            <p className="text-xs text-zinc-400">{rule.rule}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function QuickActionsCard({ onBriefingGenerated }) {
  const [generatingBriefing, setGeneratingBriefing] = useState(false)
  const [updatingAnalytics, setUpdatingAnalytics] = useState(false)
  const [feedback, setFeedback] = useState(null)

  function showFeedback(msg, type = 'ok') {
    setFeedback({ msg, type })
    setTimeout(() => setFeedback(null), 3500)
  }

  async function handleGerarBriefing() {
    if (generatingBriefing) return
    setGeneratingBriefing(true)
    try {
      const token = TOKEN()
      const res = await fetch(`${API_URL}/api/youtube/briefings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          date: new Date().toISOString().slice(0, 10),
          tipo: 'semanal',
          videos: [],
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showFeedback('Briefing gerado com sucesso', 'ok')
      onBriefingGenerated?.()
    } catch (err) {
      showFeedback(`Erro: ${err.message}`, 'err')
    }
    setGeneratingBriefing(false)
  }

  async function handleAtualizarAnalytics() {
    if (updatingAnalytics) return
    setUpdatingAnalytics(true)
    try {
      const [statsRes, videosRes] = await Promise.all([
        getYouTubeChannelStats(),
        getYouTubeVideos(50),
      ])
      const channelStats = statsRes?.data
      const videos = videosRes?.data?.items || []
      const publicVideos = videos.filter(v => v.privacy_status === 'public')
      const viewsList = publicVideos.map(v => v.views || 0).filter(v => v > 0)
      const sorted = [...viewsList].sort((a, b) => a - b)
      const avg = viewsList.length > 0 ? Math.round(viewsList.reduce((a, b) => a + b, 0) / viewsList.length) : 0
      const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0

      await saveYouTubeAnalytics({
        date: new Date().toISOString().slice(0, 10),
        subscribers: channelStats?.subscribers || 0,
        total_views: channelStats?.total_views || 0,
        videos_count: channelStats?.total_videos || 0,
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
      showFeedback('Snapshot de analytics salvo', 'ok')
    } catch (err) {
      showFeedback(`Erro: ${err.message}`, 'err')
    }
    setUpdatingAnalytics(false)
  }

  return (
    <div className="card mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        <span className="text-xs font-semibold text-primary uppercase tracking-wider">Ações Rápidas</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleGerarBriefing}
          disabled={generatingBriefing}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/20 text-primary border border-primary/30 text-sm font-medium hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generatingBriefing ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
              Gerando...
            </>
          ) : (
            <>
              <span>✦</span>
              Gerar Briefing
            </>
          )}
        </button>

        <button
          onClick={handleAtualizarAnalytics}
          disabled={updatingAnalytics}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 text-sm font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {updatingAnalytics ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
              Atualizando...
            </>
          ) : (
            <>
              <span>↻</span>
              Atualizar Analytics
            </>
          )}
        </button>

        <a
          href="/youtube-briefing"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 text-sm font-medium hover:bg-zinc-700 transition-colors"
        >
          <span>↗</span>
          Ver Briefing Andriely
        </a>
      </div>

      {feedback && (
        <div className={`mt-2 px-3 py-1.5 rounded text-xs font-medium animate-fade-in ${
          feedback.type === 'ok'
            ? 'bg-green-500/15 text-green-400'
            : 'bg-red-500/15 text-red-400'
        }`}>
          {feedback.msg}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function YouTubeStrategy() {
  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="text-green-500">◈</span> Estratégia GuyFolkz
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Dados do AutoResearch — 20 vídeos analisados · Atualizado 2026-03-19
          </p>
        </div>
        <div className="text-right text-xs text-zinc-600">
          <div>Canal: GuyFolkz</div>
          <div>Baseline: 196 views · Eng: 8.1%</div>
        </div>
      </div>

      {/* Fórmula do vídeo vencedor */}
      <FormulaCard />

      {/* Quick Actions */}
      <QuickActionsCard />

      {/* Two-column layout on larger screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <DurationTable />
          <ScheduleCard />
        </div>
        <div>
          <TopicsTable />
          <TopVideosCard />
        </div>
      </div>

      {/* Title patterns — full width */}
      <TitlePatterns />

      {/* Workflow rules — full width */}
      <WorkflowRulesCard />

      {/* Baseline reference */}
      <div className="card border border-zinc-700/40 bg-zinc-800/20">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Métricas de Referência do Canal</span>
          <span className="text-[10px] text-zinc-700 ml-auto">637 subs · 106 vídeos · 17 longos analisados</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Views média (baseline)', value: '196', color: 'text-zinc-100' },
            { label: 'Engagement rate', value: '8.1%', color: 'text-green-400', note: 'Muito bom p/ canal pequeno' },
            { label: 'Duração média', value: '18 min', color: 'text-zinc-100' },
            { label: 'Foco do canal', value: 'Claude Code', color: 'text-blue-400', note: 'N8N só eventualmente' },
          ].map((m) => (
            <div key={m.label} className="flex flex-col">
              <span className="text-[10px] text-zinc-600">{m.label}</span>
              <span className={`text-lg font-bold mt-0.5 ${m.color}`}>{m.value}</span>
              {m.note && <span className="text-[10px] text-zinc-600">{m.note}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
