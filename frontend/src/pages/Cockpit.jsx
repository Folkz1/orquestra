import { useCallback, useEffect, useState } from 'react'
import { getTasks, updateTask } from '../api'

// Fila de perguntas do Claude ao Diego. Reusa a tabela project_tasks:
// uma task com metadata_json.kind === 'cockpit_question' é uma pergunta.
// O Claude cria via POST /api/tasks; o Diego responde aqui (PATCH /api/tasks/{id}).
const KIND = 'cockpit_question'
const KIND_FW = 'flywheel'          // estado de um loop rodando (1 card por projeto)
const KIND_PLAN = 'plan_review'     // F5 — plano fatiado pra revisar/comentar por seção
const KIND_HB = 'cockpit_heartbeat' // pulso de cada sessão (hook Stop, determinístico)
const KIND_TASK = 'cockpit_task'    // F9 — tarefas grandes do Kanban (na fila/execução/aguardando/done)

// F9 — colunas do Kanban = enum do backend. Ordem e rótulo em PT.
const COLUNAS = [
  ['backlog', 'Na fila', 'border-zinc-600/30'],
  ['in_progress', 'Em execução', 'border-emerald-500/25'],
  ['review', 'Aguardando você', 'border-amber-500/30'],
  ['done', 'Finalizado', 'border-sky-500/20'],
]
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

