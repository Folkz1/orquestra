import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || ''

const ACADEMY_VIDEOS = [
  { id: 'iNdg_WGWXRI', tier: 'free', title: 'Crianca de 15 anos fez $50K instalando IA', desc: 'Caso real de execucao.', duration: '18 min', tag: 'Mindset' },
  { id: 'PLi5NfSa0uA', tier: 'free', title: 'App de R$100M codado aos 18 anos', desc: 'Vibe coding virou business.', duration: '22 min', tag: 'Case Real' },
  { id: 'neBEx5i_7lM', tier: 'pro', title: 'Para de criar agentes e cria skills', desc: 'Skills vencem quando o produto precisa de contexto.', duration: '25 min', tag: 'Estrategia' },
  { id: 'rHiq3-609VE', tier: 'pro', title: 'Claude controla teu computador', desc: 'O que muda quando a IA opera o PC inteiro.', duration: '30 min', tag: 'Tech' },
]

function normalizePhone(value) {
  return (value || '').replace(/\D/g, '')
}

function getCommunityToken() {
  return localStorage.getItem('community_token') || ''
}

async function readErrorMessage(res, fallbackMessage) {
  const data = await res.json().catch(() => ({}))
  const detail = data?.detail
  if (typeof detail === 'string') return detail
  if (detail?.message) return detail.message
  if (typeof data?.message === 'string') return data.message
  return fallbackMessage
}

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('pt-BR')
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('pt-BR')
}

