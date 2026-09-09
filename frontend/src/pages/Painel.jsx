import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getPainelGates, getPainelKpi, getPainelPlacar, getPainelResumo, getPainelSerie, responderPainelGate } from '../api'

// Painel de Regência — o quartel-general: gates do Diego, as duas contas Claude ao longo do tempo,
// o placar de cada frente e os KPIs por dia. Só lê a API (/api/painel/*); quem escreve são os coletores,
// as sessões (por ficheiro JSON) e a regência. Briefing em docs/briefings/painel-regencia.md.
// Mobile primeiro: uma coluna, cartões, tabelas com scroll próprio, âncora #gate-<id> por cartão.

const POLL_MS = 30000
const POLL_AGORA_MS = 15000   // o consumo mexe a cada minuto; o resto do painel não precisa disto
const TABS = [
  ['gates', 'Gates'],
  ['frentes', 'Frentes'],
  ['contas', 'Contas'],
  ['kpis', 'KPIs'],
]
const TETO = 80 // política da casa: aos 80% o Eduardo pára e o Diego entra em economia
const CHART_TICK = { fill: '#71717a', fontSize: 11 }
const CHART_TOOLTIP = { background: '#10141b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 12 }
const CORES = ['#8bd450', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#34d399']

// métricas conhecidas, na ordem em que aparecem; o que não estiver aqui entra no fim com o nome cru
const METRICAS = [
  ['custo_usd', 'Custo US$', (v) => '$' + Math.round(v).toLocaleString('en-US')],
  ['pontos', 'Valor (pts)'],
  ['valor_custo', 'Valor/custo', (v) => Number(v).toFixed(4)],
  ['deploy_provado', 'Deploys provados'],
  ['entrega_confirmada', 'Entregas confirmadas'],
  ['pr_fundida', 'PRs fundidas'],
  ['envio_cliente', 'Envios a cliente'],
  ['relatorio_verified', 'Reportes VERIFIED'],
  ['painel_gates_abertos', 'Gates abertos (painel)'],
  ['painel_gates_respondidos', 'Respondidos (painel)'],
  ['painel_gates_executados', 'Executados (painel)'],
  ['gates_abertos_na_janela', 'Gates abertos (canal)'],
  ['gates_respondidos', 'Respondidos (canal)'],
  ['gates_expirados', 'Expirados (canal)'],
  ['gates_pendentes', 'Pendentes (canal)'],
  ['gates_mediana_min', 'Mediana resposta', (v) => Math.round(v) + ' min'],
  ['sessoes', 'Sessões'],
  ['respostas', 'Respostas'],
  ['retrabalho_pct', 'Retrabalho', (v) => Number(v).toFixed(1) + '%'],
  ['pronto_declarado', 'PRONTO declarado'],
  ['cliente_sem_resposta_min', 'Cliente s/ resposta', (v) => Math.round(v) + ' min'],
  ['custo_pct_limite', '% do limite', (v) => Number(v).toFixed(1) + '%'],
  ['custo_usd_diego', 'Custo Diego', (v) => '$' + Math.round(v).toLocaleString('en-US')],
  ['custo_usd_eduardo', 'Custo Eduardo', (v) => '$' + Math.round(v).toLocaleString('en-US')],
]
const ESCONDER = new Set(['janela_dias', 'gerado'])
// No telemóvel uma tabela de 27 colunas não se lê: cada frente vira um cartão com as cinco métricas que
// respondem «esta frente valeu o que custou?». A tabela inteira fica no desktop, onde cabe.
const NO_CARTAO = ['custo_usd', 'pontos', 'deploy_provado', 'pr_fundida', 'envio_cliente']
// ⛔ rácios, medianas e percentagens NÃO se somam. Somar «valor/custo» de 9 frentes deu 53,4 no staging,
// um número que não quer dizer nada e que estaria na primeira linha do ecrã do Diego. Estes aparecem
// na tabela, por dia e por frente, onde têm sentido — nunca num cartão de total.
const NAO_SOMAVEL = new Set(['valor_custo', 'custo_pct_limite', 'retrabalho_pct', 'gates_mediana_min',
  'gates_mesa_mediana_min', 'cliente_sem_resposta_min'])

function fmtData(value, opts = { dateStyle: 'short', timeStyle: 'short' }) {
  if (!value) return ''
  try { return new Date(value).toLocaleString('pt-BR', opts) } catch { return String(value) }
}
// idade em SEGUNDOS enquanto é recente: é o que prova ao Diego que o número é de agora e não de há uma hora
function idadeCurta(value) {
  if (!value) return 'sem hora'
  const s = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  if (s < 90) return `há ${s}s`
  return idade(value)
}
function idade(value) {
  if (!value) return 'sem hora'
  const min = Math.round((Date.now() - new Date(value).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 90) return `há ${min} min`
  if (min < 48 * 60) return `há ${(min / 60).toFixed(1)} h`
  return `há ${Math.round(min / 1440)} d`
}
function corPct(p) {
  if (p == null) return 'text-zinc-500'
  if (p >= TETO) return 'text-rose-300'
  if (p >= TETO - 15) return 'text-amber-300'
  return 'text-emerald-300'
}
function bordaPct(p) {
  if (p == null) return 'border-white/6 bg-white/[0.03]'
  if (p >= TETO) return 'border-rose-500/50 bg-rose-500/[0.07]'
  if (p >= TETO - 15) return 'border-amber-500/40 bg-amber-500/[0.06]'
  return 'border-white/6 bg-white/[0.03]'
}

function StatCard({ label, value, alert, sub }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${alert ? 'border-amber-500/40 bg-amber-500/[0.06]' : 'border-white/6 bg-white/[0.03]'}`}>
      <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${active ? 'border-[#8bd450]/60 bg-[#8bd450]/15 text-[#c9f28f]' : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]'}`}
    >
      {children}
    </button>
  )
}

// ─── Gates ────────────────────────────────────────────────────────────────

function GateCard({ gate, onResponder, destacado }) {
  const [escolha, setEscolha] = useState(null)
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(null)
  const [verCtx, setVerCtx] = useState(gate.urg)
  const aberto = gate.estado === 'aberto'

  async function gravar() {
    if (!escolha) return
    setEnviando(true)
    setErro(null)
    try {
      await onResponder(gate, { escolha, nota })
      setEscolha(null)
      setNota('')
    } catch (e) {
      setErro(e.message || 'falha ao gravar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    // âncora por gate: o link do WhatsApp abre este cartão no telemóvel. O id do DOM é derivado do id do
    // gate mas vive só aqui — a resposta usa gate.id, nunca o que estiver escrito no DOM.
    <div
      id={`gate-${gate.id}`}
      className={`scroll-mt-4 rounded-2xl border p-4 sm:p-5 ${destacado ? 'border-[#8bd450]/60 bg-[#8bd450]/[0.05] ring-1 ring-[#8bd450]/30' : gate.urg && aberto ? 'border-rose-500/40 bg-rose-500/[0.04]' : 'border-white/8 bg-white/[0.03]'}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-zinc-300">{gate.id}</span>
        <span className="text-zinc-400">{gate.projeto_nome || gate.frente || gate.projeto}</span>
        {gate.urg && aberto && <span className="rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 font-semibold uppercase tracking-wide text-rose-200">urgente</span>}
        {!aberto && (
          <span className={`rounded-full border px-2 py-0.5 uppercase tracking-wide ${gate.estado === 'respondido' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300'}`}>
            {gate.estado === 'respondido' ? `respondido ${gate.escolha || ''}` : 'expirado'}
          </span>
        )}
        {gate.executado_em && <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 uppercase tracking-wide text-sky-200">executado</span>}
        <span className="ml-auto text-zinc-600">{gate.ts_aberto ? `aberto ${fmtData(gate.ts_aberto)}` : 'abertura não medida'}</span>
      </div>

      <h3 className="mt-2 text-[15px] font-semibold leading-snug text-white">{gate.titulo}</h3>
      {gate.why && <p className="mt-1 text-xs text-zinc-500">Por que é seu · {gate.why}</p>}

      {(gate.ctx || []).length > 0 && (
        <div className="mt-3">
          <button onClick={() => setVerCtx((v) => !v)} className="text-xs text-sky-300 hover:underline">
            {verCtx ? 'esconder contexto' : `ver contexto (${gate.ctx.length})`}
          </button>
          {verCtx && (
            <div className="mt-2 space-y-2 border-l border-white/10 pl-3">
              {gate.ctx.map((p, i) => <p key={i} className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-300">{String(p)}</p>)}
            </div>
          )}
        </div>
      )}

      {(gate.opts || []).length > 0 && (
        <div className="mt-4 space-y-2">
          {gate.opts.map((o, i) => {
            const [letra, rotulo, consequencia] = Array.isArray(o) ? o : [String(i + 1), String(o), '']
            const sel = escolha === letra || (!aberto && gate.escolha === letra)
            return (
              <button
                key={letra + i}
                disabled={!aberto || enviando}
                onClick={() => setEscolha(letra)}
                className={`block w-full rounded-xl border px-3 py-2 text-left transition disabled:cursor-default ${sel ? 'border-[#8bd450]/60 bg-[#8bd450]/10' : 'border-white/10 bg-black/20 hover:bg-white/[0.05]'}`}
              >
                <span className="text-sm font-semibold text-white"><span className="mr-2 font-mono text-[#c9f28f]">{letra}</span>{rotulo}</span>
                {consequencia && <span className="mt-0.5 block text-xs leading-relaxed text-zinc-400">{consequencia}</span>}
              </button>
            )
          })}
        </div>
      )}

      {gate.rec && (
        <p className="mt-3 rounded-lg border border-[#8bd450]/20 bg-[#8bd450]/[0.06] px-3 py-2 text-[13px] leading-relaxed text-zinc-200">
          <span className="font-semibold text-[#c9f28f]">Recomendação · </span>{gate.rec}
        </p>
      )}

      {aberto ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start">
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={2}
            placeholder="nota (opcional): o que muda, o que quer que se faça…"
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-sky-500/40 focus:outline-none"
          />
          <button
            disabled={!escolha || enviando}
            onClick={gravar}
            className="rounded-lg bg-gradient-to-br from-[#8bd450] to-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:opacity-90 disabled:opacity-40"
          >
            {enviando ? 'Gravando…' : escolha ? `Responder ${escolha}` : 'Escolha uma opção'}
          </button>
        </div>
      ) : (
        <div className="mt-3 text-xs text-zinc-400">
          {gate.nota && <p className="whitespace-pre-wrap text-zinc-300">«{gate.nota}»</p>}
          <p className="mt-1 text-zinc-600">
            {gate.ts_resposta ? `respondido ${fmtData(gate.ts_resposta)}` : ''}
            {gate.respondido_por ? ` por ${gate.respondido_por}` : ''}
            {gate.origem ? ` · origem ${gate.origem}` : ''}
          </p>
          {gate.executado_em ? (
            <p className="mt-1 text-sky-300">executado {fmtData(gate.executado_em)}{gate.executado_prova ? ` · ${gate.executado_prova}` : ''}</p>
          ) : gate.estado === 'respondido' ? (
            <p className="mt-1 text-amber-300/80">à espera de execução pela frente</p>
          ) : null}
        </div>
      )}
      {erro && <p className="mt-2 text-xs text-rose-300">{erro}</p>}
    </div>
  )
}

function AbaGates({ dados, onResponder, ancora }) {
  const [projeto, setProjeto] = useState('')
  const [verHistorico, setVerHistorico] = useState(!!ancora)
  const gates = (dados?.gates || []).filter((g) => !projeto || g.projeto === projeto)
  const abertos = gates.filter((g) => g.estado === 'aberto')
  const historico = gates.filter((g) => g.estado !== 'aberto')
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Chip active={!projeto} onClick={() => setProjeto('')}>todos</Chip>
        {(dados?.projetos || []).map((p) => (
          <Chip key={p.id} active={projeto === p.id} onClick={() => setProjeto(p.id)}>{p.nome}</Chip>
        ))}
      </div>
      {abertos.length === 0 ? (
        <div className="rounded-2xl border border-white/6 bg-white/[0.02] px-4 py-6">
          <p className="text-center text-sm text-zinc-400">Nada à sua espera{projeto ? ' neste projeto' : ''}.</p>
          {historico.length > 0 && (
            <>
              <p className="mt-4 text-[11px] uppercase tracking-[0.28em] text-zinc-600">as suas últimas decisões</p>
              <ul className="mt-2 space-y-2">
                {historico.slice(0, 3).map((g) => (
                  <li key={g.id} className="text-[13px] leading-snug text-zinc-300">
                    <a href={`#gate-${g.id}`} className="font-mono text-[11px] text-zinc-500 hover:text-[#c9f28f]">{g.id}</a>
                    <span className="ml-2 font-semibold text-[#c9f28f]">{g.escolha}</span>
                    <span className="ml-2">{g.titulo}</span>
                    {g.executado_em
                      ? <span className="ml-2 text-[11px] text-sky-300">executado</span>
                      : <span className="ml-2 text-[11px] text-amber-300/70">por executar</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {abertos.map((g) => <GateCard key={g.id} gate={g} onResponder={onResponder} destacado={ancora === g.id} />)}
        </div>
      )}
      <div className="mt-8">
        <button onClick={() => setVerHistorico((v) => !v)} className="text-sm text-zinc-400 hover:text-white">
          {verHistorico ? '▾' : '▸'} Histórico · {historico.length} respondido{historico.length === 1 ? '' : 's'}/expirado{historico.length === 1 ? '' : 's'}
        </button>
        {verHistorico && (
          <div className="mt-3 space-y-3">
            {historico.map((g) => <GateCard key={g.id} gate={g} onResponder={onResponder} destacado={ancora === g.id} />)}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Frentes (placar) ─────────────────────────────────────────────────────

function AbaFrentes({ placar, dias, setDias }) {
  const [aberto, setAberto] = useState(null)
  const atual = placar?.atual || []
  const historico = placar?.historico || []
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-400">O que cada frente reportou no último ciclo.</p>
        <div className="flex gap-1">{[1, 7, 30].map((d) => <Chip key={d} active={dias === d} onClick={() => setDias(d)}>{d}d</Chip>)}</div>
      </div>
      {atual.length === 0 ? (
        <p className="rounded-2xl border border-white/6 bg-white/[0.02] px-4 py-6 text-center text-sm text-zinc-500">
          Nenhuma frente reportou ainda. Os orquestradores escrevem em POST /api/painel/placar ao fechar ciclo.
        </p>
      ) : (
        <div className="space-y-3">
          {atual.map((p) => {
            const anteriores = historico.filter((h) => h.projeto === p.projeto && h.id !== p.id)
            return (
              <div key={p.projeto} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-white">{p.frente || p.projeto}</h3>
                  {p.dono && <span className="text-xs text-zinc-500">{p.dono}</span>}
                  <span className="ml-auto text-[11px] text-zinc-600">{idade(p.medido_em)} · {fmtData(p.medido_em)}</span>
                </div>
                {p.estado && <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-300">{p.estado}</p>}
                {p.proximo && <p className="mt-2 text-[13px] text-zinc-400"><span className="text-zinc-500">próximo · </span>{p.proximo}</p>}
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-zinc-500">
                  {p.prazo && <span>prazo · {p.prazo}</span>}
                  {p.gate && <a href={`#gate-${String(p.gate).split(/[ ,·]/)[0]}`} className="text-sky-300 hover:underline">gate · {p.gate}</a>}
                  {p.fonte && <span>fonte · {p.fonte}</span>}
                </div>
                {anteriores.length > 0 && (
                  <div className="mt-2">
                    <button onClick={() => setAberto(aberto === p.projeto ? null : p.projeto)} className="text-xs text-zinc-500 hover:text-zinc-300">
                      {aberto === p.projeto ? '▾' : '▸'} {anteriores.length} ciclo{anteriores.length === 1 ? '' : 's'} anterior{anteriores.length === 1 ? '' : 'es'}
                    </button>
                    {aberto === p.projeto && (
                      <div className="mt-2 space-y-2 border-l border-white/10 pl-3">
                        {anteriores.map((h) => (
                          <div key={h.id} className="text-xs text-zinc-400">
                            <span className="text-zinc-600">{fmtData(h.medido_em)} · </span>{h.estado}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Contas ───────────────────────────────────────────────────────────────

// O gasto e as sessões ativas vêm de uma leitura diferente da do % do limite: aquela custa dinheiro e
// refresca devagar, esta é de graça e refresca a cada minuto. Mostrar as duas horas evita o erro de ler
// um número de há uma hora como se fosse de agora.
function BlocoAgora({ agora, fallbackUsd }) {
  if (!agora) {
    return <p className="mt-2 text-xs text-zinc-400">{fallbackUsd != null ? `US$ ${Math.round(fallbackUsd).toLocaleString('en-US')} medidos` : 'gasto não medido'}</p>
  }
  const parcial = agora.cobertura && agora.cobertura !== 'completa'
  return (
    <div className="mt-2">
      <p className="text-xs text-zinc-300">
        {agora.usd != null ? `US$ ${Math.round(agora.usd).toLocaleString('en-US')}` : '—'}
        {agora.ativas != null && <span className="text-zinc-500"> · {agora.ativas} {agora.ativas === 1 ? 'sessão ativa' : 'sessões ativas'}</span>}
      </p>
      <p className="text-[11px] text-zinc-600">
        gasto {idadeCurta(agora.ts)}
        {parcial && <span className="text-amber-500/80"> · só {agora.cobertura}</span>}
      </p>
    </div>
  )
}

function CartaoConta({ c }) {
  const pico = Math.max(c.pct_semana ?? -1, c.pct_fable ?? -1)
  const p = pico < 0 ? null : pico
  return (
    <div className={`rounded-2xl border px-4 py-3 ${bordaPct(p)}`}>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-white">{c.conta}</p>
        <p className="text-[11px] text-zinc-500">{c.nivel || ''}</p>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {[['semana', c.pct_semana], ['Fable', c.pct_fable], ['sessão', c.pct_sessao]].map(([r, v]) => (
          <div key={r}>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">{r}</p>
            <p className={`text-xl font-semibold ${corPct(v)}`}>{v == null ? '—' : `${v}%`}</p>
          </div>
        ))}
      </div>
      {c.pct_desconhecido != null && c.pct_semana == null && (
        <p className="mt-1 text-[11px] text-zinc-500">{c.pct_desconhecido}% no log (limite não identificado)</p>
      )}
      <BlocoAgora agora={c.agora} fallbackUsd={c.usd} />
      <p className="mt-1 text-[11px] text-zinc-600">% do limite: {idade(c.ts)} · fonte {c.fonte}</p>
    </div>
  )
}

function AbaContas({ serie, dias, setDias }) {
  const linhas = serie?.linhas || []
  const contas = serie?.contas || []
  const grafico = useMemo(() => {
    const porTs = new Map()
    for (const l of linhas) {
      const t = Math.round(new Date(l.ts).getTime() / 60000) * 60000
      const row = porTs.get(t) || { t }
      if (l.pct_semana != null) row[`${l.conta} semana`] = l.pct_semana
      if (l.pct_fable != null) row[`${l.conta} Fable`] = l.pct_fable
      if (l.pct_sessao != null) row[`${l.conta} sessão`] = l.pct_sessao
      porTs.set(t, row)
    }
    return [...porTs.values()].sort((a, b) => a.t - b.t)
  }, [linhas])
  const series = useMemo(() => {
    const out = []
    contas.forEach((c, i) => {
      out.push({ k: `${c} semana`, cor: CORES[i % CORES.length], dash: '' })
      out.push({ k: `${c} Fable`, cor: CORES[i % CORES.length], dash: '2 4' })
      out.push({ k: `${c} sessão`, cor: CORES[i % CORES.length], dash: '6 3' })
    })
    return out.filter((s) => grafico.some((r) => r[s.k] != null))
  }, [contas, grafico])
  const ultimas = [...linhas].reverse().slice(0, 40)

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(serie?.ultimas || []).map((c) => <CartaoConta key={c.conta} c={c} />)}
        {!(serie?.ultimas || []).length && <p className="text-sm text-zinc-500">Nenhuma leitura ainda. O tick do jarbas escreve aqui a cada 10 min.</p>}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">% do limite ao longo do tempo</h2>
        <div className="flex gap-1">
          {[1, 3, 7, 30].map((d) => <Chip key={d} active={dias === d} onClick={() => setDias(d)}>{d}d</Chip>)}
        </div>
      </div>
      <div className="mt-3 h-64 rounded-2xl border border-white/6 bg-white/[0.02] p-2">
        {grafico.length < 2 ? (
          <p className="px-2 py-6 text-center text-xs text-zinc-500">Menos de duas leituras com % na janela. Alargue a janela ou espere o próximo tick.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={grafico} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={CHART_TICK} tickLine={false} axisLine={false}
                tickFormatter={(t) => new Date(t).toLocaleString('pt-BR', dias > 1 ? { day: '2-digit', month: '2-digit' } : { hour: '2-digit', minute: '2-digit' })} />
              <YAxis domain={[0, 100]} tick={CHART_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => v + '%'} />
              <Tooltip contentStyle={CHART_TOOLTIP} labelFormatter={(t) => fmtData(t)} formatter={(v, n) => [`${v}%`, n]} />
              <ReferenceLine y={TETO} stroke="#f87171" strokeDasharray="4 4" label={{ value: `${TETO}%`, fill: '#f87171', fontSize: 10, position: 'right' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {series.map((s) => (
                <Line key={s.k} type="monotone" dataKey={s.k} stroke={s.cor} strokeDasharray={s.dash} dot={false} connectNulls strokeWidth={1.6} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <h2 className="mt-6 text-sm font-semibold text-white">Últimas leituras</h2>
      <div className="mt-2 overflow-x-auto rounded-2xl border border-white/6">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-zinc-500">
            <tr><th className="px-3 py-2 text-left">quando</th><th className="px-3 py-2 text-left">conta</th><th className="px-3 py-2 text-right">semana</th><th className="px-3 py-2 text-right">Fable</th><th className="px-3 py-2 text-right">sessão</th><th className="px-3 py-2 text-right">US$</th><th className="px-3 py-2 text-left">fonte</th></tr>
          </thead>
          <tbody>
            {ultimas.map((l) => (
              <tr key={l.id} className="border-t border-white/5 text-zinc-300">
                <td className="px-3 py-1.5 whitespace-nowrap">{fmtData(l.ts)}</td>
                <td className="px-3 py-1.5">{l.conta}</td>
                <td className={`px-3 py-1.5 text-right ${corPct(l.pct_semana)}`}>{l.pct_semana ?? (l.pct_desconhecido != null ? `${l.pct_desconhecido}?` : '—')}</td>
                <td className={`px-3 py-1.5 text-right ${corPct(l.pct_fable)}`}>{l.pct_fable ?? '—'}</td>
                <td className="px-3 py-1.5 text-right">{l.pct_sessao ?? '—'}</td>
                <td className="px-3 py-1.5 text-right">{l.usd != null ? Math.round(l.usd).toLocaleString('en-US') : '—'}</td>
                <td className="px-3 py-1.5 text-zinc-500">{l.fonte}</td>
              </tr>
            ))}
            {!ultimas.length && <tr><td colSpan={7} className="px-3 py-4 text-center text-zinc-500">sem leituras na janela</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-zinc-600">«semana» com «?» = % lida do log do tick, que não diz de que limite era. Nada aqui é estimado: o que não foi medido aparece como —.</p>
    </div>
  )
}

// ─── KPIs ─────────────────────────────────────────────────────────────────

function AbaKpis({ kpi, dias, setDias }) {
  const [frente, setFrente] = useState('')
  const itens = (kpi?.itens || []).filter((it) => !frente || it.frente === frente)
  const colunas = useMemo(() => {
    const presentes = new Set((kpi?.metricas || []).filter((m) => !ESCONDER.has(m)))
    const ordenadas = METRICAS.filter(([k]) => presentes.has(k))
    const extras = [...presentes].filter((k) => !METRICAS.some(([m]) => m === k)).map((k) => [k, k])
    return [...ordenadas, ...extras]
  }, [kpi])
  const totais = useMemo(() => {
    const t = {}
    for (const it of itens) for (const [k, v] of Object.entries(it.metrics || {})) {
      if (typeof v === 'number' && !ESCONDER.has(k) && !NAO_SOMAVEL.has(k)) t[k] = (t[k] || 0) + v
    }
    return t
  }, [itens])
  // as frentes que mais custam primeiro: as reais ficam à frente dos nomes de pasta que o mapa não conhece
  const frentesOrdenadas = useMemo(() => {
    const custo = {}
    for (const it of kpi?.itens || []) custo[it.frente] = (custo[it.frente] || 0) + (it.metrics?.custo_usd || 0)
    return [...(kpi?.frentes || [])].sort((a, b) => (custo[b] || 0) - (custo[a] || 0) || a.localeCompare(b))
  }, [kpi])
  const janelas = useMemo(() => [...new Set(itens.map((i) => i.metrics?.janela_dias).filter(Boolean))], [itens])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Chip active={!frente} onClick={() => setFrente('')}>todas</Chip>
        {frentesOrdenadas.map((f) => <Chip key={f} active={frente === f} onClick={() => setFrente(f)}>{f}</Chip>)}
        <div className="ml-auto flex gap-1">
          {[7, 14, 30].map((d) => <Chip key={d} active={dias === d} onClick={() => setDias(d)}>{d}d</Chip>)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {colunas.filter(([k]) => !NAO_SOMAVEL.has(k)).slice(0, 8).map(([k, rotulo, fmt]) => (
          <StatCard key={k} label={rotulo} value={totais[k] != null ? (fmt ? fmt(totais[k]) : totais[k]) : '—'} sub={`soma em ${dias}d`} />
        ))}
        {!colunas.length && <p className="col-span-2 text-sm text-zinc-500 sm:col-span-4">Nenhum KPI gravado na janela. Os coletores escrevem em POST /api/painel/kpi.</p>}
      </div>

      {/* telemóvel: um cartão por frente, ordenado por custo */}
      <div className="mt-6 space-y-2 sm:hidden">
        {itens.map((it) => (
          <div key={it.dia + it.frente} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-semibold text-white">{it.frente}</p>
              <p className="text-[11px] text-zinc-600">{it.dia.slice(5)}{it.metrics?.janela_dias > 1 ? ` · ${it.metrics.janela_dias}d` : ''}</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {NO_CARTAO.map((k) => {
                const def = METRICAS.find(([m]) => m === k)
                const v = it.metrics?.[k]
                if (v == null || !def) return null
                return (
                  <span key={k} className="text-xs text-zinc-300">
                    <span className="text-zinc-500">{def[1].replace(' US$', '').replace(' (pts)', '')} </span>
                    {def[2] ? def[2](v) : v}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
        {!itens.length && <p className="rounded-2xl border border-white/6 bg-white/[0.02] px-4 py-6 text-center text-sm text-zinc-500">Sem linhas na janela.</p>}
      </div>

      <div className="mt-6 hidden overflow-x-auto rounded-2xl border border-white/6 sm:block">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left">dia</th>
              <th className="px-3 py-2 text-left">frente</th>
              {colunas.map(([k, rotulo]) => <th key={k} className="px-3 py-2 text-right">{rotulo}</th>)}
            </tr>
          </thead>
          <tbody>
            {itens.map((it) => (
              <tr key={it.dia + it.frente} className="border-t border-white/5 text-zinc-300">
                <td className="px-3 py-1.5 whitespace-nowrap">{it.dia.slice(5)}{it.metrics?.janela_dias > 1 ? <span className="ml-1 text-[10px] text-zinc-600">{it.metrics.janela_dias}d</span> : null}</td>
                <td className="px-3 py-1.5">{it.frente}</td>
                {colunas.map(([k, , fmt]) => {
                  const v = it.metrics?.[k]
                  return (
                    <td key={k} className={`px-3 py-1.5 text-right ${v == null ? 'text-zinc-600' : ''}`} title={it.fontes?.[k] ? `fonte: ${it.fontes[k]}` : 'não medido'}>
                      {v == null ? 'não medido' : fmt ? fmt(v) : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
            {!itens.length && <tr><td colSpan={2 + colunas.length} className="px-3 py-4 text-center text-zinc-500">sem linhas na janela</td></tr>}
          </tbody>
        </table>
      </div>
      {(kpi?.conflitos || []).length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-200">
          {kpi.conflitos.length} métrica{kpi.conflitos.length === 1 ? '' : 's'} com duas fontes a discordar (fica a primeira, nada é sobrescrito em silêncio):
          {kpi.conflitos.slice(0, 4).map((c, i) => (
            <span key={i} className="block text-amber-200/80">{c.dia} · {c.frente} · {c.metrica}: {String(c.fica.valor)} ({c.fica.fonte}) vs {String(c.ignorado.valor)} ({c.ignorado.fonte})</span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-zinc-600">
        Passe o rato numa célula para ver a fonte. «não medido» é ausência de coletor, nunca zero.
        «(painel)» conta os gates desta base; «(canal)» é o que o coletor mediu no WhatsApp e na fila em disco.
        Rácios e medianas (valor/custo, retrabalho, % do limite, mediana) não têm cartão de total: somá-los não diria nada.
        {janelas.length > 0 && ` Linhas marcadas com «${janelas.join('d, ')}d» são agregados dessa janela, não de um dia.`}
      </p>
    </div>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────

export default function Painel() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'gates'
  const [resumo, setResumo] = useState(null)
  const [gates, setGates] = useState(null)
  const [serie, setSerie] = useState(null)
  const [kpi, setKpi] = useState(null)
  const [placar, setPlacar] = useState(null)
  const [diasSerie, setDiasSerie] = useState(7)
  const [diasKpi, setDiasKpi] = useState(14)
  const [diasPlacar, setDiasPlacar] = useState(7)
  const [erro, setErro] = useState(null)
  const [atualizado, setAtualizado] = useState(null)
  // âncora #gate-<id>: o link que a regência manda pelo WhatsApp abre o cartão certo
  const [ancora] = useState(() => (typeof window !== 'undefined' && window.location.hash.startsWith('#gate-')
    ? decodeURIComponent(window.location.hash.slice(6)) : null))
  const jaRolou = useRef(false)

  const carregar = useCallback(async () => {
    try {
      const [r, g] = await Promise.all([getPainelResumo(), getPainelGates()])
      setResumo(r)
      setGates(g)
      if (tab === 'contas') setSerie(await getPainelSerie({ dias: diasSerie }))
      if (tab === 'kpis') setKpi(await getPainelKpi({ dias: diasKpi }))
      if (tab === 'frentes') setPlacar(await getPainelPlacar({ dias: diasPlacar }))
      setErro(null)
      setAtualizado(new Date())
    } catch (e) {
      setErro(e.message || 'falha ao carregar')
    }
  }, [tab, diasSerie, diasKpi, diasPlacar])

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, POLL_MS)
    return () => clearInterval(t)
  }, [carregar])

  // o consumo tem ritmo próprio: só o resumo (que traz as contas) volta a buscar de 15 em 15 s
  useEffect(() => {
    const t = setInterval(async () => {
      try { setResumo(await getPainelResumo()); setAtualizado(new Date()) } catch { /* o poll grande reporta */ }
    }, POLL_AGORA_MS)
    return () => clearInterval(t)
  }, [])

  // rola até o gate da âncora depois de ele existir no DOM (uma vez só, para o poll não roubar o ecrã)
  useEffect(() => {
    if (!ancora || jaRolou.current || !gates) return
    const el = document.getElementById(`gate-${ancora}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      jaRolou.current = true
    }
  }, [ancora, gates])

  async function responder(gate, { escolha, nota }) {
    await responderPainelGate(gate.id, { escolha, nota })
    await carregar()
  }

  const contas = resumo?.contas || []
  return (
    <div className="mx-auto max-w-5xl px-1 py-4 sm:px-4 sm:py-6">
      <header className="mb-5">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold text-white">Painel de Regência</h1>
          <p className="text-[11px] text-zinc-600">{atualizado ? `atualizado ${atualizado.toLocaleTimeString('pt-BR')}` : 'carregando…'}</p>
        </div>
        <p className="mt-1 text-sm text-zinc-400">Gates à sua espera, o estado de cada frente, as duas contas ao longo do tempo e o que se entrega por dia.</p>
      </header>

      {erro && <p className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{erro}</p>}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Aguardando você" value={resumo?.gates?.abertos ?? '—'} alert={(resumo?.gates?.abertos || 0) > 0} sub={resumo ? `${resumo.gates.urgentes} urgente${resumo.gates.urgentes === 1 ? '' : 's'}` : ''} />
        <StatCard label="Respondidos hoje" value={resumo?.gates?.respondidos_hoje ?? '—'} sub={resumo ? `${resumo.gates.a_executar ?? 0} por executar · ${resumo.gates.expirados} expirados` : ''} />
        {contas.slice(0, 2).map((c) => {
          const p = c.pct_semana ?? c.pct_desconhecido
          const ag = c.agora
          return <StatCard key={c.conta} label={`Conta ${c.conta}`} value={p == null ? '—' : `${p}%`} alert={p != null && p >= TETO - 15}
            sub={ag ? `US$ ${Math.round(ag.usd || 0).toLocaleString('en-US')} · ${ag.ativas ?? 0} ativas · ${idadeCurta(ag.ts)}` : `${c.pct_fable != null ? `Fable ${c.pct_fable}% · ` : ''}${idade(c.ts)}`} />
        })}
        {contas.length === 0 && <StatCard label="Contas" value="—" sub="sem leitura" />}
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-white/6">
        {TABS.map(([id, rotulo]) => (
          <button
            key={id}
            onClick={() => setParams({ tab: id })}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-[#8bd450] text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
          >
            {rotulo}
            {id === 'gates' && resumo?.gates?.abertos > 0 && <span className="ml-1.5 rounded-full bg-[#8bd450]/20 px-1.5 text-[10px] text-[#c9f28f]">{resumo.gates.abertos}</span>}
          </button>
        ))}
      </div>

      {tab === 'gates' && <AbaGates dados={gates} onResponder={responder} ancora={ancora} />}
      {tab === 'frentes' && <AbaFrentes placar={placar} dias={diasPlacar} setDias={setDiasPlacar} />}
      {tab === 'contas' && <AbaContas serie={serie} dias={diasSerie} setDias={setDiasSerie} />}
      {tab === 'kpis' && <AbaKpis kpi={kpi} dias={diasKpi} setDias={setDiasKpi} />}
    </div>
  )
}