// F5 — revisão de plano por seção: lê o plano fatiado, comenta cada seção, aprova/ajusta.
function PlanReviewCard({ plan, onDecide }) {
  const m = plan.metadata_json || {}
  const secoes = m.secoes || []
  const [coment, setComent] = useState(m.comentarios || {})
  const [aberta, setAberta] = useState({})
  const [busy, setBusy] = useState(false)

  const temComentario = Object.values(coment).some((c) => (c || '').trim())

  async function decidir(decisao) {
    setBusy(true)
    try { await onDecide(plan, decisao, coment) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.04] p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-white">{plan.title}</h3>
        <span className="shrink-0 rounded-full bg-violet-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
          revisar plano · {secoes.length} seções
        </span>
      </div>
      {m.project_path && <p className="mt-1 text-[11px] text-zinc-500">{m.project_path} · sha {m.plan_sha}</p>}

      <div className="mt-3 space-y-2">
        {secoes.map((s) => (
          <div key={s.id} className="rounded-lg border border-white/8 bg-black/20">
            <button
              onClick={() => setAberta((a) => ({ ...a, [s.id]: !a[s.id] }))}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/[0.03]"
            >
              <span>{aberta[s.id] ? '▾' : '▸'} {s.titulo}</span>
              {(coment[s.id] || '').trim() && <span className="text-[10px] text-amber-300">✎ comentado</span>}
            </button>
            {aberta[s.id] && (
              <div className="border-t border-white/6 px-3 py-2">
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">{s.corpo_md}</pre>
                <input
                  value={coment[s.id] || ''}
                  onChange={(e) => setComent((c) => ({ ...c, [s.id]: e.target.value }))}
                  placeholder="comentário desta seção (ajuste, dúvida, corte…)"
                  className="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => decidir('aprovado')} className="rounded-lg bg-gradient-to-br from-emerald-400 to-sky-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:opacity-90 disabled:opacity-50">
          {busy ? '…' : 'Aprovar — executa autônomo'}
        </button>
        <button disabled={busy || !temComentario} onClick={() => decidir('ajustar')} className="rounded-lg border border-amber-500/40 px-4 py-2 text-sm text-amber-200 hover:bg-amber-500/[0.08] disabled:opacity-40">
          Aprovar com ajustes ({Object.values(coment).filter((c) => (c || '').trim()).length})
        </button>
        <button disabled={busy} onClick={() => decidir('rejeitado')} className="rounded-lg border border-rose-500/40 px-4 py-2 text-sm text-rose-200 hover:bg-rose-500/[0.08] disabled:opacity-50">
          Rejeitar
        </button>
      </div>
    </div>
  )
}

// Card de PROJETO detalhado: clica e vê o que está sendo feito ali (resumo, git, loop, perguntas).
function ProjetoCard({ beat, flywheel, perguntas }) {
  const m = beat.metadata_json || {}
  const [aberto, setAberto] = useState(false)
  const min = m.updated_at ? Math.round((Date.now() - new Date(m.updated_at).getTime()) / 60000) : null
  const vivo = min != null && min < 15
  const quando = min == null ? '' : min < 15 ? `ativo agora (${min}min)` : min < 60 ? `há ${min}min` : min < 1440 ? `há ${(min / 60).toFixed(1)}h` : `há ${(min / 1440).toFixed(1)} dias`
  const fwm = (flywheel || {}).metadata_json || {}
  const commits = m.commits_recentes || []

  return (
    <div className={`rounded-xl border ${vivo ? 'border-emerald-500/25 bg-emerald-500/[0.03]' : 'border-white/6 bg-white/[0.02]'}`}>
      <button onClick={() => setAberto((a) => !a)} className="flex w-full items-start justify-between gap-2 px-4 py-3 text-left hover:bg-white/[0.02]">
        <div className="min-w-0">
          <span className="text-sm font-medium text-zinc-200">
            {vivo && <span className="mr-1 text-emerald-300">●</span>}{aberto ? '▾ ' : '▸ '}{projName(m.project_path)}
            {m.branch && <span className="ml-2 rounded bg-white/6 px-1.5 py-0.5 text-[10px] text-zinc-400">{m.branch}</span>}
          </span>
          {!aberto && m.last_summary && <p className="mt-0.5 truncate text-xs text-zinc-500">{m.last_summary}</p>}
        </div>
        <div className="shrink-0 text-right">
          <span className="text-[11px] text-zinc-500">{quando}</span>
          <div className="mt-0.5 flex justify-end gap-1.5 text-[10px]">
            {fwm.status && <span className="rounded bg-sky-500/15 px-1.5 text-sky-200">🔄 {fwm.status}</span>}
            {perguntas > 0 && <span className="rounded bg-amber-500/15 px-1.5 text-amber-200">🔔 {perguntas}</span>}
            {m.arquivos_mexidos > 0 && <span className="rounded bg-white/6 px-1.5 text-zinc-400">{m.arquivos_mexidos} arq</span>}
          </div>
        </div>
      </button>
      {aberto && (
        <div className="border-t border-white/6 px-4 py-3 space-y-3">
          {m.last_summary && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-600">o que a última sessão fez</p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">{m.last_summary}</p>
            </div>
          )}
          {commits.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-600">últimos commits (o que mudou)</p>
              <ul className="mt-1 space-y-0.5">
                {commits.map((c, i) => <li key={i} className="text-xs text-zinc-400">· {c}</li>)}
              </ul>
            </div>
          )}
          {fwm.status && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-600">loop de melhoria</p>
              <p className="mt-1 text-xs text-zinc-400">
                {fwm.status} · {(fwm.progresso || {}).feitas || 0}/{(fwm.progresso || {}).total || '?'} tarefas
                {(fwm.propostas) ? ` · ${fwm.propostas.pendentes || 0} propostas pendentes` : ''}
                {(fwm.scorecard || {}).M1 ? ` · M1 ${fwm.scorecard.M1.valor}` : ''}
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 text-[10px] text-zinc-600">
            {m.account && <span>conta: {m.account}</span>}
            {m.branch && <span>branch: {m.branch}</span>}
            {m.arquivos_mexidos != null && <span>{m.arquivos_mexidos} arquivos com mudança</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// F9 — card de tarefa do Kanban: prazo destacado + botão de execução autônoma.
function prazoInfo(prazo) {
  if (!prazo) return null
  const dias = Math.ceil((new Date(prazo + 'T23:59').getTime() - Date.now()) / 86400000)
  if (dias < 0) return { txt: `venceu ${-dias}d`, cls: 'text-rose-300' }
  if (dias === 0) return { txt: 'hoje', cls: 'text-rose-300' }
  if (dias <= 2) return { txt: `em ${dias}d`, cls: 'text-amber-300' }
  return { txt: prazo.slice(5), cls: 'text-zinc-500' }
}

function KanbanCard({ task, onExecutar, onMover }) {
  const m = task.metadata_json || {}
  const pz = prazoInfo(m.prazo)
  const jaAuto = m.autonomo && m.autonomo.solicitado
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium leading-snug text-zinc-100">{task.title}</p>
        {pz && <span className={`shrink-0 text-[10px] font-semibold ${pz.cls}`}>⏰{pz.txt}</span>}
      </div>
      {m.project_path && <p className="mt-1 text-[10px] text-zinc-500">{projName(m.project_path)}</p>}
      {task.priority === 'high' && <span className="mt-1 inline-block rounded bg-rose-500/15 px-1.5 text-[9px] text-rose-200">alta</span>}
      {task.status === 'backlog' && (
        jaAuto
          ? <p className="mt-2 text-[10px] text-emerald-300">🚀 execução solicitada</p>
          : <button onClick={() => onExecutar(task)} className="mt-2 w-full rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/[0.12]">
              ▶ Executar autônomo
            </button>
      )}
    </div>
  )
}

export default function Cockpit() {
  const [tasks, setTasks] = useState([])
  const [flywheels, setFlywheels] = useState([])
  const [plans, setPlans] = useState([])
  const [kanban, setKanban] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [beats, setBeats] = useState([])

  const load = useCallback(async () => {
    try {
      const [q, fw, pl, hb, kb] = await Promise.all([
        getTasks({ kind: KIND }),
        getTasks({ kind: KIND_FW }).catch(() => []),
        getTasks({ kind: KIND_PLAN }).catch(() => []),
        getTasks({ kind: KIND_HB }).catch(() => []),
        getTasks({ kind: KIND_TASK }).catch(() => []),
      ])
      setTasks(Array.isArray(q) ? q : q.items || [])
      setFlywheels((Array.isArray(fw) ? fw : fw.items || [])
        .sort((a, b) => ((b.metadata_json || {}).status === 'rodando' ? 1 : 0) - ((a.metadata_json || {}).status === 'rodando' ? 1 : 0)))
      setPlans((Array.isArray(pl) ? pl : pl.items || []).filter((p) => (p.metadata_json || {}).decisao === 'pendente'))
      setBeats((Array.isArray(hb) ? hb : hb.items || [])
        .sort((a, b) => ((b.metadata_json || {}).updated_at || '').localeCompare((a.metadata_json || {}).updated_at || '')))
      setKanban(Array.isArray(kb) ? kb : kb.items || [])
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

  // F9 — Diego clica "Executar autônomo": grava a solicitação; o dispatcher pega e roda.
  async function executarTask(task) {
    const m = task.metadata_json || {}
    if (!m.criterio_pronto && !task.description) {
      const crit = window.prompt('Qual é o critério de "pronto" desta tarefa? (o agente precisa saber quando terminou)')
      if (!crit) return
      m.criterio_pronto = crit
    }
    await updateTask(task.id, {
      metadata_json: { ...m, autonomo: { solicitado: true, em: new Date().toISOString() } },
    })
    await load()
  }

  // F5 — Diego decide um plano: aprovado assina o sha (o dispatcher só executa essa versão).
  async function decidePlan(plan, decisao, comentarios) {
    const m = plan.metadata_json || {}
    await updateTask(plan.id, {
      status: decisao === 'rejeitado' ? 'cancelled' : 'review',
      metadata_json: {
        ...m,
        decisao,
        comentarios,
        approved_sha: decisao === 'aprovado' ? m.plan_sha : (decisao === 'ajustar' ? null : m.approved_sha),
        decided_by: 'diego',
        decided_at: new Date().toISOString(),
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

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Aguardando você" value={pending.length} alert={pending.length > 0} />
        <StatCard label="Na fila" value={kanban.filter((t) => t.status === 'backlog').length} />
        <StatCard label="Em execução" value={kanban.filter((t) => t.status === 'in_progress').length} />
        <StatCard label="Vencendo (≤2d)" value={kanban.filter((t) => { const p = (t.metadata_json || {}).prazo; if (!p || t.status === 'done') return false; return (new Date(p + 'T23:59') - Date.now()) / 86400000 <= 2 }).length} alert={kanban.some((t) => { const p = (t.metadata_json || {}).prazo; if (!p || t.status === 'done') return false; return (new Date(p + 'T23:59') - Date.now()) / 86400000 <= 2 })} />
      </div>

      {kanban.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-[11px] uppercase tracking-[0.28em] text-zinc-500">🗂️ Kanban — o que tem pra fazer</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {COLUNAS.map(([st, label, borda]) => {
              const cards = kanban
                .filter((t) => t.status === st)
                .sort((a, b) => ((a.metadata_json || {}).prazo || '9999').localeCompare((b.metadata_json || {}).prazo || '9999'))
              return (
                <div key={st} className={`rounded-xl border ${borda} bg-white/[0.02] p-2`}>
                  <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label} <span className="text-zinc-600">{cards.length}</span></p>
                  <div className="space-y-2">
                    {cards.map((t) => <KanbanCard key={t.id} task={t} onExecutar={executarTask} />)}
                    {cards.length === 0 && <p className="px-1 py-4 text-center text-[10px] text-zinc-600">—</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {plans.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-[11px] uppercase tracking-[0.28em] text-zinc-500">
            📋 Planos para revisar
          </h2>
          <div className="space-y-3">
            {plans.map((p) => <PlanReviewCard key={p.id} plan={p} onDecide={decidePlan} />)}
          </div>
        </section>
      )}

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

      {beats.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-[11px] uppercase tracking-[0.28em] text-zinc-500">
            🫀 Atividade dos projetos — última sessão de cada um
          </h2>
          <div className="space-y-2">
            {beats.map((t) => {
              const pp = (t.metadata_json || {}).project_path || ''
              const fw = flywheels.find((f) => (f.metadata_json || {}).project_path === pp)
              const nq = tasks.filter((q) => isPending(q) && ((q.metadata_json || {}).project_path || '') === pp).length
              return <ProjetoCard key={t.id} beat={t} flywheel={fw} perguntas={nq} />
            })}
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