function markdownToHtml(md) {
  if (!md) return ''
  return md
    .replace(/^### (.+)$/gm, '<h3 class="mt-4 mb-2 text-base font-semibold">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="mt-6 mb-3 text-lg font-bold">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-emerald-400">$1</code>')
    .replace(/\n\n/g, '</p><p class="my-2 text-zinc-300">')
}

export default function CommunityMembers() {
  const [params] = useSearchParams()
  const [phone, setPhone] = useState(() => normalizePhone(localStorage.getItem('community_phone') || ''))
  const [member, setMember] = useState(null)
  const [modules, setModules] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [membersList, setMembersList] = useState([])
  const [resources, setResources] = useState([])
  const [activeModule, setActiveModule] = useState(null)
  const [activeStep, setActiveStep] = useState(null)
  const [activeVideo, setActiveVideo] = useState(null)
  const [tab, setTab] = useState('dashboard')
  const [view, setView] = useState('main')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState('')
  const [resourcesLoading, setResourcesLoading] = useState(false)
  const [resourcesError, setResourcesError] = useState('')

  const accessMode = member?.access_mode || 'free'
  const isTrial = accessMode === 'manual_trial'
  const isAdmin = member?.role === 'admin'
  const hasContentAccess = Boolean(member) && (isAdmin || ['manual_trial', 'paid_manual', 'member'].includes(accessMode) || member?.tier === 'pro')
  const showSocial = Boolean(member) && !isTrial
  const showMembers = showSocial
  const showRanking = showSocial
  const showResources = Boolean(member) && (!isTrial || resources.length > 0 || resourcesLoading)
  const completedSteps = member?.completed_steps || 0
  const totalSteps = Math.max(member?.total_steps || 0, 1)
  const progress = Math.min(100, Math.round((completedSteps / totalSteps) * 100))
  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'aulas', label: 'Aulas' },
    ...(showResources ? [{ id: 'recursos', label: 'Recursos' }] : []),
    ...(showSocial ? [{ id: 'comunidade', label: 'Comunidade' }] : []),
    ...(showMembers ? [{ id: 'membros', label: 'Membros' }] : []),
    ...(showRanking ? [{ id: 'ranking', label: 'Ranking' }] : []),
  ]

  async function fetchMemberProgress(phoneValue) {
    const res = await fetch(`${API}/api/playbook/progress/${phoneValue}`)
    if (!res.ok) throw new Error(await readErrorMessage(res, 'WhatsApp nao encontrado.'))
    return res.json()
  }

  async function fetchCommunityJwt(phoneValue) {
    const res = await fetch(`${API}/api/community/auth/login-phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneValue }),
    })
    if (!res.ok) throw new Error(await readErrorMessage(res, 'Nao foi possivel autenticar teu acesso agora.'))
    const data = await res.json()
    if (data?.token) localStorage.setItem('community_token', data.token)
    return data?.token || null
  }

  async function loadBaseData() {
    const [modulesData, leaderboardData] = await Promise.all([
      fetch(`${API}/api/playbook/modules`).then((res) => (res.ok ? res.json().catch(() => []) : [])).catch(() => []),
      fetch(`${API}/api/playbook/leaderboard`).then((res) => (res.ok ? res.json().catch(() => []) : [])).catch(() => []),
    ])
    setModules(Array.isArray(modulesData) ? modulesData : [])
    setLeaderboard(Array.isArray(leaderboardData) ? leaderboardData : [])
  }

  async function loadResources() {
    setResourcesLoading(true)
    setResourcesError('')
    try {
      const res = await fetch(`${API}/api/community/resources`)
      const data = await res.json().catch(() => ({}))
      setResources(Array.isArray(data?.resources) ? data.resources : [])
    } catch {
      setResourcesError('Nao foi possivel carregar os recursos agora')
      setResources([])
    } finally {
      setResourcesLoading(false)
    }
  }

  async function loadMembers() {
    setMembersLoading(true)
    setMembersError('')
    try {
      const res = await fetch(`${API}/api/community/members`)
      const data = await res.json().catch(() => ({}))
      setMembersList(Array.isArray(data?.members) ? data.members : [])
    } catch {
      setMembersError('Nao foi possivel carregar os membros agora')
      setMembersList([])
    } finally {
      setMembersLoading(false)
    }
  }

  async function bootstrapMember(phoneValue) {
    const normalizedPhone = normalizePhone(phoneValue)
    if (!normalizedPhone) throw new Error('Informe seu WhatsApp')
    const data = await fetchMemberProgress(normalizedPhone)
    setMember(data)
    setPhone(normalizedPhone)
    localStorage.setItem('community_phone', normalizedPhone)
    await fetchCommunityJwt(normalizedPhone)
    await Promise.all([loadBaseData(), loadResources()])
    return data
  }

  useEffect(() => {
    const queryPhone = normalizePhone(params.get('phone') || '')
    const savedPhone = queryPhone || normalizePhone(localStorage.getItem('community_phone') || '')
    const shouldBootstrap = params.get('trial') === '1' || params.get('enrolled') === 'true' || Boolean(getCommunityToken())
    if (!savedPhone || !shouldBootstrap) return

    let cancelled = false
    setLoading(true)
    setError('')
    bootstrapMember(savedPhone)
      .then(() => {
        if (!cancelled && (params.get('trial') === '1' || params.get('enrolled') === 'true')) {
          window.history.replaceState({}, document.title, '/membros')
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Nao foi possivel liberar teu acesso agora.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [params])

  useEffect(() => {
    if (!member) return
    const allowed = new Set(tabs.map((item) => item.id))
    if (!allowed.has(tab)) setTab('dashboard')
  }, [member, tab, showResources, showSocial, showMembers, showRanking])

  useEffect(() => {
    if (!member || !showMembers || tab !== 'membros' || membersList.length > 0 || membersLoading) return
    loadMembers()
  }, [member, showMembers, tab, membersList.length, membersLoading])

  async function handleLogin(e) {
    e?.preventDefault()
    const normalizedPhone = normalizePhone(phone)
    if (!normalizedPhone) {
      setError('Informe seu WhatsApp')
      return
    }
    setLoading(true)
    setError('')
    try {
      await bootstrapMember(normalizedPhone)
    } catch (err) {
      setError(err.message || 'Erro ao acessar')
    } finally {
      setLoading(false)
    }
  }

  async function handleDownloadResource(resourceId) {
    const token = getCommunityToken()
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    setResourcesError('')
    try {
      const res = await fetch(`${API}/api/community/resource/${resourceId}/download`, { method: 'POST', headers })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Nao foi possivel abrir esse recurso'))
      const data = await res.json().catch(() => ({}))
      if (!data?.download_url || data.download_url === '#') throw new Error('Esse recurso ainda esta sendo liberado')
      setResources((prev) => prev.map((item) => (item.id === resourceId ? { ...item, downloads_count: data.downloads_count ?? item.downloads_count } : item)))
      window.open(data.download_url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setResourcesError(err.message || 'Nao foi possivel baixar esse recurso')
    }
  }

  async function loadModule(slug) {
    setError('')
    const res = await fetch(`${API}/api/playbook/modules/${slug}?phone=${phone}`)
    if (!res.ok) {
      setError(await readErrorMessage(res, 'Nao foi possivel abrir esse modulo agora.'))
      return
    }
    const data = await res.json()
    setActiveModule(data)
    setActiveStep(null)
    setView('module')
  }

  async function markComplete(stepId) {
    const res = await fetch(`${API}/api/playbook/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, step_id: stepId }),
    })
    if (!res.ok) {
      setError(await readErrorMessage(res, 'Nao foi possivel registrar teu progresso agora.'))
      return
    }
    if (activeModule) await loadModule(activeModule.slug)
    const progressRes = await fetch(`${API}/api/playbook/progress/${phone}`)
    if (progressRes.ok) setMember(await progressRes.json())
  }

  function logout() {
    localStorage.removeItem('community_phone')
    localStorage.removeItem('community_token')
    localStorage.removeItem('community_checkout_context')
    setMember(null)
    setModules([])
    setLeaderboard([])
    setMembersList([])
    setResources([])
    setActiveModule(null)
    setActiveStep(null)
    setActiveVideo(null)
    setTab('dashboard')
    setView('main')
    setError('')
  }

  if (!member) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090b10] px-4">
        <div className="w-full max-w-sm">
          <div className="text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-[#8bd450]">GuyFolkz Academy</p>
            <h1 className="mt-3 text-2xl font-bold text-white">Area de Membros</h1>
            <p className="mt-2 text-sm text-zinc-400">
              {params.get('trial') === '1' ? 'Teu acesso de 6 horas foi liberado. Entra com o WhatsApp que voce cadastrou.' : 'Entre com seu WhatsApp cadastrado.'}
            </p>
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
            <button type="submit" disabled={loading} className="w-full rounded-xl bg-[#8bd450] py-3 text-sm font-semibold text-black hover:bg-[#9be060] disabled:opacity-50">
              {loading ? 'Verificando...' : 'Entrar'}
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-zinc-500">
            Ainda nao entrou? <Link to="/comunidade" className="text-[#8bd450] hover:underline">Liberar acesso aqui</Link>
          </p>
        </div>
      </div>
    )
  }

  if (view === 'step' && activeStep) {
    return (
      <div className="min-h-screen bg-[#090b10] text-zinc-100">
        <header className="sticky top-0 z-10 border-b border-white/6 bg-[#090b10]/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <button onClick={() => setView('module')} className="text-sm text-zinc-400 hover:text-white">Voltar</button>
            <span className="text-xs text-zinc-600">|</span>
            <span className="text-sm font-medium">{activeStep.title}</span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">
          {activeStep.duration_min && <p className="mb-4 text-xs text-zinc-500">{activeStep.duration_min} min de leitura</p>}
          <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: markdownToHtml(activeStep.content) }} />
          {activeStep.code_snippet && (
            <pre className="mt-6 overflow-x-auto rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-xs"><code>{activeStep.code_snippet}</code></pre>
          )}
          {!activeStep.is_completed && (
            <button onClick={() => markComplete(activeStep.id)} className="mt-8 rounded-xl bg-[#8bd450] px-6 py-3 text-sm font-semibold text-black hover:bg-[#9be060]">
              Marcar como concluido
            </button>
          )}
        </main>
      </div>
    )
  }

  if (view === 'module' && activeModule) {
    return (
      <div className="min-h-screen bg-[#090b10] text-zinc-100">
        <header className="sticky top-0 z-10 border-b border-white/6 bg-[#090b10]/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <button onClick={() => { setView('main'); setTab('dashboard') }} className="text-sm text-zinc-400 hover:text-white">Voltar</button>
            <span className="text-xs text-zinc-600">|</span>
            <span className="text-sm font-medium">{activeModule.title}</span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">
          <p className="text-sm text-zinc-400">{activeModule.description}</p>
          <div className="mt-6 space-y-2">
            {(activeModule.steps || []).map((step, index) => (
              <button
                key={step.id}
                onClick={() => { setActiveStep(step); setView('step') }}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                  step.is_completed ? 'border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10' : 'border-white/8 bg-white/3 hover:bg-white/5'
                }`}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${step.is_completed ? 'bg-emerald-500 text-black' : 'bg-zinc-800 text-zinc-400'}`}>
                  {step.is_completed ? 'OK' : index + 1}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{step.title}</p>
                  {step.duration_min && <p className="text-xs text-zinc-500">{step.duration_min} min</p>}
                </div>
              </button>
            ))}
          </div>
        </main>
      </div>
    )
  }

  if (view === 'video' && activeVideo) {
    const locked = activeVideo.tier === 'pro' && !hasContentAccess
    return (
      <div className="min-h-screen bg-[#090b10] text-zinc-100">
        <header className="sticky top-0 z-10 border-b border-white/6 bg-[#090b10]/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center gap-3">
            <button onClick={() => { setView('main'); setTab('aulas') }} className="text-sm text-zinc-400 hover:text-white">Aulas</button>
            <span className="text-xs text-zinc-600">|</span>
            <span className="truncate text-sm font-medium">{activeVideo.title}</span>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6">
          {locked ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-10 text-center">
              <h3 className="text-lg font-bold text-amber-400">Conteudo PRO</h3>
              <p className="mt-2 text-sm text-zinc-400">Esse video fica disponivel apenas para membros ativos.</p>
              <Link to="/comunidade" className="mt-4 inline-block rounded-xl bg-[#8bd450] px-6 py-2.5 text-sm font-semibold text-black hover:bg-[#9be060]">
                Voltar para a comunidade
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
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#090b10] text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-white/6 bg-[#090b10]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-widest text-[#8bd450]">GuyFolkz Academy</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isTrial ? 'bg-amber-500/10 text-amber-300' : 'bg-[#8bd450]/20 text-[#8bd450]'}`}>
              {isAdmin ? 'ADMIN' : isTrial ? 'TRIAL 6H' : 'MEMBRO'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-zinc-500 sm:block">{member.name || 'Membro'}</span>
            <button onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300">Sair</button>
          </div>
        </div>
      </header>

      <div className="border-b border-white/6 bg-[#090b10]">
        <div className="mx-auto flex max-w-5xl overflow-x-auto">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => { setTab(item.id); setView('main') }}
              className={`whitespace-nowrap border-b-2 px-5 py-3 text-sm font-medium transition-colors ${
                tab === item.id ? 'border-[#8bd450] text-[#8bd450]' : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {error && <div className="mb-5 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200">{error}</div>}

        {tab === 'dashboard' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Ola, {member.name || 'membro'}.</p>
                  <p className="mt-0.5 text-xs text-zinc-500">Seu progresso dentro da Academy</p>
                </div>
                <p className="text-2xl font-bold text-[#8bd450]">{progress}%</p>
              </div>
              <div className="mt-3 h-2 rounded-full bg-zinc-800">
                <div className="h-2 rounded-full bg-[#8bd450]" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-xs text-zinc-500">{completedSteps} de {totalSteps} etapas concluidas</p>
              {isTrial && (
                <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-sm font-medium text-amber-200">Trial de 6 horas ativo</p>
                  <p className="mt-1 text-xs text-amber-100/80">Conteudo liberado ate {formatDateTime(member.expires_at)}. Feed, membros e ranking entram depois da confirmacao manual.</p>
                </div>
              )}
              {!isTrial && member.payment_method === 'manual_whatsapp_paid' && (
                <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <p className="text-sm font-medium text-emerald-200">Acesso confirmado manualmente</p>
                  <p className="mt-1 text-xs text-emerald-100/80">Pagamento aprovado no WhatsApp. Seu acesso segue ativo normalmente.</p>
                </div>
              )}
            </div>

            <div className={`grid gap-3 ${isTrial ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
              <button onClick={() => setTab('aulas')} className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4 text-left hover:bg-purple-500/10">
                <p className="text-sm font-semibold text-purple-300">Aulas</p>
                <p className="mt-1 text-xs text-zinc-400">{ACADEMY_VIDEOS.length} videos para assistir hoje</p>
              </button>
              {showResources && (
                <button onClick={() => setTab('recursos')} className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-left hover:bg-blue-500/10">
                  <p className="text-sm font-semibold text-blue-300">Recursos</p>
                  <p className="mt-1 text-xs text-zinc-400">Downloads, templates e playbooks</p>
                </button>
              )}
              {!isTrial && (
                <button onClick={() => setTab('comunidade')} className="rounded-2xl border border-white/10 bg-white/3 p-4 text-left hover:bg-white/5">
                  <p className="text-sm font-semibold text-zinc-100">Comunidade</p>
                  <p className="mt-1 text-xs text-zinc-400">Feed, trocas e updates do Diego</p>
                </button>
              )}
              {isTrial && (
                <button onClick={() => window.location.assign('/comunidade')} className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-left hover:bg-amber-500/10">
                  <p className="text-sm font-semibold text-amber-300">Fechar no WhatsApp</p>
                  <p className="mt-1 text-xs text-zinc-400">Eu continuo a assinatura manualmente no WhatsApp.</p>
                </button>
              )}
              {!isTrial && (
                <button onClick={() => setTab('ranking')} className="rounded-2xl border border-[#8bd450]/20 bg-[#8bd450]/5 p-4 text-left hover:bg-[#8bd450]/10">
                  <p className="text-sm font-semibold text-[#8bd450]">Ranking</p>
                  <p className="mt-1 text-xs text-zinc-400">Acompanhe quem esta executando mais</p>
                </button>
              )}
            </div>

            <div>
              <h2 className="text-base font-bold">Modulos</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {modules.map((module) => {
                  const locked = module.tier === 'pro' && !hasContentAccess
                  return (
                    <button
                      key={module.id || module.slug}
                      onClick={() => { if (!locked) loadModule(module.slug) }}
                      disabled={locked}
                      className={`rounded-2xl border p-4 text-left ${locked ? 'cursor-not-allowed border-white/4 bg-white/2 opacity-60' : 'border-white/8 bg-white/3 hover:bg-white/5'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{module.icon || 'MOD'}</span>
                        {module.tier === 'pro' && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${locked ? 'bg-zinc-700 text-zinc-500' : 'bg-[#8bd450]/10 text-[#8bd450]'}`}>PRO</span>}
                      </div>
                      <h3 className="mt-2 text-sm font-semibold leading-snug">{module.title}</h3>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{module.description}</p>
                      {module.step_count > 0 && <p className="mt-2 text-[10px] text-zinc-500">{module.step_count} etapas · {module.duration_min} min</p>}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {tab === 'aulas' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold">Sala de aulas</h2>
              <p className="mt-1 text-sm text-zinc-400">Casos reais de IA e automacao</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {ACADEMY_VIDEOS.map((video) => {
                const locked = video.tier === 'pro' && !hasContentAccess
                return (
                  <button key={video.id} onClick={() => { setActiveVideo(video); setView('video') }} className={`overflow-hidden rounded-2xl border text-left ${locked ? 'border-white/6 opacity-80' : 'border-white/10 hover:border-white/20'}`}>
                    <div className="relative aspect-video bg-zinc-900">
                      <img src={`https://img.youtube.com/vi/${video.id}/hqdefault.jpg`} alt={video.title} className="h-full w-full object-cover" />
                      {locked && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs font-semibold text-amber-200">PRO</div>}
                    </div>
                    <div className="p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded-full bg-[#8bd450]/20 px-2 py-0.5 text-[10px] text-[#8bd450]">{video.tag}</span>
                        {locked && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400">PRO</span>}
                        <span className="ml-auto text-[10px] text-zinc-500">{video.duration}</span>
                      </div>
                      <h3 className="text-sm font-semibold leading-snug">{video.title}</h3>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{video.desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'comunidade' && showSocial && <LiveFeedTab />}

        {tab === 'membros' && showMembers && (
          <MembersDirectoryTab
            members={membersList}
            membersLoading={membersLoading}
            membersError={membersError}
            onRetry={loadMembers}
          />
        )}

        {tab === 'recursos' && showResources && (
          <ResourcesTab
            isPro={hasContentAccess}
            resources={resources}
            resourcesLoading={resourcesLoading}
            resourcesError={resourcesError}
            onDownload={handleDownloadResource}
            onRetry={loadResources}
          />
        )}

        {tab === 'ranking' && showRanking && (
          <div className="max-w-2xl space-y-4">
            <div>
              <h2 className="text-lg font-bold">Ranking de membros</h2>
              <p className="mt-1 text-sm text-zinc-400">Quem esta avancando mais dentro da Academy</p>
            </div>
            {leaderboard.length === 0 ? (
              <div className="rounded-2xl border border-white/8 bg-white/3 p-8 text-center text-sm text-zinc-400">Seja o primeiro a completar etapas.</div>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((leader, index) => (
                  <div key={`${leader.name}-${leader.rank}-${index}`} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3">
                    <span className="w-7 text-center text-sm font-bold text-zinc-400">#{leader.rank}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{leader.name}</p>
                      <p className="text-[10px] text-zinc-500">{leader.phone_masked}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-[#8bd450]">{leader.completed_steps}</p>
                      <p className="text-[10px] text-zinc-500">etapas</p>
                    </div>
                    {leader.tier === 'pro' && <span className="rounded-full bg-[#8bd450]/10 px-2 py-0.5 text-[10px] text-[#8bd450]">PRO</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function LiveFeedTab() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [newPost, setNewPost] = useState('')
  const [postType, setPostType] = useState('discussion')
  const [posting, setPosting] = useState(false)
  const communityToken = getCommunityToken()

  async function communityFetch(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    if (communityToken) headers.Authorization = `Bearer ${communityToken}`
    const res = await fetch(`${API}${path}`, { ...opts, headers })
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
  }

  async function loadFeed() {
    try {
      const data = await communityFetch('/api/community/feed?limit=30')
      setPosts(data.posts || [])
    } catch {
      setPosts([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFeed()
  }, [])

  async function handleCreatePost(e) {
    e.preventDefault()
    if (!communityToken || !newPost.trim()) return
    setPosting(true)
    try {
      await communityFetch('/api/community/post', {
        method: 'POST',
        body: JSON.stringify({ content_md: newPost.trim(), post_type: postType }),
      })
      setNewPost('')
      loadFeed()
    } catch {
      // Backend already blocks content-only trial users.
    } finally {
      setPosting(false)
    }
  }

  async function handleLike(postId) {
    if (!communityToken) return
    try {
      await communityFetch(`/api/community/post/${postId}/like`, { method: 'POST' })
      setPosts((prev) => prev.map((post) => (
        post.id === postId
          ? { ...post, liked_by_me: !post.liked_by_me, likes_count: post.likes_count + (post.liked_by_me ? -1 : 1) }
          : post
      )))
    } catch {
      // Ignore optimistic failures.
    }
  }

  if (loading) return <div className="py-8 text-center text-zinc-500">Carregando feed...</div>

  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-lg font-bold">Feed da comunidade</h2>
      {communityToken ? (
        <form onSubmit={handleCreatePost} className="space-y-3 rounded-2xl border border-white/8 bg-white/3 p-4">
          <textarea
            value={newPost}
            onChange={(e) => setNewPost(e.target.value)}
            placeholder="Compartilhe algo com a comunidade..."
            rows={3}
            className="w-full resize-none rounded-xl border border-white/10 bg-transparent p-3 text-sm text-zinc-200 placeholder-zinc-600 focus:border-[#8bd450]/40 focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <select value={postType} onChange={(e) => setPostType(e.target.value)} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs">
              <option value="discussion">Discussao</option>
              <option value="resource">Recurso</option>
              <option value="announcement">Anuncio</option>
              <option value="question">Pergunta</option>
            </select>
            <button type="submit" disabled={posting || !newPost.trim()} className="rounded-xl bg-[#8bd450] px-4 py-1.5 text-xs font-semibold text-black hover:bg-[#7cc340] disabled:opacity-40">
              {posting ? 'Publicando...' : 'Publicar'}
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-2xl border border-white/8 bg-white/3 p-4 text-center text-xs text-zinc-500">Faca login para publicar na comunidade.</div>
      )}
      {posts.length === 0 ? (
        <div className="rounded-2xl border border-white/8 bg-white/3 p-8 text-center text-sm text-zinc-400">Nenhum post ainda.</div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div key={post.id} className={`rounded-2xl border p-4 ${post.pinned ? 'border-[#8bd450]/30 bg-[#8bd450]/5' : 'border-white/8 bg-white/3'}`}>
              {post.pinned && <p className="mb-2 text-[10px] font-medium text-[#8bd450]">FIXADO</p>}
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{post.author_name || 'Membro'}</p>
                  <p className="text-[10px] text-zinc-500">{post.post_type || 'discussion'}</p>
                </div>
                <p className="text-[10px] text-zinc-500">{formatDate(post.created_at)}</p>
              </div>
              <p className="whitespace-pre-wrap text-sm text-zinc-300">{post.content_md}</p>
              <div className="mt-3 flex items-center gap-4 border-t border-white/5 pt-2">
                <button onClick={() => handleLike(post.id)} className={`text-xs ${post.liked_by_me ? 'text-red-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
                  Curtir {post.likes_count || 0}
                </button>
                <span className="text-xs text-zinc-500">Comentarios {post.comments_count || 0}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MembersDirectoryTab({ members, membersLoading, membersError, onRetry }) {
  if (membersLoading) return <div className="py-8 text-center text-zinc-500">Carregando membros...</div>
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-bold">Membros da comunidade</h2>
        <p className="mt-1 text-sm text-zinc-400">Quem ja esta construindo junto dentro da Academy.</p>
      </div>
      {membersError && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
          <p>{membersError}</p>
          <button onClick={onRetry} className="mt-3 text-xs font-medium text-red-200 underline underline-offset-4">Tentar de novo</button>
        </div>
      )}
      {members.length === 0 ? (
        <div className="rounded-2xl border border-white/8 bg-white/3 p-8 text-center text-sm text-zinc-400">Nenhum membro ativo apareceu ainda.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {members.map((item) => (
            <div key={item.enrollment_id} className="rounded-2xl border border-white/8 bg-white/3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">{item.name}</h3>
                  <p className="mt-1 text-xs text-zinc-500">Entrou {item.enrolled_at ? formatDate(item.enrolled_at) : 'recentemente'}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${item.role === 'admin' ? 'bg-red-500/10 text-red-300' : 'bg-[#8bd450]/10 text-[#8bd450]'}`}>
                  {item.role === 'admin' ? 'Admin' : 'PRO'}
                </span>
              </div>
              <div className="mt-4 rounded-xl border border-white/6 bg-black/20 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Posts</p>
                <p className="mt-1 text-sm font-semibold text-zinc-100">{item.post_count || 0}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ResourcesTab({ isPro, resources, resourcesLoading, resourcesError, onDownload, onRetry }) {
  if (resourcesLoading) return <div className="py-8 text-center text-zinc-500">Carregando recursos...</div>
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-bold">Central de recursos</h2>
        <p className="mt-1 text-sm text-zinc-400">Downloads, templates e playbooks para acelerar tua implementacao.</p>
      </div>
      {resourcesError && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
          <p>{resourcesError}</p>
          <button onClick={onRetry} className="mt-3 text-xs font-medium text-red-200 underline underline-offset-4">Tentar de novo</button>
        </div>
      )}
      {resources.length === 0 ? (
        <div className="rounded-2xl border border-white/8 bg-white/3 p-8 text-center text-sm text-zinc-400">Nenhum recurso publicado ainda.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {resources.map((resource) => {
            const locked = resource.tier === 'pro' && !isPro
            return (
              <div key={resource.id} className="rounded-2xl border border-white/8 bg-white/3 p-5">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-zinc-400">{resource.resource_type || 'Recurso'}</span>
                  {resource.tier === 'pro' && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${locked ? 'bg-zinc-700 text-zinc-500' : 'bg-[#8bd450]/10 text-[#8bd450]'}`}>PRO</span>}
                </div>
                <h3 className="mt-3 text-sm font-semibold text-zinc-100">{resource.title}</h3>
                <p className="mt-2 text-xs leading-6 text-zinc-400">{resource.description || 'Sem descricao ainda.'}</p>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-[11px] text-zinc-500">{resource.downloads_count || 0} downloads</p>
                  <button onClick={() => onDownload(resource.id)} disabled={locked} className={`rounded-xl px-4 py-2 text-xs font-semibold ${locked ? 'cursor-not-allowed bg-zinc-800 text-zinc-500' : 'bg-[#8bd450] text-black hover:bg-[#9be060]'}`}>
                    {locked ? 'Upgrade PRO' : 'Abrir recurso'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
