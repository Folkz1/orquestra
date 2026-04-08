import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || ''
const ELEVENLABS_AGENT_ID = 'agent_2001kmexxj04e4k9w0vkdrxt3zk2'

// Videos da GuyFolkz Academy (React series)
const ACADEMY_VIDEOS = [
  {
    id: 'iNdg_WGWXRI', tier: 'free',
    title: 'Criança de 15 Anos Fez $50K Instalando IA',
    desc: 'O dinheiro está em instalar, não criar. Veja como um garoto de 15 anos descobriu isso primeiro.',
    duration: '18 min', tag: 'Mindset'
  },
  {
    id: 'PLi5NfSa0uA', tier: 'free',
    title: 'App de R$100M Codado aos 18 Anos — Cal AI',
    desc: 'Vibe coding virou business real. Aqui está o playbook completo de como isso aconteceu.',
    duration: '22 min', tag: 'Case Real'
  },
  {
    id: 'neBEx5i_7lM', tier: 'pro',
    title: 'Para de Criar Agentes — Cria SKILLS',
    desc: 'O erro que 90% dos devs cometem ao usar IA. Skills > Agentes no contexto de produto.',
    duration: '25 min', tag: 'Estratégia'
  },
  {
    id: 'rHiq3-609VE', tier: 'pro',
    title: 'Claude Controla Teu Computador — Computer Use',
    desc: 'React ao Nate Herkelman: quando a IA passa a operar seu PC inteiro. O que muda pra dev?',
    duration: '30 min', tag: 'Tech'
  },
]

// Feed estático da comunidade (posts de Diego)
const COMMUNITY_POSTS = [
  {
    id: 1,
    author: 'Diego (GuyFolkz)',
    avatar: '🎯',
    time: 'Hoje',
    content: 'Bem-vindo à GuyFolkz Academy! Esta é a nossa base de operações. Aqui vou compartilhar o que funciona no dia a dia — não teoria, mas o que está gerando receita real agora. Começa pelo módulo de Fundação e já implementa hoje.',
    likes: 12,
    replies: 4,
    pinned: true,
  },
  {
    id: 2,
    author: 'Diego (GuyFolkz)',
    avatar: '🚀',
    time: '1 dia atrás',
    content: 'Update: os 4 vídeos React já estão na aba Aulas. Assiste em ordem — cada um vai empilhando em cima do anterior. O V1 (Computer Use) foi o que mais gerou DM, então começa por ele se quiser entender onde o mercado está indo.',
    likes: 8,
    replies: 2,
  },
  {
    id: 3,
    author: 'Diego (GuyFolkz)',
    avatar: '💡',
    time: '3 dias atrás',
    content: 'Dica rápida: o CLAUDE.md é o coração de tudo. Se você configurar ele certo, você já tem 80% do resultado. O módulo de Fundação explica exatamente como. Não pula essa etapa.',
    likes: 15,
    replies: 7,
  },
]

// Desafios semanais
const WEEKLY_CHALLENGES = [
  {
    id: 'ch1', emoji: '🏗️', title: 'Configure seu CLAUDE.md',
    desc: 'Crie ou melhore seu CLAUDE.md com identidade, projetos e regras de ouro.',
    reward: '50 pts', done: false, module: 'fundacao'
  },
  {
    id: 'ch2', emoji: '📋', title: 'Rode /status no seu projeto',
    desc: 'Use o skill /status e compartilhe o resultado no grupo Telegram.',
    reward: '30 pts', done: false, module: 'projetos'
  },
  {
    id: 'ch3', emoji: '💬', title: 'Manda no grupo: o que você implementou',
    desc: 'Uma linha sobre o que você fez essa semana usando o Jarbas.',
    reward: '20 pts', done: false
  },
]

function markdownToHtml(md) {
  if (!md) return ''
  return md
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-6 mb-3">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-zinc-800 px-1.5 py-0.5 rounded text-emerald-400 text-xs">$1</code>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-zinc-900 border border-zinc-700 rounded-xl p-4 my-3 overflow-x-auto text-xs"><code>$2</code></pre>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 my-1 text-zinc-300">$1</li>')
    .replace(/(<li[\s\S]*?<\/li>[\s]*)+/g, '<ul class="list-disc pl-4 my-2">$&</ul>')
    .replace(/\n\n/g, '</p><p class="my-2 text-zinc-300">')
}

