import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || ''

function markdownToHtml(md) {
  if (!md) return ''
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="text-emerald-400 underline">$1</a>')
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-emerald-500/50 pl-4 py-2 my-3 bg-emerald-500/5 rounded-r">$1</blockquote>')
    .replace(/^\| (.+) \|$/gm, (match) => {
      const cells = match.split('|').filter(c => c.trim())
      if (cells.some(c => /^-+$/.test(c.trim()))) return ''
      const tag = cells.length > 0 ? 'td' : 'td'
      return '<tr>' + cells.map(c => `<${tag} class="border border-zinc-700 px-3 py-2">${c.trim()}</${tag}>`).join('') + '</tr>'
    })
    .replace(/(<tr>[\s\S]*?<\/tr>[\s]*)+/g, '<table class="w-full border-collapse my-4 text-sm">$&</table>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 my-1">$1</li>')
    .replace(/(<li[\s\S]*?<\/li>[\s]*)+/g, '<ul class="list-disc pl-4 my-2">$&</ul>')
    .replace(/^---$/gm, '<hr class="border-zinc-700 my-6">')
    .replace(/\n\n/g, '</p><p class="my-2">')
}


// ── Landing Page ─────────────────────────────────────

function Landing({ modules, onStart, onSelectModule }) {
  const freeModules = modules.filter(m => m.tier === 'free')
  const proModules = modules.filter(m => m.tier === 'pro')

  return (
    <div className="min-h-screen bg-[#090b10]">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/20 via-transparent to-blue-900/20" />
        <div className="max-w-4xl mx-auto px-6 pt-16 pb-12 relative">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm mb-6">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Plataforma Educacional
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
              Playbook <span className="text-emerald-400">CTO Virtual</span>
            </h1>
            <p className="text-lg text-zinc-400 max-w-2xl mx-auto mb-8">
              Transforme o Claude Code no seu CTO virtual pessoal.
              Passo a passo, do zero ao sistema completo.
            </p>
            <div className="flex gap-4 justify-center">
              <button onClick={onStart} className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-xl transition-all hover:scale-105">
                Começar Grátis
              </button>
              <a href="#modulos" className="px-6 py-3 border border-zinc-700 hover:border-zinc-500 text-zinc-300 rounded-xl transition-all">
                Ver Módulos
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { n: modules.reduce((a, m) => a + m.step_count, 0), l: 'Aulas' },
            { n: modules.reduce((a, m) => a + m.duration_min, 0), l: 'Minutos' },
            { n: freeModules.length, l: 'Módulos Free' },
            { n: proModules.length, l: 'Módulos Pro' },
          ].map((s, i) => (
            <div key={i} className="text-center p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
              <div className="text-2xl font-bold text-white">{s.n}</div>
              <div className="text-sm text-zinc-500">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Modules */}
      <div id="modulos" className="max-w-4xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold text-white mb-2">Módulos</h2>
        <p className="text-zinc-500 mb-8">Aprenda no seu ritmo. Cada módulo é independente.</p>

        {/* Free */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-xs font-medium">FREE</span>
            <span className="text-zinc-500 text-sm">Acesso imediato</span>
          </div>
          <div className="grid gap-4">
            {freeModules.map(m => (
              <ModuleCard key={m.slug} module={m} onSelect={() => onSelectModule(m.slug)} />
            ))}
          </div>
        </div>

        {/* Pro */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs font-medium">PRO</span>
            <span className="text-zinc-500 text-sm">R$50/mês — Todos os módulos + comunidade</span>
          </div>
          <div className="grid gap-4">
            {proModules.map(m => (
              <ModuleCard key={m.slug} module={m} onSelect={() => onSelectModule(m.slug)} locked />
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="rounded-2xl bg-gradient-to-r from-emerald-900/30 to-blue-900/30 border border-emerald-500/20 p-8 text-center">
          <h3 className="text-2xl font-bold text-white mb-2">Pronto para começar?</h3>
          <p className="text-zinc-400 mb-6">Cadastre-se em 10 segundos. Sem cartão.</p>
          <button onClick={onStart} className="px-8 py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-xl transition-all hover:scale-105">
            Criar Conta Grátis
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-800 py-8 text-center text-zinc-600 text-sm">
        <p>Playbook CTO Virtual — Por Diego | <span className="text-emerald-500">GuyFolkz</span></p>
        <p className="mt-1">Automação & IA para Negócios</p>
      </footer>
    </div>
  )
}


function ModuleCard({ module, onSelect, locked }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-5 rounded-xl border transition-all hover:scale-[1.01] ${
        locked
          ? 'bg-zinc-900/30 border-zinc-800 hover:border-zinc-700'
          : 'bg-zinc-900/50 border-zinc-800 hover:border-emerald-500/30 hover:bg-emerald-500/5'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="text-3xl">{module.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-white font-semibold">{module.title}</h3>
            {locked && <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">PRO</span>}
          </div>
          <p className="text-zinc-500 text-sm mt-1">{module.description}</p>
          <div className="flex gap-4 mt-3 text-xs text-zinc-600">
            <span>{module.step_count} aulas</span>
            <span>{module.duration_min} min</span>
          </div>
        </div>
        <div className="text-zinc-600 text-xl">{locked ? '🔒' : '→'}</div>
      </div>
    </button>
  )
}


// ── Enrollment Modal ─────────────────────────────────

function EnrollModal({ onClose, onEnroll }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name || !phone) return
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/playbook/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name, email: email || null })
      })
      const data = await res.json()
      localStorage.setItem('playbook_phone', phone)
      localStorage.setItem('playbook_name', name)
      onEnroll(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-md w-full">
        <h2 className="text-xl font-bold text-white mb-2">Criar conta grátis</h2>
        <p className="text-zinc-500 text-sm mb-6">Acesse os módulos FREE e acompanhe seu progresso.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-zinc-400">Nome *</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              className="w-full mt-1 px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
              placeholder="Seu nome"
              required
            />
          </div>
          <div>
            <label className="text-sm text-zinc-400">WhatsApp *</label>
            <input
              value={phone} onChange={e => setPhone(e.target.value)}
              className="w-full mt-1 px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
              placeholder="5511999999999"
              required
            />
          </div>
          <div>
            <label className="text-sm text-zinc-400">Email (opcional)</label>
            <input
              value={email} onChange={e => setEmail(e.target.value)}
              className="w-full mt-1 px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
              placeholder="seu@email.com"
              type="email"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-zinc-700 text-zinc-400 rounded-lg hover:bg-zinc-800">
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 disabled:opacity-50">
              {loading ? 'Criando...' : 'Começar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


// ── Step View (Aula) ─────────────────────────────────

function StepView({ module, step, stepIndex, totalSteps, onNext, onPrev, onComplete, onBack, phone }) {
  const isCompleted = step.is_completed

  const handleComplete = async () => {
    if (!phone || isCompleted) return
    try {
      await fetch(`${API}/api/playbook/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, step_id: step.id })
      })
      onComplete(step.id)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="min-h-screen bg-[#090b10]">
      {/* Top bar */}
      <div className="sticky top-0 z-40 bg-[#090b10]/90 backdrop-blur border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <button onClick={onBack} className="text-zinc-500 hover:text-white text-sm flex items-center gap-1">
            ← {module.title}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-zinc-600 text-sm">{stepIndex + 1}/{totalSteps}</span>
            <div className="flex gap-1">
              {Array.from({ length: totalSteps }, (_, i) => (
                <div key={i} className={`w-6 h-1.5 rounded-full transition-all ${
                  i === stepIndex ? 'bg-emerald-400' : i < stepIndex ? 'bg-emerald-400/30' : 'bg-zinc-800'
                }`} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Step type badge */}
        <div className="flex items-center gap-3 mb-4">
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            step.step_type === 'theory' ? 'bg-blue-500/20 text-blue-400' :
            step.step_type === 'practice' ? 'bg-emerald-500/20 text-emerald-400' :
            step.step_type === 'code' ? 'bg-purple-500/20 text-purple-400' :
            'bg-amber-500/20 text-amber-400'
          }`}>
            {step.step_type === 'theory' ? '📖 Teoria' :
             step.step_type === 'practice' ? '🛠️ Prática' :
             step.step_type === 'code' ? '💻 Código' : '❓ Quiz'}
          </span>
          {step.duration_min && <span className="text-zinc-600 text-xs">{step.duration_min} min</span>}
        </div>

        {/* Markdown content */}
        <div
          className="prose-playbook text-zinc-300 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(step.content) }}
        />

        {/* Code snippet (if practice step) */}
        {step.code_snippet && (
          <div className="mt-8 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6">
            <h4 className="text-emerald-400 font-semibold mb-2">Prompt para colar no Claude Code:</h4>
            <div className="bg-zinc-900 rounded-lg p-4 text-sm text-zinc-300 font-mono whitespace-pre-wrap">
              {step.code_snippet}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(step.code_snippet)}
              className="mt-3 text-sm text-emerald-400 hover:text-emerald-300"
            >
              Copiar prompt
            </button>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-12 pt-6 border-t border-zinc-800">
          <button
            onClick={onPrev}
            disabled={stepIndex === 0}
            className="px-4 py-2 text-sm text-zinc-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Anterior
          </button>

          <div className="flex gap-3">
            {!isCompleted && phone && (
              <button
                onClick={handleComplete}
                className="px-5 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 text-sm"
              >
                Marcar como concluída
              </button>
            )}
            {isCompleted && (
              <span className="px-5 py-2 text-emerald-400 text-sm flex items-center gap-1">
                Concluída
              </span>
            )}
          </div>

          <button
            onClick={onNext}
            disabled={stepIndex === totalSteps - 1}
            className="px-4 py-2 text-sm bg-emerald-500 text-black rounded-lg font-medium hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Próxima →
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Module View (lista de aulas) ─────────────────────

function ModuleView({ module, onSelectStep, onBack, phone }) {
  const completedCount = module.steps.filter(s => s.is_completed).length

  return (
    <div className="min-h-screen bg-[#090b10]">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <button onClick={onBack} className="text-zinc-500 hover:text-white text-sm mb-6 flex items-center gap-1">
          ← Voltar aos módulos
        </button>

        <div className="flex items-start gap-4 mb-8">
          <div className="text-4xl">{module.icon}</div>
          <div>
            <h1 className="text-2xl font-bold text-white">{module.title}</h1>
            <p className="text-zinc-500 mt-1">{module.description}</p>
            {phone && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden max-w-xs">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${module.steps.length ? (completedCount / module.steps.length) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-600">{completedCount}/{module.steps.length}</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {module.steps.map((step, i) => (
            <button
              key={step.id}
              onClick={() => onSelectStep(i)}
              className="w-full text-left flex items-center gap-4 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all"
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step.is_completed
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-zinc-800 text-zinc-500'
              }`}>
                {step.is_completed ? '✓' : i + 1}
              </div>
              <div className="flex-1">
                <div className="text-white text-sm font-medium">{step.title}</div>
                <div className="flex gap-3 mt-1 text-xs text-zinc-600">
                  <span>{step.step_type === 'theory' ? '📖 Teoria' : step.step_type === 'practice' ? '🛠️ Prática' : step.step_type === 'code' ? '💻 Código' : '❓ Quiz'}</span>
                  {step.duration_min && <span>{step.duration_min} min</span>}
                </div>
              </div>
              <span className="text-zinc-700">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}


// ── Main Component ───────────────────────────────────

export default function PlaybookPlatform() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [modules, setModules] = useState([])
  const [currentModule, setCurrentModule] = useState(null)
  const [currentStepIndex, setCurrentStepIndex] = useState(-1)
  const [showEnroll, setShowEnroll] = useState(false)
  const [phone, setPhone] = useState(() => localStorage.getItem('playbook_phone') || '')
  const [loading, setLoading] = useState(true)

  const activeSlug = searchParams.get('m')
  const activeStep = parseInt(searchParams.get('s') || '-1')

  // Load modules
  useEffect(() => {
    fetch(`${API}/api/playbook/modules`)
      .then(r => r.json())
      .then(setModules)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Load module detail when slug changes
  useEffect(() => {
    if (!activeSlug) { setCurrentModule(null); return }
    fetch(`${API}/api/playbook/modules/${activeSlug}${phone ? `?phone=${phone}` : ''}`)
      .then(r => r.json())
      .then(data => {
        setCurrentModule(data)
        if (activeStep >= 0) setCurrentStepIndex(activeStep)
      })
      .catch(() => {})
  }, [activeSlug, phone])

  const navigateToModule = useCallback((slug) => {
    setSearchParams({ m: slug })
    setCurrentStepIndex(-1)
  }, [setSearchParams])

  const navigateToStep = useCallback((index) => {
    setCurrentStepIndex(index)
    setSearchParams({ m: activeSlug, s: String(index) })
  }, [activeSlug, setSearchParams])

  const navigateHome = useCallback(() => {
    setSearchParams({})
    setCurrentModule(null)
    setCurrentStepIndex(-1)
  }, [setSearchParams])

  const handleComplete = (stepId) => {
    if (!currentModule) return
    setCurrentModule(prev => ({
      ...prev,
      steps: prev.steps.map(s => s.id === stepId ? { ...s, is_completed: true } : s)
    }))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090b10] flex items-center justify-center">
        <div className="text-zinc-500">Carregando...</div>
      </div>
    )
  }

  // Step view
  if (currentModule && currentStepIndex >= 0 && currentModule.steps[currentStepIndex]) {
    return (
      <StepView
        module={currentModule}
        step={currentModule.steps[currentStepIndex]}
        stepIndex={currentStepIndex}
        totalSteps={currentModule.steps.length}
        onNext={() => navigateToStep(currentStepIndex + 1)}
        onPrev={() => navigateToStep(currentStepIndex - 1)}
        onComplete={handleComplete}
        onBack={() => { setCurrentStepIndex(-1); setSearchParams({ m: activeSlug }) }}
        phone={phone}
      />
    )
  }

  // Module view
  if (currentModule) {
    return (
      <ModuleView
        module={currentModule}
        onSelectStep={navigateToStep}
        onBack={navigateHome}
        phone={phone}
      />
    )
  }

  // Landing
  return (
    <>
      <Landing
        modules={modules}
        onStart={() => phone ? null : setShowEnroll(true)}
        onSelectModule={navigateToModule}
      />
      {showEnroll && (
        <EnrollModal
          onClose={() => setShowEnroll(false)}
          onEnroll={(data) => {
            setPhone(data.id ? localStorage.getItem('playbook_phone') : '')
            setShowEnroll(false)
          }}
        />
      )}
    </>
  )
}
