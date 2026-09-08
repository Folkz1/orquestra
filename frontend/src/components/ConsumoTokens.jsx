import { useState, useEffect } from 'react'
import { getTasks } from '../api'

// Consumo das duas contas Claude, ao vivo.
//
// Quem escreve o numero e o telemetria-tick (cerebro/coletores), que corre no hook Stop
// de qualquer sessao e guarda UM documento em /api/tasks com kind=telemetria_tokens.
// Esta tela so le. A escolha de viver aqui, e nao na Mesa de Gates, e o motivo de isto
// funcionar sozinho: a Mesa e uma pagina do Claude e so uma sessao Claude escreve nela.
const KIND = 'telemetria_tokens'
const INTERVALO_MS = 20000

const usd = (v) => '$' + Math.round(Number(v) || 0).toLocaleString('pt-BR')

// Uma leitura velha e pior do que nenhuma quando ninguem ve que e velha.
function idade(iso) {
  if (!iso) return null
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (!isFinite(min) || min < 0) return null
  if (min < 1) return 'agora'
  if (min < 60) return 'ha ' + min + ' min'
  const h = Math.floor(min / 60)
  return 'ha ' + h + 'h' + String(min % 60).padStart(2, '0')
}

function Conta({ c, regua, teto }) {
  const lim = (c.limites || []).find((l) => l.kind !== 'session')
  const pct = lim ? lim.percent : c.estimado
  const medido = !!lim
  const cor = pct >= teto ? 'bg-red-500' : pct >= teto * 0.8 ? 'bg-amber-500' : 'bg-emerald-500'
  const nivel = c.nivel === 'NORMAL'
    ? 'text-emerald-400 bg-emerald-500/10'
    : c.nivel === 'ATENÇÃO' ? 'text-amber-400 bg-amber-500/10' : 'text-red-400 bg-red-500/10'
  const livre = pct == null ? null : Math.max(0, teto - pct)

  return (
    <div className="flex-1 min-w-[260px]">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-sm font-semibold text-zinc-100">{c.nome}</span>
        <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded ' + nivel}>{c.nivel}</span>
        {c.ativas > 0 && (
          <span className="text-[11px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
            {c.ativas} {c.ativas === 1 ? 'sessão ativa' : 'sessões ativas'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <div className="relative flex-1 h-2.5 rounded-full bg-zinc-800 overflow-hidden">
          <div className={'h-full ' + cor} style={{ width: Math.min(100, Math.max(0, pct || 0)) + '%' }} />
          {/* a marca do teto da casa: e nele que se para, nao nos 100% */}
          <div className="absolute inset-y-0 w-px bg-zinc-500" style={{ left: teto + '%' }} />
        </div>
        <span className="text-sm font-semibold text-zinc-100 tabular-nums w-12 text-right">
          {pct == null ? '?' : (pct < 1 ? '<1' : Math.round(pct)) + '%'}
        </span>
      </div>

      <div className="text-[11px] text-zinc-500 mt-1 tabular-nums">
        {usd(c.usd)} · {(c.respostas || 0).toLocaleString('pt-BR')} respostas · {c.sessoes} sessões
        {livre != null && regua ? ' · restam ~' + usd(livre * regua) + ' até ' + teto + '%' : ''}
      </div>
      {!medido && (
        // Dizer que o numero e estimado importa mais do que o numero: foi um estimado
        // lido como medido que fez a conta do Eduardo parecer 12x menor do que era.
        <div className="text-[11px] text-amber-500/80 mt-0.5">
          estimado pela régua — abra o app nesta conta e rode /usage para o exato
        </div>
      )}
    </div>
  )
}

export default function ConsumoTokens() {
  const [t, setT] = useState(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let vivo = true
    const carregar = async () => {
      try {
        const r = await getTasks({ kind: KIND, limit: 1 })
        const doc = Array.isArray(r) ? r[0] : null
        if (!vivo) return
        setT(doc ? doc.metadata_json || null : null)
        setErro(false)
      } catch (e) {
        if (vivo) setErro(true)
      }
    }
    carregar()
    const id = setInterval(carregar, INTERVALO_MS)
    return () => { vivo = false; clearInterval(id) }
  }, [])

  if (erro || !t || !Array.isArray(t.contas) || !t.contas.length) {
    return (
      <div className="mb-5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Consumo de tokens</div>
        <div className="text-xs text-zinc-500">
          {erro ? 'Não foi possível ler agora — tenta de novo em 20 s.'
                : 'Ainda sem leitura. Ela chega sozinha no fim do próximo turno de qualquer sessão.'}
        </div>
      </div>
    )
  }

  const frentes = (t.frentes || []).slice(0, 5)
  const maior = frentes.length ? frentes[0].usd || 1 : 1
  const quando = idade(t.colhidoEm || t.gerado)

  // Duas maquinas medem: o PC do Diego (que ve as suas sessoes e as do servidor por ssh)
  // e o proprio servidor (que so ve as dele). A leitura completa e a do PC. Quando ele
  // desliga, a do servidor toma conta -- e o total CAI, porque cobre menos, nao porque
  // se gastou menos. Sem esta etiqueta, essa queda parece boa noticia.
  const origens = Object.keys(t.origens || {})
  const temServidor = origens.some((o) => /^jarbas:/.test(o))
  const temPc = origens.some((o) => !/^jarbas:/.test(o))
  const cobertura = !temServidor ? 'sem o servidor' : !temPc ? 'só o servidor (PC desligado)' : null

  return (
    <div className="mb-5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500">
          Consumo de tokens · desde o reset
        </div>
        <div className="text-[11px] text-zinc-600 tabular-nums">
          {usd(t.total && t.total.usd)} no total
          {quando ? ' · medido ' + quando : ''}
          {cobertura && <span className="text-amber-500/80"> · {cobertura}</span>}
        </div>
      </div>

      <div className="flex gap-6 flex-wrap">
        {t.contas.map((c) => (
          <Conta key={c.nome} c={c} regua={t.regua} teto={c.teto || 80} />
        ))}

        {frentes.length > 0 && (
          <div className="flex-1 min-w-[200px]">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">Onde gastou</div>
            {frentes.map((f) => (
              <div key={f.nome} className="flex items-center gap-2 mb-1">
                <span className="text-xs text-zinc-400 w-20 truncate">{f.nome}</span>
                <span className="text-xs text-zinc-300 tabular-nums w-14 text-right">{usd(f.usd)}</span>
                <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-blue-500/70" style={{ width: Math.max(3, (f.usd / maior) * 100) + '%' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
