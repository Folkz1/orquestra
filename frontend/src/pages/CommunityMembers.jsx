import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || ''
const ELEVENLABS_AGENT_ID = 'agent_2001kmexxj04e4k9w0vkdrxt3zk2'

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
  const [activeModule, setActiveModule] = useState(null)
  const [activeStep, setActiveStep] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState('dashboard') // dashboard, module, step, agent

  // Auto-login if enrolled=true in URL
  useEffect(() => {
    if (params.get('enrolled') === 'true' && phone) {
      handleLogin()
    }
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
      setMember(data)
      localStorage.setItem('community_phone', phone.trim())
      // Load modules
      const mRes = await fetch(`${API}/api/playbook/modules`)
      const mData = await mRes.json()
      setModules(mData)
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
    // Reload module
    if (activeModule) loadModule(activeModule.slug)
  }

  function logout() {
    setMember(null)
    localStorage.removeItem('community_phone')
    setView('dashboard')
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
            Ainda nao e membro? <Link to="/comunidade" className="text-[#8bd450] hover:underline">Assine aqui</Link>
          </p>
        </div>
      </div>
    )
  }

  const isPro = member.tier === 'pro'
  const completedSteps = member.completed_steps || []

  // ── Step View ──
  if (view === 'step' && activeStep) {
    const isCompleted = completedSteps.includes(activeStep.id)
    return (
      <div className="min-h-screen bg-[#090b10] text-zinc-100">
        <header className="sticky top-0 z-10 border-b border-white/6 bg-[#090b10]/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <button onClick={() => setView('module')} className="text-sm text-zinc-400 hover:text-white">Voltar</button>
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
            <button onClick={() => setView('dashboard')} className="text-sm text-zinc-400 hover:text-white">Voltar</button>
            <span className="text-xs text-zinc-600">|</span>
            <span className="text-sm font-medium">{activeModule.title}</span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">
          <p className="text-sm text-zinc-400">{activeModule.description}</p>
          <div className="mt-6 space-y-2">
            {steps.map((step, i) => {
              const done = completedSteps.includes(step.id)
              const locked = !isPro && activeModule.tier === 'pro'
              return (
                <button
                  key={step.id}
                  onClick={() => { if (!locked) { setActiveStep(step); setView('step') } }}
                  disabled={locked}
                  className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                    locked ? 'border-white/4 bg-white/2 opacity-50 cursor-not-allowed' :
                    done ? 'border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10' :
                    'border-white/8 bg-white/3 hover:bg-white/5'
                  }`}
                >
                  <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    done ? 'bg-emerald-500 text-black' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {done ? '✓' : i + 1}
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

  // ── Agent Demo View ──
  if (view === 'agent') {
    return (
      <div className="min-h-screen bg-[#090b10] text-zinc-100">
        <header className="sticky top-0 z-10 border-b border-white/6 bg-[#090b10]/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <button onClick={() => setView('dashboard')} className="text-sm text-zinc-400 hover:text-white">Voltar</button>
            <span className="text-xs text-zinc-600">|</span>
            <span className="text-sm font-medium">Jarbas Voice Agent</span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8 text-center">
          <h2 className="text-2xl font-bold">Converse com o Jarbas</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Este e o CTO virtual em acao. Ele tem acesso a dados reais: projetos, tarefas, receita, WhatsApp.
          </p>
          <div className="mt-8 rounded-2xl border border-white/10 bg-[#10141b] p-8">
            <p className="text-sm text-zinc-400 mb-4">Widget de voz ElevenLabs</p>
            <elevenlabs-convai agent-id={ELEVENLABS_AGENT_ID}></elevenlabs-convai>
            <p className="mt-4 text-xs text-zinc-500">
              Experimente: "Como ta o MRR?", "Quais tasks estao abertas?", "Me da o briefing do dia"
            </p>
          </div>
          {isPro && (
            <div className="mt-6 rounded-xl border border-[#8bd450]/20 bg-[#8bd450]/5 p-4">
              <p className="text-sm font-medium text-[#8bd450]">Quer um agente assim pra sua empresa?</p>
              <p className="mt-1 text-xs text-zinc-400">No plano Managed (R$500/mes), configuramos e mantemos um daemon igual pra voce.</p>
            </div>
          )}
        </main>
      </div>
    )
  }

  // ── Dashboard ──
  const totalSteps = modules.reduce((sum, m) => sum + (m.step_count || 0), 0)
  const progress = totalSteps > 0 ? Math.round((completedSteps.length / totalSteps) * 100) : 0

  return (
    <div className="min-h-screen bg-[#090b10] text-zinc-100">
      <header className="border-b border-white/6 px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[#8bd450]">GuyFolkz Academy</p>
            <h1 className="mt-1 text-lg font-bold">
              Ola, {member.name || 'membro'}
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                isPro ? 'bg-[#8bd450]/20 text-[#8bd450]' : 'bg-zinc-700 text-zinc-400'
              }`}>
                {isPro ? 'PRO' : 'FREE'}
              </span>
            </h1>
          </div>
          <button onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300">Sair</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
        {/* Progress Bar */}
        <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Progresso geral</p>
            <p className="text-sm text-[#8bd450]">{progress}%</p>
          </div>
          <div className="mt-3 h-2 rounded-full bg-zinc-800">
            <div className="h-2 rounded-full bg-[#8bd450] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">{completedSteps.length} de {totalSteps} etapas concluidas</p>
        </div>

        {/* Quick Actions */}
        <div className="grid gap-3 sm:grid-cols-3">
          <button
            onClick={() => setView('agent')}
            className="rounded-2xl border border-[#8bd450]/20 bg-[#8bd450]/5 p-4 text-left transition-colors hover:bg-[#8bd450]/10"
          >
            <p className="text-sm font-semibold text-[#8bd450]">Jarbas Voice</p>
            <p className="mt-1 text-xs text-zinc-400">Converse com o CTO virtual ao vivo</p>
          </button>
          <a
            href="https://t.me/+COMMUNITY_LINK"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-left transition-colors hover:bg-blue-500/10"
          >
            <p className="text-sm font-semibold text-blue-400">Comunidade Telegram</p>
            <p className="mt-1 text-xs text-zinc-400">Grupo privado de membros</p>
          </a>
          <Link
            to="/comunidade"
            className={`rounded-2xl border p-4 text-left transition-colors ${
              isPro ? 'border-white/8 bg-white/3 hover:bg-white/5' : 'border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10'
            }`}
          >
            <p className={`text-sm font-semibold ${isPro ? 'text-zinc-300' : 'text-amber-400'}`}>
              {isPro ? 'Gerenciar assinatura' : 'Upgrade pra PRO'}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {isPro ? 'Stripe billing portal' : 'Desbloqueie todos os modulos'}
            </p>
          </Link>
        </div>

        {/* Modules Grid */}
        <div>
          <h2 className="text-lg font-bold">Modulos</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((m) => {
              const locked = !isPro && m.tier === 'pro'
              const modCompleted = completedSteps.filter(s =>
                (m.steps || []).some(ms => ms.id === s)
              ).length
              const modTotal = m.step_count || 0
              return (
                <button
                  key={m.id || m.slug}
                  onClick={() => { if (!locked) loadModule(m.slug) }}
                  disabled={locked}
                  className={`rounded-2xl border p-5 text-left transition-colors ${
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
                  <h3 className="mt-3 text-sm font-semibold">{m.title}</h3>
                  <p className="mt-1 text-xs text-zinc-400 line-clamp-2">{m.description}</p>
                  {modTotal > 0 && (
                    <div className="mt-3">
                      <div className="h-1 rounded-full bg-zinc-800">
                        <div className="h-1 rounded-full bg-[#8bd450]" style={{ width: `${(modCompleted / modTotal) * 100}%` }} />
                      </div>
                      <p className="mt-1 text-[10px] text-zinc-500">{modCompleted}/{modTotal} etapas</p>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </main>

      {/* ElevenLabs widget script */}
      <script src="https://elevenlabs.io/convai-widget/index.js" async type="text/javascript"></script>
    </div>
  )
}
