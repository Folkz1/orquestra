import { useEffect, useState } from 'react'
import {
  generateDeliveryReport,
  getDeliveryReport,
  updateDeliveryReport,
} from '../api'
import { formatCurrency, formatRelativeDate, parseMoney } from '../lib/formatters'

const CATEGORY_META = {
  core: { label: 'OK', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20' },
  upgrade: { label: 'UP', className: 'bg-sky-500/15 text-sky-300 border-sky-500/20' },
  extra: { label: 'EXTRA', className: 'bg-amber-500/15 text-amber-200 border-amber-500/20' },
}

const STATUS_META = {
  draft: 'bg-zinc-700 text-zinc-200',
  final: 'bg-emerald-500/20 text-emerald-300',
  sent_to_client: 'bg-sky-500/20 text-sky-300',
}

function JsonEditor({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs uppercase tracking-[0.24em] text-zinc-500">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[160px] w-full rounded-2xl border border-white/8 bg-black/20 px-3 py-3 font-mono text-xs text-zinc-200 focus:border-[color:var(--accent)] focus:outline-none"
      />
    </label>
  )
}

function ScopeList({ items, emptyLabel, proposedColumn = false }) {
  if (!items?.length) {
    return <p className="text-sm text-zinc-500">{emptyLabel}</p>
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const meta = CATEGORY_META[item.category] || CATEGORY_META.core

        return (
          <div key={`${item.item || 'item'}-${index}`} className="rounded-2xl border border-white/6 bg-black/20 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">{item.item || `Item ${index + 1}`}</p>
                {item.description && <p className="mt-1 text-sm text-zinc-400">{item.description}</p>}
              </div>
              {!proposedColumn && (
                <span className={`rounded-full border px-2 py-1 text-[11px] font-medium ${meta.className}`}>
                  {meta.label}
                </span>
              )}
            </div>
            {!proposedColumn && item.in_proposal === false && (
              <p className="mt-2 text-xs text-amber-200">Nao constava no escopo original.</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ExtraList({ extras }) {
  if (!extras?.length) {
    return <p className="text-sm text-zinc-500">Nenhum extra identificado.</p>
  }

  return (
    <div className="space-y-2">
      {extras.map((extra, index) => (
        <div key={`${extra.item || 'extra'}-${index}`} className="rounded-2xl border border-amber-500/15 bg-amber-500/8 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-white">{extra.item || `Extra ${index + 1}`}</p>
            <span className="text-xs text-amber-200">{extra.value || 'Valor a confirmar'}</span>
          </div>
          {(extra.description || extra.date) && (
            <p className="mt-1 text-sm text-zinc-300">
              {extra.description || 'Sem detalhe complementar.'}
              {extra.date ? ` · ${extra.date}` : ''}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function buildEditorState(report) {
  return {
    proposed_scope: JSON.stringify(report?.proposed_scope || [], null, 2),
    delivered_scope: JSON.stringify(report?.delivered_scope || [], null, 2),
    extras: JSON.stringify(report?.extras || [], null, 2),
    financial_summary: JSON.stringify(report?.financial_summary || {}, null, 2),
    comparison_analysis: report?.comparison_analysis || '',
  }
}

export default function DeliveryReportPanel({ proposal }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState(false)
  const [editor, setEditor] = useState(buildEditorState(null))
  const [error, setError] = useState('')

  const eligible = proposal.status === 'accepted' || proposal.status === 'viewed'

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = await getDeliveryReport(proposal.id)
        if (!active) return
        setReport(data)
        setEditor(buildEditorState(data))
      } catch (loadError) {
        if (!active) return
        if (loadError.status !== 404) {
          setError(loadError.data?.detail || loadError.message || 'Falha ao carregar delivery report.')
        }
        setReport(null)
        setEditor(buildEditorState(null))
      } finally {
        if (active) setLoading(false)
      }
    }

    load()

    return () => {
      active = false
    }
  }, [proposal.id])

  async function handleGenerate() {
    setBusy('generate')
    setError('')
    try {
      const data = await generateDeliveryReport(proposal.id)
      setReport(data)
      setEditor(buildEditorState(data))
      setEditing(false)
    } catch (generateError) {
      setError(generateError.data?.detail || generateError.message || 'Falha ao gerar report.')
    } finally {
      setBusy('')
    }
  }

  async function handleSave(partial = {}) {
    if (!report) return

    setBusy(partial.send_to_client ? 'send' : 'save')
    setError('')
    try {
      const payload = {
        proposed_scope: JSON.parse(editor.proposed_scope),
        delivered_scope: JSON.parse(editor.delivered_scope),
        extras: JSON.parse(editor.extras),
        financial_summary: JSON.parse(editor.financial_summary),
        comparison_analysis: editor.comparison_analysis,
        ...partial,
      }
      const data = await updateDeliveryReport(report.id, payload)
      setReport(data)
      setEditor(buildEditorState(data))
      setEditing(false)
    } catch (saveError) {
      setError(saveError.data?.detail || saveError.message || 'Falha ao salvar report.')
    } finally {
      setBusy('')
    }
  }

  const finance = report?.financial_summary || {}

  return (
    <div className="space-y-4 rounded-[28px] border border-white/8 bg-zinc-950/90 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow">Entrega vs Proposta</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Relatorio de Entrega</h3>
          <p className="mt-1 text-sm text-zinc-400">
            {proposal.title} · {proposal.client_name}
            {proposal.total_value ? ` · ${proposal.total_value}` : ''}
          </p>
          {report && (
            <p className="mt-2 text-xs text-zinc-500">
              Gerado {formatRelativeDate(report.generated_at)} · status{' '}
              <span className={`rounded-full px-2 py-1 ${STATUS_META[report.status] || STATUS_META.draft}`}>
                {report.status}
              </span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {eligible && (
            <button type="button" onClick={handleGenerate} disabled={busy !== ''} className="btn-secondary">
              {busy === 'generate' ? 'Gerando...' : report ? 'Regenerar' : 'Gerar Relatorio'}
            </button>
          )}
          {report && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="btn-secondary">
              Editar
            </button>
          )}
          {report && editing && (
            <button
              type="button"
              onClick={() => {
                setEditor(buildEditorState(report))
                setEditing(false)
              }}
              className="btn-secondary"
            >
              Cancelar
            </button>
          )}
          {report && (
            <button type="button" onClick={() => handleSave({ status: 'final' })} disabled={busy !== ''} className="btn-secondary">
              {busy === 'save' ? 'Salvando...' : 'Finalizar'}
            </button>
          )}
          {report && (
            <button
              type="button"
              onClick={() => handleSave({ status: 'sent_to_client', send_to_client: true })}
              disabled={busy !== ''}
              className="btn-primary"
            >
              {busy === 'send' ? 'Enviando...' : 'Enviar pro cliente'}
            </button>
          )}
        </div>
      </div>

      {!eligible && !report && (
        <div className="rounded-2xl border border-amber-500/15 bg-amber-500/8 px-4 py-3 text-sm text-amber-100">
          Esse relatorio so pode ser gerado para propostas com status `viewed` ou `accepted`.
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-500/15 bg-red-500/8 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-zinc-500">Carregando report...</div>
      ) : !report ? (
        <div className="rounded-2xl border border-white/6 bg-black/20 px-4 py-5 text-sm text-zinc-500">
          Nenhum delivery report gerado para esta proposta ainda.
        </div>
      ) : editing ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <JsonEditor label="Proposta" value={editor.proposed_scope} onChange={(value) => setEditor((current) => ({ ...current, proposed_scope: value }))} />
          <JsonEditor label="Entrega real" value={editor.delivered_scope} onChange={(value) => setEditor((current) => ({ ...current, delivered_scope: value }))} />
          <JsonEditor label="Extras" value={editor.extras} onChange={(value) => setEditor((current) => ({ ...current, extras: value }))} />
          <JsonEditor label="Financeiro" value={editor.financial_summary} onChange={(value) => setEditor((current) => ({ ...current, financial_summary: value }))} />
          <div className="lg:col-span-2">
            <label className="block">
              <span className="mb-1.5 block text-xs uppercase tracking-[0.24em] text-zinc-500">Analise comparativa</span>
              <textarea
                value={editor.comparison_analysis}
                onChange={(event) => setEditor((current) => ({ ...current, comparison_analysis: event.target.value }))}
                className="min-h-[140px] w-full rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-sm text-zinc-200 focus:border-[color:var(--accent)] focus:outline-none"
              />
            </label>
          </div>
          <div className="lg:col-span-2 flex justify-end">
            <button type="button" onClick={() => handleSave()} disabled={busy !== ''} className="btn-primary">
              {busy === 'save' ? 'Salvando...' : 'Salvar ajustes'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Proposta</p>
              <ScopeList items={report.proposed_scope} emptyLabel="Nenhum item de escopo extraido da proposta." proposedColumn />
            </div>
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Entrega real</p>
              <ScopeList items={report.delivered_scope} emptyLabel="Nenhum item entregue identificado." />
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs uppercase tracking-[0.28em] text-zinc-500">Extras</p>
            <ExtraList extras={report.extras} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Analise</p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
                {report.comparison_analysis || 'Sem analise textual complementar.'}
              </p>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Financeiro</p>
              <div className="mt-4 space-y-2 text-sm text-zinc-300">
                <div className="flex items-center justify-between"><span>Proposta</span><strong className="text-white">{formatCurrency(parseMoney(finance.proposed))}</strong></div>
                <div className="flex items-center justify-between"><span>Extras</span><strong className="text-white">{formatCurrency(parseMoney(finance.extras_total))}</strong></div>
                <div className="flex items-center justify-between"><span>Total</span><strong className="text-white">{formatCurrency(parseMoney(finance.total))}</strong></div>
                <div className="flex items-center justify-between"><span>Pago</span><strong className="text-emerald-300">{formatCurrency(parseMoney(finance.paid))}</strong></div>
                <div className="flex items-center justify-between"><span>Pendente</span><strong className="text-amber-200">{formatCurrency(parseMoney(finance.pending))}</strong></div>
              </div>

              {(finance.payments || []).length > 0 && (
                <div className="mt-4 border-t border-white/8 pt-4">
                  <p className="mb-2 text-xs uppercase tracking-[0.24em] text-zinc-500">Pagamentos</p>
                  <div className="space-y-2 text-xs text-zinc-400">
                    {finance.payments.map((payment, index) => (
                      <div key={`${payment.date || 'payment'}-${index}`} className="flex items-center justify-between gap-3">
                        <span>{payment.method || 'Pagamento'}{payment.date ? ` · ${payment.date}` : ''}</span>
                        <span className="text-white">{formatCurrency(parseMoney(payment.value))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
