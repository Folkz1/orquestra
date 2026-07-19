import { useCallback, useEffect, useState } from 'react'
import { getTasks, updateTask } from '../api'

// Fila de perguntas do Claude ao Diego. Reusa a tabela project_tasks:
// uma task com metadata_json.kind === 'cockpit_question' é uma pergunta.
// O Claude cria via POST /api/tasks; o Diego responde aqui (PATCH /api/tasks/{id}).
const KIND = 'cockpit_question'
const KIND_FW = 'flywheel'          // estado de um loop rodando (1 card por projeto)
const POLL_MS = 10000

// Métricas do scorecard do Flywheel (M1-M7). Ordem e rótulo curtos para o card.
const METRICAS = [
  ['M1', 'precisão'], ['M2', 'reincidência'], ['M3', 'detecção'],
  ['M4', 'aceite'], ['M5', 'ruído'], ['M6', 'fila'], ['M7', 'custo'],
]

const UI_META = {
  decision: { label: 'Decisão', badge: 'bg-sky-500/15 text-sky-200 border-sky-500/30' },
  credential: { label: 'Credencial', badge: 'bg-violet-500/15 text-violet-200 border-violet-500/30' },
  input: { label: 'Input', badge: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30' },
}
const DEFAULT_OPTIONS = ['Funcionando', 'Concluído', 'Continuar', 'Bloqueado']

function meta(task) {
  return task.metadata_json || {}
}
function isPending(task) {
  return meta(task).kind === KIND && !meta(task).answer && task.status !== 'done' && task.status !== 'cancelled'
}
function formatDate(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return value
  }
}

