import { useEffect, useState } from 'react'
import {
  decideAutoResearchTask,
  getAutoResearchTasks,
  updateTask,
} from '../api'

const DECISION_META = {
  pending: { label: 'Pendente', badge: 'bg-zinc-800 text-zinc-200 border-zinc-700' },
  approved: { label: 'Aprovado', badge: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30' },
  rejected: { label: 'Rejeitado', badge: 'bg-rose-500/15 text-rose-200 border-rose-500/30' },
  needs_client_confirmation: { label: 'Confirmar com cliente', badge: 'bg-amber-500/15 text-amber-200 border-amber-500/30' },
}

const APPLY_META = {
  pending: { label: 'Aguardando apply', tone: 'text-zinc-400' },
  queued: { label: 'Na fila da 21h', tone: 'text-sky-300' },
  applied: { label: 'Aplicado', tone: 'text-emerald-300' },
  apply_failed: { label: 'Falhou ao aplicar', tone: 'text-rose-300' },
  cancelled: { label: 'Cancelado', tone: 'text-zinc-500' },
}

function formatDate(value) {
  if (!value) return 'sem data'
  try {
    return new Date(value).toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return value
  }
}

function normalizeChecklist(items = []) {
  return items.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `item-${index}`, label: item, done: false }
    }
    return {
      id: item.id || `item-${index}`,
      label: item.label || item.text || `Item ${index + 1}`,
      done: Boolean(item.done),
    }
  })
}

function buildChangePreview(change) {
  const beforeLines = (change.before_content || '').split('\n')
  const afterLines = (change.after_content || '').split('\n')
  let prefix = 0

  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1
  }

  let beforeIndex = beforeLines.length - 1
  let afterIndex = afterLines.length - 1
  while (
    beforeIndex >= prefix &&
    afterIndex >= prefix &&
    beforeLines[beforeIndex] === afterLines[afterIndex]
  ) {
    beforeIndex -= 1
    afterIndex -= 1
  }

  return {
    header: `@@ linha ${prefix + 1} @@`,
    removed: beforeLines.slice(prefix, beforeIndex + 1),
    added: afterLines.slice(prefix, afterIndex + 1),
    unchangedPrefix: prefix,
    unchangedSuffix: Math.max(0, beforeLines.length - beforeIndex - 1),
  }
}

function StatCard({ label, value, footnote }) {
  return (
    <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{footnote}</p>
    </div>
  )
}

