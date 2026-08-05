import { useCallback, useEffect, useMemo, useState } from 'react'
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

// Métricas do scorecard do Flywheel (M1-M7). O código (M1…) é apelido interno: fica no
// tooltip, nunca como rótulo — quem lê a tela vê "precisão", não "M1".
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

function projName(p) {
  return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

// Os project_path chegam com caixa e barra inconsistentes ("D:/projetos/X" vs "d:\projetos\x").
// Sem normalizar, o Kanban/flywheel nunca casa com o heartbeat do mesmo projeto e os cards
// duplicam: 50 pulsos para 8 projetos reais. Esta chave é o que junta tudo.
function chaveProjeto(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

// Mantém só o registro mais recente de cada projeto (o resto é histórico, não estado).
function ultimoPorProjeto(lista, quando) {
  const porChave = new Map()
  for (const item of lista) {
    const k = chaveProjeto(meta(item).project_path)
    const atual = porChave.get(k)
    if (!atual || String(quando(item) || '') > String(quando(atual) || '')) porChave.set(k, item)
  }
  return [...porChave.values()]
}

function tempoAtras(iso) {
  if (!iso) return null
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6
  if (h < 1) return `há ${Math.round(h * 60)}min`
  if (h < 24) return `há ${h.toFixed(1)}h`
  return `há ${(h / 24).toFixed(1)} dias`
}

// Lembra o que o Diego deixou aberto/fechado — abrir a aba não desfaz a escolha dele.
function useAberto(chave, inicial) {
  const [aberto, setAberto] = useState(() => {
    try {
      const v = localStorage.getItem(`cockpit:${chave}`)
      return v == null ? inicial : v === '1'
    } catch {
      return inicial
    }
  })
  const alternar = useCallback(() => {
    setAberto((a) => {
      try { localStorage.setItem(`cockpit:${chave}`, a ? '0' : '1') } catch { /* modo privado */ }
      return !a
    })
  }, [chave])
  return [aberto, alternar]
}

// Faixa = um nível de urgência. A de cima nunca colapsa; as de baixo guardam o ruído.
function Faixa({ titulo, sub, total, tom = 'neutro', fixa = false, chave, inicial = false, children }) {
  const [aberto, alternar] = useAberto(chave, inicial)
  const mostrando = fixa || aberto
  const cor = tom === 'urgente'
    ? 'text-amber-200'
    : tom === 'vivo' ? 'text-emerald-200' : 'text-zinc-400'

  return (
    <section className="mb-6">
      {fixa ? (
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className={`text-sm font-semibold ${cor}`}>{titulo}</h2>
          {sub && <span className="text-xs text-zinc-500">{sub}</span>}
        </div>
      ) : (
        <button
          onClick={alternar}
          aria-expanded={mostrando}
          className="mb-3 flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-4 text-left hover:bg-white/[0.04]"
        >
          <span className="flex items-baseline gap-2">
            <span className={`text-sm font-semibold ${cor}`}>{titulo}</span>
            {sub && <span className="text-xs text-zinc-500">{sub}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {total > 0 && <span className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] text-zinc-300">{total}</span>}
            <span className="text-zinc-500">{mostrando ? '▾' : '▸'}</span>
          </span>
        </button>
      )}
      {mostrando && children}
    </section>
  )
}

// Agrupa os pendentes por projeto (GitHub agrupa por repo: 2 pendências de um projeto
// lê-se mais rápido que 8 cards misturados). Com 1 projeto só, o cabeçalho é ruído.
function GrupoProjeto({ nome, quantos, unico, children }) {
  if (unico) return <div className="space-y-3">{children}</div>
  return (
    <div className="mb-4">
      <p className="mb-2 flex items-baseline gap-2 px-1">
        <span className="text-xs font-medium text-zinc-300">{nome}</span>
        <span className="text-[11px] text-zinc-600">{quantos} {quantos === 1 ? 'item' : 'itens'}</span>
      </p>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function QuestionCard({ task, onAnswer }) {
  const m = meta(task)
  const ui = UI_META[m.ui] ? m.ui : 'decision'
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [expandido, setExpandido] = useState(false)
  const [escrevendo, setEscrevendo] = useState(ui !== 'decision')

  const contexto = m.context || task.description || ''
  const longo = contexto.length > 140
  const opcoes = ui === 'decision' ? (m.options || DEFAULT_OPTIONS) : []

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
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.03] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold leading-snug text-white">{task.title}</h3>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${UI_META[ui].badge}`}>
          {UI_META[ui].label}
        </span>
      </div>

      {contexto && (
        <>
          <p className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300 ${longo && !expandido ? 'line-clamp-2' : ''}`}>
            {contexto}
          </p>
          {longo && (
            <button
              onClick={() => setExpandido((e) => !e)}
              className="mt-1 text-xs font-medium text-sky-300 hover:text-sky-200"
            >
              {expandido ? 'menos' : 'ver contexto completo'}
            </button>
          )}
        </>
      )}

      {m.como_verificar && expandido && (
        <p className="mt-3 rounded-lg border-l-2 border-sky-500/40 bg-black/20 px-3 py-2 text-xs text-zinc-300">
          <span className="text-zinc-500">como conferir:</span> {m.como_verificar}
        </p>
      )}

      {/* 1 toque = 1 decisão. Os botões resolvem o card; o campo livre só aparece se ele pedir. */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {opcoes.map((opt) => (
          <button
            key={opt}
            disabled={sending}
            onClick={() => send(opt)}
            className="min-h-[48px] rounded-xl border border-white/12 bg-white/[0.05] px-4 text-sm font-medium text-zinc-100 hover:bg-white/[0.1] disabled:opacity-50"
          >
            {opt}
          </button>
        ))}
      </div>

      {escrevendo ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            type={ui === 'credential' ? 'password' : 'text'}
            value={text}
            autoFocus={ui === 'decision'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send() }}
            placeholder={ui === 'credential' ? 'cole a chave/token/senha…' : ui === 'input' ? 'digite o valor…' : 'escreva a resposta…'}
            className="min-h-[48px] flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white placeholder:text-zinc-600 focus:border-sky-500/40 focus:outline-none"
          />
          <button
            disabled={sending || !text.trim()}
            onClick={() => send()}
            className="min-h-[48px] rounded-xl bg-gradient-to-br from-sky-400 to-violet-400 px-5 text-sm font-semibold text-zinc-950 hover:opacity-90 disabled:opacity-40"
          >
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setEscrevendo(true)}
          className="mt-2 text-xs font-medium text-zinc-400 hover:text-zinc-200"
        >
          responder com minhas palavras
        </button>
      )}

      <p className="mt-3 text-[11px] text-zinc-600">
        {projName(m.project_path) || task.source} · {formatDate(task.created_at)}
      </p>
    </div>
  )
}

// F1 — vivacidade: cada estado tem cor própria (mata o "verde mentiroso").
const VIV = {
  rodando:   { card: 'border-emerald-500/30 bg-emerald-500/[0.04]', badge: 'bg-emerald-500/15 text-emerald-200', dot: '●' },
  ocioso:    { card: 'border-amber-500/25 bg-amber-500/[0.03]',     badge: 'bg-amber-500/15 text-amber-200',   dot: '◐' },
  parado:    { card: 'border-zinc-600/30 bg-white/[0.02]',          badge: 'bg-zinc-700/40 text-zinc-400',      dot: '○' },
  estagnado: { card: 'border-rose-500/40 bg-rose-500/[0.05]',       badge: 'bg-rose-500/15 text-rose-200',      dot: '⚠' },
}

// Os eixos do scorecard em ✅/❌, legíveis sem abrir nada.
function Scorecard({ sc }) {
  const eixos = METRICAS.filter(([k]) => sc[k] != null)
  if (eixos.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {eixos.map(([k, label]) => {
        const v = sc[k]
        const val = v && typeof v === 'object' ? v.valor : v
        const ok = v && typeof v === 'object' ? v.ok : null
        const tone = ok === true ? 'border-emerald-500/30 text-emerald-200'
          : ok === false ? 'border-rose-500/30 text-rose-200'
            : 'border-white/10 text-zinc-300'
        return (
          <span key={k} className={`rounded-md border px-2 py-1 text-[11px] ${tone}`} title={`${k} — ${label}`}>
            {ok === true ? '✅' : ok === false ? '❌' : '·'} {label} <b>{String(val)}</b>
          </span>
        )
      })}
    </div>
  )
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
    <div className={`rounded-2xl border p-4 sm:p-5 ${v.card}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-white">
          🔄 {projName(m.project_path) || fw.title}
          {m.sessao_ativa && <span className="ml-2 align-middle text-[10px] font-medium text-emerald-300">● sessão ativa agora</span>}
        </h3>
        {/* a "janela" às vezes chega como um parágrafo inteiro — o badge trunca e guarda o resto no tooltip */}
        <span
          className={`max-w-[40%] shrink-0 truncate rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${v.badge}`}
          title={[m.janela, m.vivacidade_motivo].filter(Boolean).join(' · ')}
        >
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
      <Scorecard sc={sc} />
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
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.04] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold leading-snug text-white">{plan.title}</h3>
        <span className="shrink-0 rounded-full bg-violet-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
          {secoes.length} seções
        </span>
      </div>
      {m.project_path && <p className="mt-1 text-[11px] text-zinc-500" title={m.plan_sha ? `versão ${m.plan_sha}` : ''}>{projName(m.project_path)}</p>}

      <div className="mt-3 space-y-2">
        {secoes.map((s) => (
          <div key={s.id} className="rounded-lg border border-white/8 bg-black/20">
            <button
              onClick={() => setAberta((a) => ({ ...a, [s.id]: !a[s.id] }))}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-left text-sm text-zinc-200 hover:bg-white/[0.03]"
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
                  className="mt-2 min-h-[44px] w-full rounded-md border border-white/10 bg-black/30 px-2.5 text-xs text-white placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button disabled={busy} onClick={() => decidir('aprovado')} className="min-h-[48px] rounded-xl bg-gradient-to-br from-emerald-400 to-sky-400 px-4 text-sm font-semibold text-zinc-950 hover:opacity-90 disabled:opacity-50">
          {busy ? '…' : 'Aprovar'}
        </button>
        <button disabled={busy || !temComentario} onClick={() => decidir('ajustar')} className="min-h-[48px] rounded-xl border border-amber-500/40 px-4 text-sm text-amber-200 hover:bg-amber-500/[0.08] disabled:opacity-40">
          Aprovar com ajustes ({Object.values(coment).filter((c) => (c || '').trim()).length})
        </button>
        <button disabled={busy} onClick={() => decidir('rejeitado')} className="min-h-[48px] rounded-xl border border-rose-500/40 px-4 text-sm text-rose-200 hover:bg-rose-500/[0.08] disabled:opacity-50">
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
      <button onClick={() => setAberto((a) => !a)} className="flex min-h-[44px] w-full items-start justify-between gap-2 px-4 py-3 text-left hover:bg-white/[0.02]">
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
        <div className="space-y-3 border-t border-white/6 px-4 py-3">
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
  if (dias < 0) return { txt: `venceu ${-dias}d`, cls: 'text-rose-300', urgente: true }
  if (dias === 0) return { txt: 'hoje', cls: 'text-rose-300', urgente: true }
  if (dias <= 2) return { txt: `em ${dias}d`, cls: 'text-amber-300', urgente: true }
  return { txt: prazo.slice(5), cls: 'text-zinc-500', urgente: false }
}

function KanbanCard({ task, onExecutar }) {
  const m = task.metadata_json || {}
  const pz = prazoInfo(m.prazo)
  const jaAuto = m.autonomo && m.autonomo.solicitado
  // Sem critério de pronto o agente não sabe quando parou — pergunta inline, nunca um popup.
  const precisaCriterio = !m.criterio_pronto && !task.description
  const [criterio, setCriterio] = useState('')
  const [pedindo, setPedindo] = useState(false)

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
          : pedindo && precisaCriterio
            ? (
              <div className="mt-2 space-y-1.5">
                <input
                  autoFocus
                  value={criterio}
                  onChange={(e) => setCriterio(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && criterio.trim()) onExecutar(task, criterio.trim()) }}
                  placeholder="quando esta tarefa está pronta?"
                  className="min-h-[40px] w-full rounded-md border border-white/10 bg-black/30 px-2 text-[11px] text-white placeholder:text-zinc-600 focus:border-emerald-500/40 focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <button
                    disabled={!criterio.trim()}
                    onClick={() => onExecutar(task, criterio.trim())}
                    className="min-h-[36px] flex-1 rounded-md border border-emerald-500/30 bg-emerald-500/[0.08] text-[10px] font-semibold text-emerald-200 disabled:opacity-40"
                  >
                    Começar
                  </button>
                  <button onClick={() => setPedindo(false)} className="min-h-[36px] rounded-md px-2 text-[10px] text-zinc-500 hover:text-zinc-300">
                    cancelar
                  </button>
                </div>
              </div>
            )
            : (
              <button
                onClick={() => (precisaCriterio ? setPedindo(true) : onExecutar(task))}
                className="mt-2 min-h-[40px] w-full rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/[0.12]"
              >
                ▶ Executar sozinho
              </button>
            )
      )}
    </div>
  )
}

// Uma tarefa parada em "Aguardando você" é pendência do Diego — sobe pro topo, não fica no Kanban.
function TarefaAguardando({ task }) {
  const m = task.metadata_json || {}
  const pz = prazoInfo(m.prazo)
  return (
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold leading-snug text-white">{task.title}</h3>
        {pz && <span className={`shrink-0 text-[11px] font-semibold ${pz.cls}`}>⏰{pz.txt}</span>}
      </div>
      {(m.contexto || task.description) && (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-400">{m.contexto || task.description}</p>
      )}
      <p className="mt-2 text-[11px] text-zinc-600">
        parada em “Aguardando você”{m.criterio_pronto ? ` · pronta quando: ${m.criterio_pronto}` : ''}
      </p>
    </div>
  )
}

export default function Cockpit() {
  const [tasks, setTasks] = useState([])
  const [flywheels, setFlywheels] = useState([])
  const [plans, setPlans] = useState([])
  const [kanban, setKanban] = useState([])
  const [beats, setBeats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Respondidos somem na hora (zero-inbox): a resposta É o "marcar como lido".
  const [resolvidos, setResolvidos] = useState(() => new Set())

  const load = useCallback(async () => {
    try {
      const [q, fw, pl, hb, kb] = await Promise.all([
        getTasks({ kind: KIND }),
        getTasks({ kind: KIND_FW }).catch(() => []),
        getTasks({ kind: KIND_PLAN }).catch(() => []),
        getTasks({ kind: KIND_HB }).catch(() => []),
        getTasks({ kind: KIND_TASK }).catch(() => []),
      ])
      const lista = (x) => (Array.isArray(x) ? x : x.items || [])
      setTasks(lista(q))
      setFlywheels(ultimoPorProjeto(lista(fw), (t) => meta(t).updated_at || t.updated_at || t.created_at))
      setPlans(lista(pl).filter((p) => meta(p).decisao === 'pendente'))
      setBeats(ultimoPorProjeto(lista(hb), (t) => meta(t).updated_at || t.updated_at || t.created_at)
        .sort((a, b) => (meta(b).updated_at || '').localeCompare(meta(a).updated_at || '')))
      setKanban(lista(kb).filter((t) => !meta(t).arquivado))
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
    setResolvidos((s) => new Set(s).add(task.id))
    try {
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
    } catch (err) {
      setResolvidos((s) => { const n = new Set(s); n.delete(task.id); return n })
      setError(err.message || 'não consegui salvar a resposta')
      return
    }
    await load()
  }

  // F9 — Diego clica "Executar sozinho": grava a solicitação; o dispatcher pega e roda.
  async function executarTask(task, criterio) {
    const m = task.metadata_json || {}
    if (criterio) m.criterio_pronto = criterio
    await updateTask(task.id, {
      metadata_json: { ...m, autonomo: { solicitado: true, em: new Date().toISOString() } },
    })
    await load()
  }

  // F5 — Diego decide um plano: aprovado assina o sha (o dispatcher só executa essa versão).
  async function decidePlan(plan, decisao, comentarios) {
    const m = plan.metadata_json || {}
    setResolvidos((s) => new Set(s).add(plan.id))
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

  const vivo = (t) => !resolvidos.has(t.id)
  const pending = tasks.filter(isPending).filter(vivo)
  const planosAbertos = plans.filter(vivo)
  const aguardando = kanban.filter((t) => t.status === 'review')
  const answered = tasks
    .filter((t) => meta(t).kind === KIND && meta(t).answer)
    .sort((a, b) => (meta(b).answered_at || '').localeCompare(meta(a).answered_at || ''))
    .slice(0, 10)

  const totalPendente = pending.length + planosAbertos.length + aguardando.length

  // Agrupa o que precisa dele por projeto, mantendo perguntas antes de planos e tarefas.
  const grupos = useMemo(() => {
    const mapa = new Map()
    const add = (item, tipo) => {
      const k = chaveProjeto(meta(item).project_path) || 'sem-projeto'
      if (!mapa.has(k)) mapa.set(k, { nome: projName(meta(item).project_path) || 'sem projeto', itens: [] })
      mapa.get(k).itens.push({ item, tipo })
    }
    pending.forEach((t) => add(t, 'pergunta'))
    planosAbertos.forEach((p) => add(p, 'plano'))
    aguardando.forEach((t) => add(t, 'tarefa'))
    return [...mapa.values()].sort((a, b) => b.itens.length - a.itens.length)
  }, [pending, planosAbertos, aguardando])

  const loopsVivos = flywheels.filter((f) => ['rodando', 'estagnado'].includes((meta(f).status || '').toLowerCase()))
  const emExecucao = kanban.filter((t) => t.status === 'in_progress')
  const vencendo = kanban.filter((t) => {
    const p = meta(t).prazo
    if (!p || t.status === 'done') return false
    return (new Date(p + 'T23:59') - Date.now()) / 86400000 <= 2
  })

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-white">Cockpit</h1>
        {loading ? (
          <p className="mt-1 text-sm text-zinc-500">carregando…</p>
        ) : totalPendente > 0 ? (
          <p className="mt-1 text-sm text-amber-200">
            {totalPendente === 1 ? '1 coisa espera por você' : `${totalPendente} coisas esperam por você`}
            {vencendo.length > 0 && <span className="text-zinc-500"> · {vencendo.length} com prazo apertado</span>}
          </p>
        ) : (
          <p className="mt-1 text-sm text-zinc-400">Nada esperando por você.</p>
        )}
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* NÍVEL 1 — só o que exige o Diego. Nunca colapsa, sempre no topo. */}
      <Faixa titulo="⛔ Precisa de você" sub={totalPendente > 0 ? `${totalPendente}` : ''} fixa chave="pendentes">
        {loading ? (
          <p className="text-sm text-zinc-500">carregando…</p>
        ) : totalPendente === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-10 text-center">
            <p className="text-3xl">✅</p>
            <p className="mt-2 text-sm font-medium text-emerald-200">Tudo respondido.</p>
            <p className="mt-1 text-xs text-zinc-500">Quando o Claude precisar de uma decisão, credencial ou input, aparece aqui.</p>
          </div>
        ) : (
          grupos.map((g) => (
            <GrupoProjeto key={g.nome} nome={g.nome} quantos={g.itens.length} unico={grupos.length === 1}>
              {g.itens.map(({ item, tipo }) => (
                tipo === 'pergunta' ? <QuestionCard key={item.id} task={item} onAnswer={answer} />
                  : tipo === 'plano' ? <PlanReviewCard key={item.id} plan={item} onDecide={decidePlan} />
                    : <TarefaAguardando key={item.id} task={item} />
              ))}
            </GrupoProjeto>
          ))
        )}
      </Faixa>

      {/* NÍVEL 2 — o que está vivo agora. Informativo, mas quente. */}
      {(loopsVivos.length > 0 || emExecucao.length > 0) && (
        <Faixa
          titulo="🔄 Acontecendo agora"
          sub="loops e tarefas em andamento"
          tom="vivo"
          total={loopsVivos.length + emExecucao.length}
          chave="agora"
          inicial
        >
          <div className="space-y-3">
            {loopsVivos.map((fw) => <FlywheelCard key={fw.id} fw={fw} />)}
            {emExecucao.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {emExecucao.map((t) => <KanbanCard key={t.id} task={t} onExecutar={executarTask} />)}
              </div>
            )}
          </div>
        </Faixa>
      )}

      {/* NÍVEL 3 — acompanhamento. Fica fechado: é o que enchia a tela sem pedir nada. */}
      {kanban.length > 0 && (
        <Faixa titulo="🗂️ Tarefas" sub="a fila inteira" total={kanban.length} chave="kanban">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {COLUNAS.map(([st, label, borda]) => {
              const cards = kanban
                .filter((t) => t.status === st)
                .sort((a, b) => (meta(a).prazo || '9999').localeCompare(meta(b).prazo || '9999'))
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
        </Faixa>
      )}

      {flywheels.length > 0 && (
        <Faixa titulo="📊 Todos os loops de melhoria" total={flywheels.length} chave="loops">
          <div className="space-y-3">
            {flywheels.map((fw) => <FlywheelCard key={fw.id} fw={fw} />)}
          </div>
        </Faixa>
      )}

      {beats.length > 0 && (
        <Faixa titulo="🫀 Atividade dos projetos" sub="última sessão de cada um" total={beats.length} chave="atividade">
          <div className="space-y-2">
            {beats.map((t) => {
              const pp = chaveProjeto(meta(t).project_path)
              const fw = flywheels.find((f) => chaveProjeto(meta(f).project_path) === pp)
              const nq = pending.filter((q) => chaveProjeto(meta(q).project_path) === pp).length
              return <ProjetoCard key={t.id} beat={t} flywheel={fw} perguntas={nq} />
            })}
          </div>
        </Faixa>
      )}

      {answered.length > 0 && (
        <Faixa titulo="✓ Já respondidas" total={answered.length} chave="historico">
          <div className="space-y-2">
            {answered.map((task) => (
              <div key={task.id} className="rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
                <p className="text-sm text-zinc-300">{task.title}</p>
                <p className="mt-1 text-xs text-emerald-300">→ {meta(task).answer}</p>
                <p className="mt-0.5 text-[11px] text-zinc-600">{formatDate(meta(task).answered_at)}</p>
              </div>
            ))}
          </div>
        </Faixa>
      )}
    </div>
  )
}