function StatCard({ label, value, alert }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${alert ? 'border-amber-500/40 bg-amber-500/[0.06]' : 'border-white/6 bg-white/[0.03]'}`}>
      <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  )
}

function QuestionCard({ task, onAnswer }) {
  const m = meta(task)
  const ui = UI_META[m.ui] ? m.ui : 'decision'
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function send(value) {
    const answer = String(value ?? text).trim()
    if (!answer) return
    setSending(true)
    try {
      await onAnswer(task, answer)
    } finally {
      setSending(false)
      setText('')
    }
  }

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-white">{task.title}</h3>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${UI_META[ui].badge}`}>
          {UI_META[ui].label}
        </span>
      </div>
      {(m.project_path || task.source) && (
        <p className="mt-1 text-xs text-zinc-500">{m.project_path || task.source} · {formatDate(task.created_at)}</p>
      )}
      {(m.context || task.description) && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{m.context || task.description}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {ui === 'decision' && (m.options || DEFAULT_OPTIONS).map((opt) => (
          <button
            key={opt}
            disabled={sending}
            onClick={() => send(opt)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 hover:bg-white/[0.08] disabled:opacity-50"
          >
            {opt}
          </button>
        ))}
        <input
          type={ui === 'credential' ? 'password' : 'text'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          placeholder={ui === 'credential' ? 'cole a chave/token/senha…' : ui === 'input' ? 'digite o valor…' : 'ou escreva a resposta…'}
          className="min-w-[220px] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-sky-500/40 focus:outline-none"
        />
        <button
          disabled={sending}
          onClick={() => send()}
          className="rounded-lg bg-gradient-to-br from-sky-400 to-violet-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:opacity-90 disabled:opacity-50"
        >
          {sending ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </div>
  )
}

function projName(p) {
  return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

// F1 — vivacidade: cada estado tem cor própria (mata o "verde mentiroso").
const VIV = {
  rodando:   { card: 'border-emerald-500/30 bg-emerald-500/[0.04]', badge: 'bg-emerald-500/15 text-emerald-200', dot: '●' },
  ocioso:    { card: 'border-amber-500/25 bg-amber-500/[0.03]',     badge: 'bg-amber-500/15 text-amber-200',   dot: '◐' },
  parado:    { card: 'border-zinc-600/30 bg-white/[0.02]',          badge: 'bg-zinc-700/40 text-zinc-400',      dot: '○' },
  estagnado: { card: 'border-rose-500/40 bg-rose-500/[0.05]',       badge: 'bg-rose-500/15 text-rose-200',      dot: '⚠' },
}

function tempoAtras(iso) {
  if (!iso) return null
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6
  if (h < 1) return `há ${Math.round(h * 60)}min`
  if (h < 24) return `há ${h.toFixed(1)}h`
  return `há ${(h / 24).toFixed(1)} dias`
}

// Card de um Flywheel: o que o loop fez + o scorecard que ele mede e melhora.
function FlywheelCard({ fw }) {
  const m = fw.metadata_json || {}
  const estado = (m.status || 'parado').toLowerCase()
  const v = VIV[estado] || VIV.parado
  const sc = m.scorecard || {}
  const prog = m.progresso || {}
  const ultimo = m.ultimo_ciclo || {}
  return (
    <div className={`rounded-2xl border p-5 ${v.card}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-white">
          🔄 {projName(m.project_path) || fw.title}
          {m.sessao_ativa && <span className="ml-2 align-middle text-[10px] font-medium text-emerald-300">● sessão ativa agora</span>}
        </h3>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${v.badge}`} title={m.vivacidade_motivo || ''}>
          {v.dot} {estado}{estado === 'rodando' && m.janela ? ' · ' + m.janela : ''}
        </span>
      </div>
      {m.ultima_atividade && (
        <p className="mt-1 text-[11px] text-zinc-500">
          última atividade real {tempoAtras(m.ultima_atividade)}{m.vivacidade_motivo ? ` · ${m.vivacidade_motivo}` : ''}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
        {m.ciclos != null && <span>ciclos: <b className="text-zinc-200">{m.ciclos}</b></span>}
        {prog.total != null && <span>tarefas: <b className="text-zinc-200">{prog.feitas || 0}/{prog.total}</b></span>}
        {m.propostas && <span>propostas: <b className="text-amber-200">{m.propostas.pendentes || 0}</b> pendentes · {m.propostas.aplicadas || 0} aplicadas</span>}
      </div>
      {ultimo.resumo && (
        <p className="mt-3 rounded-lg border-l-2 border-sky-500/40 bg-black/20 px-3 py-2 text-sm text-zinc-300">
          <span className="text-zinc-500">último ciclo{ultimo.n ? ' #' + ultimo.n : ''}:</span> {ultimo.resumo}
          {ultimo.ts && <span className="ml-1 text-[11px] text-zinc-600">· {formatDate(ultimo.ts)}</span>}
        </p>
      )}
      {Object.keys(sc).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {METRICAS.filter(([k]) => sc[k] != null).map(([k, label]) => {
            const v = sc[k]
            const val = v && typeof v === 'object' ? v.valor : v
            const ok = v && typeof v === 'object' ? v.ok : null
            const tone = ok === true ? 'border-emerald-500/30 text-emerald-200'
              : ok === false ? 'border-rose-500/30 text-rose-200'
                : 'border-white/10 text-zinc-300'
            return (
              <span key={k} className={`rounded-md border px-2 py-1 text-[10px] ${tone}`} title={label}>
                {k} {label}: <b>{String(val)}</b>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Cockpit() {
  const [tasks, setTasks] = useState([])
  const [flywheels, setFlywheels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const [q, fw] = await Promise.all([
        getTasks({ kind: KIND }),
        getTasks({ kind: KIND_FW }).catch(() => []),
      ])
      setTasks(Array.isArray(q) ? q : q.items || [])
      setFlywheels((Array.isArray(fw) ? fw : fw.items || [])
        .sort((a, b) => ((b.metadata_json || {}).status === 'rodando' ? 1 : 0) - ((a.metadata_json || {}).status === 'rodando' ? 1 : 0)))
      setError(null)
    } catch (err) {
      setError(err.message || 'falha ao carregar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  async function answer(task, value) {
    const m = meta(task)
    await updateTask(task.id, {
      status: 'done',
      metadata_json: {
        ...m,
        answer: value,
        decision_status: 'answered',
        answered_by: 'diego',
        answered_at: new Date().toISOString(),
      },
    })
    await load()
  }

  const pending = tasks.filter(isPending)
  const answered = tasks
    .filter((t) => meta(t).kind === KIND && meta(t).answer)
    .sort((a, b) => (meta(b).answered_at || '').localeCompare(meta(a).answered_at || ''))
    .slice(0, 10)

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-white">Cockpit</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Perguntas do Claude que precisam de você. Responda aqui — ele lê e continua.
        </p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Aguardando você" value={pending.length} alert={pending.length > 0} />
        <StatCard label="Respondidas (10)" value={answered.length} />
        <StatCard label="Total no kind" value={tasks.length} />
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {flywheels.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-[11px] uppercase tracking-[0.28em] text-zinc-500">
            🔄 Flywheels — o que os loops estão fazendo
          </h2>
          <div className="space-y-3">
            {flywheels.map((fw) => <FlywheelCard key={fw.id} fw={fw} />)}
          </div>
        </section>
      )}

      <h2 className="mb-3 text-[11px] uppercase tracking-[0.28em] text-zinc-500">🔔 Precisam de você</h2>
      <section className="space-y-3">
        {loading ? (
          <p className="text-sm text-zinc-500">carregando…</p>
        ) : pending.length === 0 ? (
          <div className="rounded-2xl border border-white/6 bg-white/[0.02] px-4 py-10 text-center text-sm text-zinc-500">
            Nada pendente. Quando o Claude precisar de uma decisão, credencial ou input, aparece aqui.
          </div>
        ) : (
          pending.map((task) => <QuestionCard key={task.id} task={task} onAnswer={answer} />)
        )}
      </section>

      {answered.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[11px] uppercase tracking-[0.28em] text-zinc-500">Respondidas recentemente</h2>
          <div className="space-y-2">
            {answered.map((task) => (
              <div key={task.id} className="rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
                <p className="text-sm text-zinc-300">{task.title}</p>
                <p className="mt-1 text-xs text-emerald-300">→ {meta(task).answer}</p>
                <p className="mt-0.5 text-[11px] text-zinc-600">{formatDate(meta(task).answered_at)}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