function ChecklistBlock({ title, items, onToggle, disabled }) {
  if (!items.length) return null
  return (
    <div className="rounded-2xl border border-white/6 bg-black/25 p-4">
      <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{title}</p>
      <div className="mt-3 space-y-2">
        {items.map((item, index) => (
          <label
            key={item.id}
            className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/6 bg-white/[0.02] px-3 py-2.5"
          >
            <input
              type="checkbox"
              checked={item.done}
              disabled={disabled}
              onChange={(event) => onToggle(index, event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-400"
            />
            <span className={`text-sm ${item.done ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
              {item.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

function FilePreview({ change }) {
  const preview = buildChangePreview(change)
  const changeType = change.change_type || 'update'

  return (
    <div className="rounded-2xl border border-white/6 bg-zinc-950/80">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/6 px-4 py-3">
        <div>
          <p className="font-mono text-xs text-zinc-300">{change.path}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
            {changeType} · {change.before_content?.split('\n').length || 0} → {change.after_content?.split('\n').length || 0} linhas
          </p>
        </div>
        <span className="rounded-full border border-white/8 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
          {preview.header}
        </span>
      </div>

      <div className="space-y-4 p-4">
        {preview.removed.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.24em] text-rose-300">Antes</p>
            <pre className="overflow-x-auto rounded-2xl border border-rose-500/20 bg-rose-500/8 p-3 font-mono text-xs leading-6 text-rose-100">
{preview.removed.map((line) => `- ${line}`).join('\n') || '-'}
            </pre>
          </div>
        )}

        {preview.added.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.24em] text-emerald-300">Depois</p>
            <pre className="overflow-x-auto rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-3 font-mono text-xs leading-6 text-emerald-100">
{preview.added.map((line) => `+ ${line}`).join('\n') || '+'}
            </pre>
          </div>
        )}

        <details className="rounded-2xl border border-white/6 bg-black/30 p-3">
          <summary className="cursor-pointer text-xs uppercase tracking-[0.24em] text-zinc-500">
            Ver arquivo completo
          </summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <pre className="overflow-x-auto rounded-2xl border border-white/6 bg-black/40 p-3 font-mono text-[11px] leading-6 text-zinc-400">
{change.before_content || '(arquivo novo)'}
            </pre>
            <pre className="overflow-x-auto rounded-2xl border border-white/6 bg-black/40 p-3 font-mono text-[11px] leading-6 text-zinc-100">
{change.after_content || '(arquivo removido)'}
            </pre>
          </div>
        </details>
      </div>
    </div>
  )
}

export default function AutoResearchApprovals() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [decisionFilter, setDecisionFilter] = useState('all')
  const [targetFilter, setTargetFilter] = useState('all')
  const [showClientOnly, setShowClientOnly] = useState(false)
  const [note, setNote] = useState('')

  async function loadTasks() {
    try {
      setLoading(true)
      setError('')
      const data = await getAutoResearchTasks()
      setTasks(Array.isArray(data) ? data : [])
      if (!selectedId && data?.[0]?.id) {
        setSelectedId(data[0].id)
      } else if (selectedId && !data?.some((item) => item.id === selectedId)) {
        setSelectedId(data?.[0]?.id || null)
      }
    } catch (err) {
      console.error('[AutoResearchApprovals] Load failed:', err)
      setError('Nao consegui carregar a fila de aprovacoes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTasks()
  }, [])

  const selectedTask = tasks.find((task) => task.id === selectedId) || null
  const selectedMeta = selectedTask?.metadata_json || {}
  const targetOptions = Array.from(
    new Set(tasks.map((task) => task.metadata_json?.target).filter(Boolean)),
  ).sort()

  const filteredTasks = tasks.filter((task) => {
    const meta = task.metadata_json || {}
    if (decisionFilter !== 'all' && (meta.decision_status || 'pending') !== decisionFilter) return false
    if (targetFilter !== 'all' && meta.target !== targetFilter) return false
    if (showClientOnly && !meta.client_confirmation_required) return false
    return true
  })

  const stats = {
    pending: tasks.filter((task) => (task.metadata_json?.decision_status || 'pending') === 'pending').length,
    client: tasks.filter((task) => task.metadata_json?.decision_status === 'needs_client_confirmation').length,
    queued: tasks.filter((task) => task.metadata_json?.apply_status === 'queued').length,
    failed: tasks.filter((task) => task.metadata_json?.apply_status === 'apply_failed').length,
  }

  useEffect(() => {
    setNote(selectedMeta.decision_note || '')
  }, [selectedId, selectedMeta.decision_note])

  async function patchChecklist(field, index, checked) {
    if (!selectedTask) return

    const items = normalizeChecklist(selectedMeta[field])
    const nextItems = items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, done: checked } : item
    ))

    try {
      setSaving(true)
      const updated = await updateTask(selectedTask.id, {
        metadata_json: {
          ...selectedMeta,
          [field]: nextItems,
        },
      })
      setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)))
    } catch (err) {
      console.error('[AutoResearchApprovals] Checklist save failed:', err)
      setError('Nao consegui salvar o checklist.')
    } finally {
      setSaving(false)
    }
  }

  async function patchClientConfirmation(status) {
    if (!selectedTask) return

    try {
      setSaving(true)
      const updated = await updateTask(selectedTask.id, {
        metadata_json: {
          ...selectedMeta,
          client_confirmation_status: status,
        },
      })
      setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)))
    } catch (err) {
      console.error('[AutoResearchApprovals] Client confirmation update failed:', err)
      setError('Nao consegui atualizar a confirmacao com o cliente.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDecision(decision, overrides = {}) {
    if (!selectedTask) return

    try {
      setSaving(true)
      setError('')
      const updated = await decideAutoResearchTask(selectedTask.id, {
        decision,
        note,
        approval_checklist: normalizeChecklist(selectedMeta.approval_checklist),
        client_checklist: normalizeChecklist(selectedMeta.client_checklist),
        client_confirmation_status: overrides.client_confirmation_status,
      })
      setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)))
    } catch (err) {
      console.error('[AutoResearchApprovals] Decision failed:', err)
      setError('Nao consegui registrar a decisao.')
    } finally {
      setSaving(false)
    }
  }

  const approvalChecklist = normalizeChecklist(selectedMeta.approval_checklist)
  const clientChecklist = normalizeChecklist(selectedMeta.client_checklist)
  const fileChanges = Array.isArray(selectedMeta.file_changes) ? selectedMeta.file_changes : []
  const decisionState = selectedMeta.decision_status || 'pending'
  const applyState = selectedMeta.apply_status || 'pending'
  const clientConfirmed = selectedMeta.client_confirmation_status === 'confirmed'
  const clientRequired = Boolean(selectedMeta.client_confirmation_required)
  const decisionInfo = DECISION_META[decisionState] || DECISION_META.pending
  const applyInfo = APPLY_META[applyState] || APPLY_META.pending
  const approveDisabled = saving || (clientRequired && !clientConfirmed)

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),transparent_35%),linear-gradient(135deg,rgba(24,24,27,0.96),rgba(9,9,11,0.96))]">
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr),360px] lg:px-8">
          <div>
            <p className="eyebrow">AutoResearch approval lane</p>
            <h1 className="mt-3 text-3xl font-semibold text-white">Diffs, sugestoes e checklist num lugar so</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-300">
              O research continua proativo, mas a mudanca so entra quando voce aprova. O apply roda primeiro na fila aprovada e depois segue para o ciclo das 21h.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Pendentes" value={stats.pending} footnote="Sugestoes aguardando teu ok" />
            <StatCard label="Cliente" value={stats.client} footnote="Itens que pedem validacao externa" />
            <StatCard label="Fila 21h" value={stats.queued} footnote="Ja aprovados para aplicar" />
            <StatCard label="Falhas" value={stats.failed} footnote="Diffs que bateram em conflito ou drift" />
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-[340px,minmax(0,1fr)]">
        <div className="rounded-[28px] border border-white/8 bg-zinc-950/85 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Fila</p>
              <h2 className="mt-2 text-lg font-semibold text-white">Sugestoes abertas</h2>
            </div>
            <button type="button" onClick={loadTasks} className="btn-secondary" disabled={loading}>
              Atualizar
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <select
              value={decisionFilter}
              onChange={(event) => setDecisionFilter(event.target.value)}
              className="w-full rounded-2xl border border-white/8 bg-black/30 px-3 py-2.5 text-sm text-zinc-100 outline-none"
            >
              <option value="all">Todas as decisoes</option>
              <option value="pending">Pendentes</option>
              <option value="needs_client_confirmation">Confirmar com cliente</option>
              <option value="approved">Aprovadas</option>
              <option value="rejected">Rejeitadas</option>
            </select>

            <select
              value={targetFilter}
              onChange={(event) => setTargetFilter(event.target.value)}
              className="w-full rounded-2xl border border-white/8 bg-black/30 px-3 py-2.5 text-sm text-zinc-100 outline-none"
            >
              <option value="all">Todos os targets</option>
              {targetOptions.map((target) => (
                <option key={target} value={target}>
                  {target}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={showClientOnly}
                onChange={(event) => setShowClientOnly(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-amber-400"
              />
              Mostrar apenas itens com cliente
            </label>
          </div>

          <div className="mt-4 space-y-3">
            {loading && <p className="text-sm text-zinc-500">Carregando aprovacoes...</p>}

            {!loading && filteredTasks.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-5 text-sm text-zinc-500">
                Nenhuma sugestao aberta com os filtros atuais.
              </div>
            )}

            {filteredTasks.map((task) => {
              const meta = task.metadata_json || {}
              const decision = DECISION_META[meta.decision_status || 'pending'] || DECISION_META.pending
              const active = task.id === selectedId
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedId(task.id)}
                  className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                    active
                      ? 'border-amber-400/40 bg-amber-500/10 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]'
                      : 'border-white/8 bg-white/[0.03] hover:border-white/14 hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-sky-200">
                      {meta.target || 'geral'}
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${decision.badge}`}>
                      {decision.label}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-medium text-zinc-100">{task.title}</p>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-400">
                    {meta.summary || task.description || 'Sem resumo curto gerado.'}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    <span>{Array.isArray(meta.file_changes) ? meta.file_changes.length : 0} arquivo(s)</span>
                    {meta.client_confirmation_required && <span>cliente</span>}
                    <span>{formatDate(task.created_at)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-[28px] border border-white/8 bg-zinc-950/85 p-5">
          {!selectedTask && (
            <div className="flex h-full min-h-[420px] items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-black/20 px-6 text-center text-sm text-zinc-500">
              Escolhe uma sugestao na coluna da esquerda para revisar o diff, checklist e decisao.
            </div>
          )}

          {selectedTask && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-sky-200">
                      {selectedMeta.target || 'geral'}
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${decisionInfo.badge}`}>
                      {decisionInfo.label}
                    </span>
                    <span className={`text-[11px] uppercase tracking-[0.2em] ${applyInfo.tone}`}>
                      {applyInfo.label}
                    </span>
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold text-white">{selectedTask.title}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-7 text-zinc-300">
                    {selectedMeta.summary || selectedTask.description || 'Sem resumo detalhado.'}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/8 bg-black/30 px-4 py-3 text-xs text-zinc-400">
                  <p>Criado em {formatDate(selectedTask.created_at)}</p>
                  <p className="mt-1">Ultima decisao {formatDate(selectedMeta.decision_at || selectedTask.updated_at)}</p>
                  {selectedMeta.applied_at && <p className="mt-1">Aplicado em {formatDate(selectedMeta.applied_at)}</p>}
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr),320px]">
                <div className="space-y-5">
                  {(selectedMeta.rationale || selectedTask.description) && (
                    <div className="rounded-2xl border border-white/6 bg-black/25 p-4">
                      <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Leitura do research</p>
                      <p className="mt-3 text-sm leading-7 text-zinc-300">
                        {selectedMeta.rationale || selectedTask.description}
                      </p>
                      {selectedMeta.confidence && (
                        <p className="mt-3 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                          confianca {selectedMeta.confidence}
                        </p>
                      )}
                    </div>
                  )}

                  {Array.isArray(selectedMeta.evidence) && selectedMeta.evidence.length > 0 && (
                    <div className="rounded-2xl border border-white/6 bg-black/25 p-4">
                      <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Evidencias</p>
                      <div className="mt-3 space-y-2">
                        {selectedMeta.evidence.map((item, index) => (
                          <div key={`${item}-${index}`} className="rounded-2xl border border-white/6 bg-white/[0.03] px-3 py-2.5 text-sm text-zinc-300">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {Array.isArray(selectedMeta.suggested_actions) && selectedMeta.suggested_actions.length > 0 && (
                    <div className="rounded-2xl border border-white/6 bg-black/25 p-4">
                      <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Sugestoes proativas</p>
                      <div className="mt-3 grid gap-2">
                        {selectedMeta.suggested_actions.map((item, index) => (
                          <div key={`${item}-${index}`} className="rounded-2xl border border-amber-500/15 bg-amber-500/8 px-3 py-3 text-sm text-amber-50">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    {fileChanges.map((change) => (
                      <FilePreview key={change.path} change={change} />
                    ))}
                    {fileChanges.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-4 text-sm text-zinc-500">
                        Esta sugestao nao carrega diff de arquivo. Serve como item de decisao/checklist.
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/6 bg-black/25 p-4">
                    <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Nota da decisao</p>
                    <textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Ex.: aprovo se mantiver esse tom e nao reabrir bug ja validado."
                      className="mt-3 min-h-[130px] w-full rounded-2xl border border-white/8 bg-black/30 px-3 py-3 text-sm text-zinc-100 outline-none"
                    />
                  </div>

                  <ChecklistBlock
                    title="Checklist interno"
                    items={approvalChecklist}
                    disabled={saving}
                    onToggle={(index, checked) => patchChecklist('approval_checklist', index, checked)}
                  />

                  <ChecklistBlock
                    title="Checklist cliente"
                    items={clientChecklist}
                    disabled={saving}
                    onToggle={(index, checked) => patchChecklist('client_checklist', index, checked)}
                  />

                  <div className="rounded-2xl border border-white/6 bg-black/25 p-4">
                    <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Acoes</p>
                    <div className="mt-3 grid gap-2">
                      <button
                        type="button"
                        onClick={() => handleDecision('approved')}
                        disabled={approveDisabled}
                        className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Aprovar e colocar na fila
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDecision('needs_client_confirmation', { client_confirmation_status: 'pending' })}
                        disabled={saving}
                        className="btn-secondary"
                      >
                        Marcar como confirmar com cliente
                      </button>

                      {clientRequired && !clientConfirmed && (
                        <button
                          type="button"
                          onClick={() => patchClientConfirmation('confirmed')}
                          disabled={saving}
                          className="btn-secondary"
                        >
                          Cliente confirmou
                        </button>
                      )}

                      {clientRequired && clientConfirmed && (
                        <button
                          type="button"
                          onClick={() => patchClientConfirmation('pending')}
                          disabled={saving}
                          className="btn-secondary"
                        >
                          Voltar para aguardando cliente
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleDecision('pending')}
                        disabled={saving}
                        className="btn-secondary"
                      >
                        Voltar para pendente
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDecision('rejected')}
                        disabled={saving}
                        className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-100"
                      >
                        Rejeitar
                      </button>
                    </div>

                    {clientRequired && !clientConfirmed && (
                      <p className="mt-3 text-xs leading-6 text-amber-200">
                        Este item exige confirmacao externa antes do apply automatico.
                      </p>
                    )}

                    {selectedMeta.apply_error && (
                      <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-3 text-xs leading-6 text-rose-100">
                        {selectedMeta.apply_error}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