export default function CommunityMembers() {
  const [params] = useSearchParams()
  const [phone, setPhone] = useState(localStorage.getItem('community_phone') || '')
  const [member, setMember] = useState(null)
  const [modules, setModules] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [activeModule, setActiveModule] = useState(null)
  const [activeStep, setActiveStep] = useState(null)
  const [activeVideo, setActiveVideo] = useState(null)
  const [tab, setTab] = useState('dashboard') // dashboard, aulas, comunidade, ranking
  const [view, setView] = useState('main') // main, module, step, agent
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [likedPosts, setLikedPosts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('liked_posts') || '[]') } catch { return [] }
  })

  useEffect(() => {
    if (params.get('enrolled') === 'true' && phone) handleLogin()
  }, [])

  async function handleLogin(e) {
    if (e) e.preventDefault()
    if (!phone.trim()) { setError('Informe seu WhatsApp'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/playbook/progress/${phone.trim()}`)
      if (!res.ok) throw new Error('WhatsApp nao encontrado. Voce ja se inscreveu?')
      const data = await res.json()
      // Dono da comunidade tem acesso PRO automatico
      const OWNER_PHONES = ['51993448124', '5551993448124']
      if (OWNER_PHONES.includes(phone.trim())) data.tier = 'pro'
      setMember(data)
      localStorage.setItem('community_phone', phone.trim())
      // Bridge: get community JWT for feed interaction
      try {
        const jwtRes = await fetch(`${API}/api/community/auth/login-phone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone.trim() }),
        })
        if (jwtRes.ok) {
          const jwtData = await jwtRes.json()
          localStorage.setItem('community_token', jwtData.token)
        }
      } catch {}
      const [mRes, lRes] = await Promise.all([
        fetch(`${API}/api/playbook/modules`),
        fetch(`${API}/api/playbook/leaderboard`),
      ])
      const [mData, lData] = await Promise.all([mRes.json(), lRes.json()])
      setModules(mData)
      setLeaderboard(Array.isArray(lData) ? lData : [])
    } catch (err) {
      setError(err.message || 'Erro ao acessar')
    } finally {
      setLoading(false)
    }
  }

  async function loadModule(slug) {
    const res = await fetch(`${API}/api/playbook/modules/${slug}?phone=${phone}`)
    const data = await res.json()
    setActiveModule(data)
    setActiveStep(null)
    setView('module')
  }

  async function markComplete(stepId) {
    await fetch(`${API}/api/playbook/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, step_id: stepId }),
    })
    if (activeModule) loadModule(activeModule.slug)
    // refresh member progress
    const res = await fetch(`${API}/api/playbook/progress/${phone}`)
    if (res.ok) setMember(await res.json())
  }

  function toggleLike(postId) {
    const updated = likedPosts.includes(postId)
      ? likedPosts.filter(id => id !== postId)
      : [...likedPosts, postId]
    setLikedPosts(updated)
    localStorage.setItem('liked_posts', JSON.stringify(updated))
  }

  function logout() {
    setMember(null)
    localStorage.removeItem('community_phone')
    setTab('dashboard')
    setView('main')
  }

  // ── Login Screen ──
  if (!member) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090b10] px-4">
        <div className="w-full max-w-sm">
          <div className="text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-[#8bd450]">GuyFolkz Academy</p>
            <h1 className="mt-3 text-2xl font-bold text-white">Area de Membros</h1>
            <p className="mt-2 text-sm text-zinc-400">Entre com seu WhatsApp cadastrado.</p>
          </div>
          <form onSubmit={handleLogin} className="mt-8 space-y-4">
            <input
              type="text"
              placeholder="Seu WhatsApp (ex: 5511999998888)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-[#8bd450]/40"
              required
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#8bd450] py-3 text-sm font-semibold text-black hover:bg-[#9be060] disabled:opacity-50"
            >
              {loading ? 'Verificando...' : 'Entrar'}
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-zinc-500">
            Ainda nao e membro?{' '}
            <Link to="/comunidade" className="text-[#8bd450] hover:underline">Assine aqui</Link>
          </p>
        </div>
      </div>
    )
  }

  const isPro = member.tier === 'pro'
  const completedSteps = member.completed_steps || 0
  const totalSteps = member.total_steps || 1
  const progress = Math.round((completedSteps / totalSteps) * 100)

  // ── Step View ──
  if (view === 'step' && activeStep) {
    const isCompleted = activeStep.is_completed
    return (
      <div className="min-h-screen bg-[#090b10] text-zinc-100">
        <header className="sticky top-0 z-10 border-b border-white/6 bg-[#090b10]/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <button onClick={() => setView('module')} className="text-sm text-zinc-400 hover:text-white">← Voltar</button>
            <span className="text-xs text-zinc-600">|</span>
            <span className="text-sm font-medium">{activeStep.title}</span>
            {isCompleted && <span className="ml-auto rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-400">Concluido</span>}
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">
          {activeStep.duration_min && (
            <p className="mb-4 text-xs text-zinc-500">{activeStep.duration_min} min de leitura</p>
          )}
          <div
            className="prose-invert text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(activeStep.content) }}
          />
          {activeStep.code_snippet && (
            <pre className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-xs overflow-x-auto">
              <code>{activeStep.code_snippet}</code>
            </pre>
          )}
          {!isCompleted && (
            <button
              onClick={() => markComplete(activeStep.id)}
              className="mt-8 rounded-xl bg-[#8bd450] px-6 py-3 text-sm font-semibold text-black hover:bg-[#9be060]"
            >
              Marcar como concluido
            </button>
          )}
        </main>
      </div>
    )
  }

  // ── Module View ──
  if (view === 'module' && activeModule) {
    const steps = activeModule.steps || []
    return (
      <div className="min-h-screen bg-[#090b10] text-zinc-100">
        <header className="sticky top-0 z-10 border-b border-white/6 bg-[#090b10]/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <button onClick={() => { setView('main'); setTab('dashboard') }} className="text-sm text-zinc-400 hover:text-white">← Voltar</button>
            <span className="text-xs text-zinc-600">|</span>
            <span className="text-sm font-medium">{activeModule.title}</span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">
          <p className="text-sm text-zinc-400">{activeModule.description}</p>
          <div className="mt-6 space-y-2">
            {steps.map((step, i) => {
              const locked = !isPro && activeModule.tier === 'pro'
              return (
                <button
                  key={step.id}
                  onClick={() => { if (!locked) { setActiveStep(step); setView('step') } }}
                  disabled={locked}
                  className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                    locked ? 'border-white/4 bg-white/2 opacity-50 cursor-not-allowed' :
                    step.is_completed ? 'border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10' :
                    'border-white/8 bg-white/3 hover:bg-white/5'
                  }`}
                >
                  <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    step.is_completed ? 'bg-emerald-500 text-black' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {step.is_completed ? '✓' : i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{step.title}</p>
                    {step.duration_min && <p className="text-xs text-zinc-500">{step.duration_min} min</p>}
                  </div>
                  {locked && <span className="text-xs text-zinc-500">PRO</span>}
                  {step.step_type === 'challenge' && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400">Desafio</span>}
                </button>
              )
            })}
          </div>
        </main>
      </div>
    )
  }

  // ── Agent View ──
  if (view === 'agent') {
    return (
      <div className="min-h-screen bg-[#090b10] text-zinc-100">
        <header className="sticky top-0 z-10 border-b border-white/6 bg-[#090b10]/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <button onClick={() => setView('main')} className="text-sm text-zinc-400 hover:text-white">← Voltar</button>
            <span className="text-xs text-zinc-600">|</span>
            <span className="text-sm font-medium">Jarbas Voice Agent</span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8 text-center">
          <h2 className="text-2xl font-bold">Converse com o Jarbas</h2>
          <p className="mt-2 text-sm text-zinc-400">
            CTO virtual em acao. Acesso a projetos, tarefas, receita e WhatsApp em tempo real.
          </p>
          <div className="mt-8 rounded-2xl border border-white/10 bg-[#10141b] p-8">
            <elevenlabs-convai agent-id={ELEVENLABS_AGENT_ID}></elevenlabs-convai>
            <p className="mt-4 text-xs text-zinc-500">
              Experimente: "Como ta o MRR?", "Quais tasks estao abertas?", "Briefing do dia"
            </p>
          </div>
        </main>
      </div>
    )
  }

  // ── Video View ──
  if (view === 'video' && activeVideo) {
    const locked = !isPro && activeVideo.tier === 'pro'
    return (
      <div className="min-h-screen bg-[#090b10] text-zinc-100">
        <header className="sticky top-0 z-10 border-b border-white/6 bg-[#090b10]/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center gap-3">
            <button onClick={() => { setView('main'); setTab('aulas') }} className="text-sm text-zinc-400 hover:text-white">← Aulas</button>
            <span className="text-xs text-zinc-600">|</span>
            <span className="text-sm font-medium truncate">{activeVideo.title}</span>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6">
          {locked ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-10 text-center">
              <p className="text-4xl mb-4">🔒</p>
              <h3 className="text-lg font-bold text-amber-400">Conteudo PRO</h3>
              <p className="mt-2 text-sm text-zinc-400">Este video e exclusivo para membros PRO.</p>
              <Link to="/comunidade" className="mt-4 inline-block rounded-xl bg-[#8bd450] px-6 py-2.5 text-sm font-semibold text-black hover:bg-[#9be060]">
                Fazer upgrade PRO
              </Link>
            </div>
          ) : (
            <>
              <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
                <iframe
                  src={`https://www.youtube.com/embed/${activeVideo.id}?autoplay=1&rel=0`}
                  title={activeVideo.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
              <div className="mt-5">
                <span className="rounded-full bg-[#8bd450]/20 px-2.5 py-1 text-xs text-[#8bd450]">{activeVideo.tag}</span>
                <h2 className="mt-3 text-xl font-bold">{activeVideo.title}</h2>
                <p className="mt-2 text-sm text-zinc-400">{activeVideo.desc}</p>
                <p className="mt-1 text-xs text-zinc-600">{activeVideo.duration}</p>
              </div>
            </>
          )}
        </main>
        <script src="https://elevenlabs.io/convai-widget/index.js" async type="text/javascript"></script>
      </div>
    )
  }

  // ── Main Layout ──
  const TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: '⚡' },
    { id: 'aulas', label: 'Aulas', icon: '🎬' },
    { id: 'comunidade', label: 'Comunidade', icon: '💬' },
    { id: 'ranking', label: 'Ranking', icon: '🏆' },
  ]

  return (
    <div className="min-h-screen bg-[#090b10] text-zinc-100">
      {/* Top header */}
      <header className="border-b border-white/6 px-4 py-3 sticky top-0 z-20 bg-[#090b10]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-widest text-[#8bd450]">GuyFolkz Academy</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isPro ? 'bg-[#8bd450]/20 text-[#8bd450]' : 'bg-zinc-700 text-zinc-400'
            }`}>
              {isPro ? 'PRO' : 'FREE'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-zinc-500 sm:block">
              {member.name || 'Membro'}
            </span>
            <button onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300">Sair</button>
          </div>
        </div>
      </header>

      {/* Tab nav */}
      <div className="border-b border-white/6 bg-[#090b10]">
        <div className="mx-auto flex max-w-5xl overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setView('main') }}
              className={`flex items-center gap-1.5 whitespace-nowrap px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-[#8bd450] text-[#8bd450]'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* ── DASHBOARD TAB ── */}
        {tab === 'dashboard' && (
          <div className="space-y-6">
            {/* Progress */}
            <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Ola, {member.name || 'membro'}!</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Seu progresso na Academy</p>
                </div>
                <p className="text-2xl font-bold text-[#8bd450]">{progress}%</p>
              </div>
              <div className="mt-3 h-2 rounded-full bg-zinc-800">
                <div className="h-2 rounded-full bg-[#8bd450] transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-xs text-zinc-500">{completedSteps} de {totalSteps} etapas concluidas</p>
            </div>

            {/* Quick Actions */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <button
                onClick={() => setView('agent')}
                className="rounded-2xl border border-[#8bd450]/20 bg-[#8bd450]/5 p-4 text-left transition-colors hover:bg-[#8bd450]/10"
              >
                <p className="text-lg">🤖</p>
                <p className="mt-2 text-sm font-semibold text-[#8bd450]">Jarbas Voice</p>
                <p className="mt-0.5 text-xs text-zinc-400">CTO virtual ao vivo</p>
              </button>
              <a
                href="https://t.me/+COMMUNITY_LINK"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-left transition-colors hover:bg-blue-500/10"
              >
                <p className="text-lg">✈️</p>
                <p className="mt-2 text-sm font-semibold text-blue-400">Telegram</p>
                <p className="mt-0.5 text-xs text-zinc-400">Grupo privado</p>
              </a>
              <button
                onClick={() => setTab('aulas')}
                className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4 text-left transition-colors hover:bg-purple-500/10"
              >
                <p className="text-lg">🎬</p>
                <p className="mt-2 text-sm font-semibold text-purple-400">Aulas</p>
                <p className="mt-0.5 text-xs text-zinc-400">{ACADEMY_VIDEOS.length} videos React</p>
              </button>
              <Link
                to="/comunidade"
                className={`rounded-2xl border p-4 text-left transition-colors ${
                  isPro ? 'border-white/8 bg-white/3 hover:bg-white/5' : 'border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10'
                }`}
              >
                <p className="text-lg">{isPro ? '⚙️' : '⬆️'}</p>
                <p className={`mt-2 text-sm font-semibold ${isPro ? 'text-zinc-300' : 'text-amber-400'}`}>
                  {isPro ? 'Assinatura' : 'Upgrade PRO'}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {isPro ? 'Billing portal' : 'Desbloquear tudo'}
                </p>
              </Link>
            </div>

            {/* Desafios da semana */}
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>🏆</span> Desafios da Semana
              </h2>
              <div className="mt-3 space-y-2">
                {WEEKLY_CHALLENGES.map(ch => (
                  <div key={ch.id} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3">
                    <span className="text-xl">{ch.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{ch.title}</p>
                      <p className="text-xs text-zinc-400 truncate">{ch.desc}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400">
                      +{ch.reward}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Modulos */}
            <div>
              <h2 className="text-base font-bold">Modulos</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {modules.map((m) => {
                  const locked = !isPro && m.tier === 'pro'
                  return (
                    <button
                      key={m.id || m.slug}
                      onClick={() => { if (!locked) loadModule(m.slug) }}
                      disabled={locked}
                      className={`rounded-2xl border p-4 text-left transition-colors ${
                        locked ? 'border-white/4 bg-white/2 opacity-60 cursor-not-allowed' :
                        'border-white/8 bg-white/3 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{m.icon || '📘'}</span>
                        {m.tier === 'pro' && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            locked ? 'bg-zinc-700 text-zinc-500' : 'bg-[#8bd450]/10 text-[#8bd450]'
                          }`}>PRO</span>
                        )}
                      </div>
                      <h3 className="mt-2 text-sm font-semibold leading-snug">{m.title}</h3>
                      <p className="mt-1 text-xs text-zinc-400 line-clamp-2">{m.description}</p>
                      {m.step_count > 0 && (
                        <p className="mt-2 text-[10px] text-zinc-500">{m.step_count} etapas · {m.duration_min} min</p>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── AULAS TAB ── */}
        {tab === 'aulas' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold">Sala de Aulas</h2>
              <p className="text-sm text-zinc-400 mt-1">Serie React — cases reais de IA e automacao</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {ACADEMY_VIDEOS.map((v) => {
                const locked = !isPro && v.tier === 'pro'
                return (
                  <button
                    key={v.id}
                    onClick={() => { setActiveVideo(v); setView('video') }}
                    className={`rounded-2xl border text-left overflow-hidden transition-all hover:scale-[1.01] ${
                      locked ? 'border-white/6 opacity-80' : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="relative aspect-video bg-zinc-900">
                      <img
                        src={`https://img.youtube.com/vi/${v.id}/hqdefault.jpg`}
                        alt={v.title}
                        className="h-full w-full object-cover"
                      />
                      {locked && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                          <span className="text-3xl">🔒</span>
                        </div>
                      )}
                      {!locked && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity">
                          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90">
                            <svg className="ml-1 h-6 w-6 text-black" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="rounded-full bg-[#8bd450]/20 px-2 py-0.5 text-[10px] text-[#8bd450]">{v.tag}</span>
                        {locked && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400">PRO</span>}
                        <span className="ml-auto text-[10px] text-zinc-500">{v.duration}</span>
                      </div>
                      <h3 className="text-sm font-semibold leading-snug">{v.title}</h3>
                      <p className="mt-1 text-xs text-zinc-400 line-clamp-2">{v.desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── COMUNIDADE TAB ── */}
        {tab === 'comunidade' && (
          <LiveFeedTab phone={phone} />
        )}

        {/* ── RANKING TAB ── */}
        {tab === 'ranking' && (
          <div className="space-y-4 max-w-2xl">
            <div>
              <h2 className="text-lg font-bold">Ranking de Membros</h2>
              <p className="text-sm text-zinc-400 mt-1">Quem esta avancando mais na Academy</p>
            </div>

            {leaderboard.length === 0 ? (
              <div className="rounded-2xl border border-white/8 bg-white/3 p-8 text-center">
                <p className="text-3xl mb-3">🏆</p>
                <p className="text-sm text-zinc-400">Seja o primeiro a completar etapas!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((leader, i) => {
                  const isMe = phone && leader.phone_masked.startsWith(phone.slice(0, 3))
                  const medals = ['🥇', '🥈', '🥉']
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                        isMe ? 'border-[#8bd450]/30 bg-[#8bd450]/5' : 'border-white/8 bg-white/3'
                      }`}
                    >
                      <span className="text-lg w-7 text-center">
                        {i < 3 ? medals[i] : <span className="text-sm font-bold text-zinc-500">#{leader.rank}</span>}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{leader.name}</p>
                        <p className="text-[10px] text-zinc-500">{leader.phone_masked}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-[#8bd450]">{leader.completed_steps}</p>
                        <p className="text-[10px] text-zinc-500">etapas</p>
                      </div>
                      {leader.tier === 'pro' && (
                        <span className="rounded-full bg-[#8bd450]/10 px-2 py-0.5 text-[10px] text-[#8bd450]">PRO</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </main>

      <script src="https://elevenlabs.io/convai-widget/index.js" async type="text/javascript"></script>
    </div>
  )
}


// ─── Live Feed Tab (API-backed) ─────────────────────────────────────────────

function LiveFeedTab({ phone }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [newPost, setNewPost] = useState('')
  const [postType, setPostType] = useState('discussion')
  const [posting, setPosting] = useState(false)

  const communityToken = localStorage.getItem('community_token')

  async function communityFetch(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    if (communityToken) headers['Authorization'] = `Bearer ${communityToken}`
    const res = await fetch(`${API}${path}`, { ...opts, headers })
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
  }

  async function loadFeed() {
    try {
      const data = await communityFetch('/api/community/feed?limit=30')
      setPosts(data.posts || data || [])
    } catch {
      setPosts(COMMUNITY_POSTS.map(p => ({
        id: p.id, author_name: p.author, author_role: 'admin',
        content_md: p.content, post_type: 'announcement',
        likes_count: p.likes, comments_count: p.replies || 0,
        liked_by_me: false, pinned: p.pinned || false,
        created_at: new Date().toISOString(),
      })))
    }
    setLoading(false)
  }

  useEffect(() => { loadFeed() }, [])

  async function handleCreatePost(e) {
    e.preventDefault()
    if (!newPost.trim() || !communityToken) return
    setPosting(true)
    try {
      await communityFetch('/api/community/post', {
        method: 'POST',
        body: JSON.stringify({ content_md: newPost.trim(), post_type: postType }),
      })
      setNewPost('')
      setPostType('discussion')
      loadFeed()
    } catch {}
    setPosting(false)
  }

  async function handleLike(postId) {
    if (!communityToken) return
    try {
      await communityFetch(`/api/community/post/${postId}/like`, { method: 'POST' })
      setPosts(prev => prev.map(p =>
        p.id === postId
          ? { ...p, liked_by_me: !p.liked_by_me, likes_count: p.likes_count + (p.liked_by_me ? -1 : 1) }
          : p
      ))
    } catch {}
  }

  function timeAgo(iso) {
    if (!iso) return ''
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}d`
  }

  const POST_TYPES = {
    discussion: { label: 'Discussao', color: 'text-blue-400 bg-blue-400/10' },
    resource: { label: 'Recurso', color: 'text-green-400 bg-green-400/10' },
    announcement: { label: 'Anuncio', color: 'text-yellow-400 bg-yellow-400/10' },
    question: { label: 'Pergunta', color: 'text-purple-400 bg-purple-400/10' },
  }

  if (loading) return <div className="text-center text-zinc-500 py-8">Carregando feed...</div>

  return (
    <div className="space-y-4 max-w-2xl">
      <h2 className="text-lg font-bold">Feed da Comunidade</h2>

      {/* Create post */}
      {communityToken ? (
        <form onSubmit={handleCreatePost} className="rounded-2xl border border-white/8 bg-white/3 p-4 space-y-3">
          <textarea
            value={newPost}
            onChange={e => setNewPost(e.target.value)}
            placeholder="Compartilhe algo com a comunidade..."
            rows={3}
            className="w-full bg-transparent border border-white/10 rounded-xl p-3 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-[#8bd450]/40"
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {Object.entries(POST_TYPES).map(([key, cfg]) => (
                <button
                  key={key} type="button"
                  onClick={() => setPostType(key)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                    postType === key ? cfg.color + ' ring-1 ring-current' : 'text-zinc-500 bg-white/5'
                  }`}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={posting || !newPost.trim()}
              className="rounded-xl bg-[#8bd450] px-4 py-1.5 text-xs font-semibold text-black hover:bg-[#7cc340] disabled:opacity-40 transition-colors"
            >
              {posting ? 'Publicando...' : 'Publicar'}
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-2xl border border-white/8 bg-white/3 p-4 text-center text-xs text-zinc-500">
          Faca login para publicar na comunidade
        </div>
      )}

      {/* Posts */}
      <div className="space-y-3">
        {posts.map(post => {
          const typeCfg = POST_TYPES[post.post_type] || POST_TYPES.discussion
          return (
            <div key={post.id} className={`rounded-2xl border p-4 ${
              post.pinned ? 'border-[#8bd450]/30 bg-[#8bd450]/5' : 'border-white/8 bg-white/3'
            }`}>
              {post.pinned && (
                <p className="text-[10px] text-[#8bd450] mb-2 font-medium">FIXADO</p>
              )}
              <div className="flex items-center gap-2 mb-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                  post.author_role === 'admin' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                }`}>
                  {(post.author_name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{post.author_name || 'Membro'}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                      post.author_role === 'admin' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                    }`}>
                      {post.author_role === 'admin' ? 'Admin' : 'Membro'}
                    </span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${typeCfg.color}`}>
                      {typeCfg.label}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-500">{timeAgo(post.created_at)}</p>
                </div>
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{post.content_md}</p>
              <div className="mt-3 flex items-center gap-4 pt-2 border-t border-white/5">
                <button
                  onClick={() => handleLike(post.id)}
                  className={`flex items-center gap-1.5 text-xs transition-colors ${
                    post.liked_by_me ? 'text-red-400' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <span>{post.liked_by_me ? '\u2764\ufe0f' : '\u{1f90d}'}</span>
                  <span>{post.likes_count || 0}</span>
                </button>
                <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <span>\ud83d\udcac</span>
                  <span>{post.comments_count || 0}</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {posts.length === 0 && (
        <div className="rounded-2xl border border-white/8 bg-white/3 p-8 text-center">
          <p className="text-sm text-zinc-400">Nenhum post ainda. Seja o primeiro!</p>
        </div>
      )}
    </div>
  )
}
