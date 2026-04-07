import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getSessionByToken, saveStepResult, submitTestSession } from '../api'

const STATUS_LABELS = {
  pass: { label: '✅ Funcionou como esperado', color: 'bg-green-500/20 border-green-500 text-green-400' },
  fail: { label: '❌ Encontrei um problema', color: 'bg-red-500/20 border-red-500 text-red-400' },
  skip: { label: '⏭️ Pular (não consigo testar)', color: 'bg-yellow-500/20 border-yellow-500 text-yellow-400' },
}

export default function TesterPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [results, setResults] = useState({})
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('Token não encontrado na URL.')
      setLoading(false)
      return
    }
    getSessionByToken(token)
      .then(data => {
        setSession(data)
        const saved = {}
        for (const r of data.results || []) {
          saved[r.step_id] = { status: r.status, comentario: r.comentario || '' }
        }
        setResults(saved)
        const steps = data.plan?.steps || []
        const firstUnanswered = steps.findIndex(s => !saved[s.id])
        setCurrentStepIndex(firstUnanswered >= 0 ? firstUnanswered : steps.length - 1)
      })
      .catch(() => setError('Sessão não encontrada ou link inválido.'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#090b10' }}>
        <div className="text-gray-400">Carregando teste...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#090b10' }}>
        <div className="text-center">
          <div className="text-red-400 text-lg mb-2">Erro</div>
          <div className="text-gray-400">{error}</div>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#090b10' }}>
        <div className="text-center max-w-md px-6">
          <div className="text-4xl mb-4">🎉</div>
          <h2 className="text-xl font-semibold text-white mb-2">Relatório enviado!</h2>
          <p className="text-gray-400">
            Obrigada, {session?.tester_nome || 'Testadora'}! Diego foi notificado com o resumo dos testes.
          </p>
        </div>
      </div>
    )
  }

  const steps = session?.plan?.steps || []
  const totalSteps = steps.length
  const currentStep = steps[currentStepIndex]
  const answeredCount = Object.keys(results).length
  const progress = totalSteps > 0 ? Math.round((answeredCount / totalSteps) * 100) : 0
  const isLastStep = currentStepIndex === totalSteps - 1
  const currentResult = results[currentStep?.id] || {}
  const hasAnswer = !!currentResult.status

  async function handleSelectStatus(status) {
    const updated = { ...results, [currentStep.id]: { ...currentResult, status } }
    setResults(updated)
    setSaving(true)
    try {
      await saveStepResult(session.id, {
        step_id: currentStep.id,
        status,
        comentario: currentResult.comentario || null,
      })
    } catch (e) {
      console.error('Erro ao salvar resultado:', e)
    } finally {
      setSaving(false)
    }
  }

  function handleComentarioChange(text) {
    setResults(prev => ({ ...prev, [currentStep.id]: { ...prev[currentStep.id], comentario: text } }))
  }

  async function handleComentarioBlur() {
    if (!currentResult.status) return
    setSaving(true)
    try {
      await saveStepResult(session.id, {
        step_id: currentStep.id,
        status: currentResult.status,
        comentario: results[currentStep.id]?.comentario || null,
      })
    } catch (e) {
      console.error('Erro ao salvar comentário:', e)
    } finally {
      setSaving(false)
    }
  }

  async function handleNext() {
    if (!hasAnswer) return
    if (isLastStep) {
      setSaving(true)
      try {
        await submitTestSession(session.id)
        setSubmitted(true)
      } catch (e) {
        console.error('Erro ao submeter sessão:', e)
      } finally {
        setSaving(false)
      }
    } else {
      setCurrentStepIndex(i => i + 1)
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#090b10', color: '#e2e8f0' }}>
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-1">
            <div>
              <span className="text-xs uppercase tracking-wider text-gray-500">{session?.plan?.projeto}</span>
              <h1 className="text-lg font-semibold text-white">{session?.plan?.nome}</h1>
            </div>
            <span className="text-sm text-gray-400">Passo {currentStepIndex + 1} de {totalSteps}</span>
          </div>
          <div className="h-1.5 rounded-full mt-3" style={{ background: '#1a1f2e' }}>
            <div
              className="h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, background: '#8bd450' }}
            />
          </div>
        </div>

        {/* Step card */}
        <div className="rounded-xl border border-white/10 p-6 mb-6" style={{ background: '#0d1117' }}>
          <h2 className="text-base font-semibold text-white mb-3">{currentStep?.titulo}</h2>
          <p className="text-gray-300 text-sm leading-relaxed mb-4">{currentStep?.instrucao}</p>

          {currentStep?.url_sugerida && (
            <a
              href={currentStep.url_sugerida}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors mb-4"
            >
              🔗 {currentStep.url_sugerida}
            </a>
          )}

          {currentStep?.resultado_esperado && (
            <div className="rounded-lg px-3 py-2.5 text-xs text-gray-400 border border-white/5" style={{ background: '#161b22' }}>
              <span className="text-gray-500 mr-1">O que deve acontecer:</span>
              {currentStep.resultado_esperado}
            </div>
          )}
        </div>

        {/* Status buttons */}
        <div className="flex flex-col gap-3 mb-4">
          {Object.entries(STATUS_LABELS).map(([status, { label, color }]) => (
            <button
              key={status}
              onClick={() => handleSelectStatus(status)}
              className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                currentResult.status === status
                  ? color
                  : 'border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300'
              }`}
              style={currentResult.status !== status ? { background: '#0d1117' } : {}}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Comment textarea for failures */}
        {currentResult.status === 'fail' && (
          <div className="mb-4">
            <textarea
              placeholder="Descreva o problema encontrado..."
              value={results[currentStep.id]?.comentario || ''}
              onChange={e => handleComentarioChange(e.target.value)}
              onBlur={handleComentarioBlur}
              rows={3}
              className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm text-gray-300 resize-none focus:outline-none focus:border-white/20"
              style={{ background: '#0d1117' }}
            />
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCurrentStepIndex(i => Math.max(0, i - 1))}
            disabled={currentStepIndex === 0}
            className="text-sm text-gray-500 hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Voltar
          </button>

          <button
            onClick={handleNext}
            disabled={!hasAnswer || saving}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: hasAnswer && !saving ? '#8bd450' : '#1a1f2e',
              color: hasAnswer && !saving ? '#090b10' : '#4b5563',
            }}
          >
            {saving ? 'Salvando...' : isLastStep ? 'Enviar Relatório' : 'Próximo →'}
          </button>
        </div>

        {/* Step indicator dots */}
        <div className="mt-8 flex flex-wrap gap-1.5">
          {steps.map((step, i) => {
            const r = results[step.id]
            const isCurrent = i === currentStepIndex
            const bg = r?.status === 'pass' ? '#22c55e' : r?.status === 'fail' ? '#ef4444' : r?.status === 'skip' ? '#eab308' : '#1a1f2e'
            return (
              <button
                key={step.id}
                onClick={() => setCurrentStepIndex(i)}
                title={step.titulo}
                className="w-7 h-7 rounded-md text-xs font-medium transition-all"
                style={{
                  background: isCurrent ? '#8bd450' : bg,
                  color: isCurrent ? '#090b10' : r ? '#090b10' : '#4b5563',
                  outline: isCurrent ? '2px solid #8bd450' : 'none',
                  outlineOffset: '2px',
                }}
              >
                {i + 1}
              </button>
            )
          })}
        </div>

      </div>
    </div>
  )
}
