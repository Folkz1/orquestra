import { useState, useEffect, useCallback } from 'react'
import {
  getSubscriptionsDashboard,
  listSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  registerSubscriptionPayment,
  triggerSubscriptionAlerts,
} from '../api'

const STATUS_LABELS = { active: 'Ativa', paused: 'Pausada', cancelled: 'Cancelada' }
const STATUS_COLORS = { active: '#22c55e', paused: '#f59e0b', cancelled: '#ef4444' }
const PAY_COLORS = { paid: '#22c55e', pending: '#f59e0b', overdue: '#ef4444' }
const PAY_LABELS = { paid: 'Pago', pending: 'Pendente', overdue: 'Atrasado' }

function formatBRL(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ── Modal de novo pagamento ──────────────────────────────────────────────────
function PaymentModal({ sub, onClose, onSave }) {
  const [month, setMonth] = useState(currentMonth())
  const [method, setMethod] = useState('pix')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSave() {
    setLoading(true)
    try {
      await registerSubscriptionPayment(sub.id, {
        reference_month: month,
        payment_method: method,
        notes,
      })
      onSave()
    } catch (e) {
      alert('Erro ao registrar pagamento: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 24, width: 380, border: '1px solid #2a2a4a' }}>
        <h3 style={{ margin: '0 0 16px', color: '#e2e8f0' }}>Registrar Pagamento — {sub.client_name}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ color: '#94a3b8', fontSize: 13 }}>
            Mês de referência
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#0f0f23', border: '1px solid #2a2a4a', borderRadius: 8, color: '#e2e8f0', fontSize: 14 }}
            />
          </label>
          <label style={{ color: '#94a3b8', fontSize: 13 }}>
            Método
            <select
              value={method}
              onChange={e => setMethod(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#0f0f23', border: '1px solid #2a2a4a', borderRadius: 8, color: '#e2e8f0', fontSize: 14 }}
            >
              <option value="pix">PIX</option>
              <option value="boleto">Boleto</option>
              <option value="transferencia">Transferência</option>
              <option value="cartao">Cartão</option>
              <option value="dinheiro">Dinheiro</option>
            </select>
          </label>
          <label style={{ color: '#94a3b8', fontSize: 13 }}>
            Observações
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Opcional"
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#0f0f23', border: '1px solid #2a2a4a', borderRadius: 8, color: '#e2e8f0', fontSize: 14 }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #2a2a4a', borderRadius: 8, color: '#94a3b8', cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={loading} style={{ padding: '8px 20px', background: '#22c55e', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            {loading ? 'Salvando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal nova assinatura ────────────────────────────────────────────────────
function NewSubModal({ onClose, onSave }) {
  const [form, setForm] = useState({ client_name: '', description: '', amount_cents: '', billing_day: 1 })
  const [loading, setLoading] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.client_name || !form.amount_cents) return alert('Preencha nome e valor')
    setLoading(true)
    try {
      await createSubscription({ ...form, amount_cents: Math.round(parseFloat(form.amount_cents) * 100) })
      onSave()
    } catch (e) {
      alert('Erro: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 24, width: 400, border: '1px solid #2a2a4a' }}>
        <h3 style={{ margin: '0 0 16px', color: '#e2e8f0' }}>Nova Assinatura</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'Cliente *', key: 'client_name', placeholder: 'Ex: Eduardo Dias' },
            { label: 'Descrição', key: 'description', placeholder: 'Ex: CRM Jurídico mensalidade' },
            { label: 'Valor mensal (R$) *', key: 'amount_cents', placeholder: '400', type: 'number' },
            { label: 'Dia de vencimento', key: 'billing_day', placeholder: '1', type: 'number' },
          ].map(({ label, key, placeholder, type = 'text' }) => (
            <label key={key} style={{ color: '#94a3b8', fontSize: 13 }}>
              {label}
              <input
                type={type}
                value={form[key]}
                onChange={e => set(key, e.target.value)}
                placeholder={placeholder}
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#0f0f23', border: '1px solid #2a2a4a', borderRadius: 8, color: '#e2e8f0', fontSize: 14, boxSizing: 'border-box' }}
              />
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #2a2a4a', borderRadius: 8, color: '#94a3b8', cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={loading} style={{ padding: '8px 20px', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            {loading ? 'Salvando...' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Página principal ─────────────────────────────────────────────────────────
export default function Subscriptions() {
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [payModal, setPayModal] = useState(null)  // sub object
  const [newSubModal, setNewSubModal] = useState(false)
  const [alerting, setAlerting] = useState(false)
  const [alertResult, setAlertResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getSubscriptionsDashboard()
      setDashboard(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAlert() {
    setAlerting(true)
    setAlertResult(null)
    try {
      const r = await triggerSubscriptionAlerts()
      setAlertResult(r)
    } catch (e) {
      setAlertResult({ error: e.message })
    } finally {
      setAlerting(false)
    }
  }

  async function handleCancel(sub) {
    if (!confirm(`Cancelar assinatura de ${sub.client_name}?`)) return
    await updateSubscription(sub.id, { status: 'cancelled' })
    load()
  }

  if (loading) return (
    <div style={{ padding: 32, color: '#94a3b8', textAlign: 'center' }}>Carregando assinaturas...</div>
  )

  const d = dashboard || {}
  const subs = d.subscriptions || []
  const mrr = d.mrr_brl || 0
  const received = d.received_brl || 0
  const pending = d.pending_brl || 0
  const pct = mrr > 0 ? Math.round((received / mrr) * 100) : 0

  return (
    <div style={{ padding: '24px 32px', background: '#0f0f23', minHeight: '100vh', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Assinaturas</h1>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>{d.current_month} — {d.total_active || 0} ativas</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleAlert}
            disabled={alerting}
            style={{ padding: '8px 16px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}
          >
            {alerting ? 'Enviando...' : '🔔 Verificar Pendentes'}
          </button>
          <button
            onClick={() => setNewSubModal(true)}
            style={{ padding: '8px 20px', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
          >
            + Nova Assinatura
          </button>
        </div>
      </div>

      {/* Alert result */}
      {alertResult && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: alertResult.error ? '#7f1d1d' : '#14532d', borderRadius: 8, fontSize: 13, color: '#fff' }}>
          {alertResult.error
            ? `Erro: ${alertResult.error}`
            : `✓ ${alertResult.checked} assinaturas verificadas · ${alertResult.alerts_sent} alerta(s) enviado(s)`
          }
          {alertResult.pending_subscriptions?.length > 0 && (
            <span style={{ marginLeft: 8, color: '#fca5a5' }}>— Pendentes: {alertResult.pending_subscriptions.join(', ')}</span>
          )}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'MRR Total', value: formatBRL(d.mrr_cents || 0), color: '#6366f1' },
          { label: 'Recebido', value: formatBRL(d.received_cents || 0), color: '#22c55e' },
          { label: 'Pendente', value: formatBRL(d.pending_cents || 0), color: '#f59e0b' },
          { label: 'Recebimento', value: `${pct}%`, color: pct >= 100 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#1a1a2e', borderRadius: 12, padding: '20px 24px', border: '1px solid #2a2a4a' }}>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ background: '#1a1a2e', borderRadius: 8, height: 8, marginBottom: 28, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#22c55e' : '#6366f1', transition: 'width 0.5s' }} />
      </div>

      {/* Subscription list */}
      {subs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#475569' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>💳</div>
          <div>Nenhuma assinatura ativa</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Clique em "Nova Assinatura" para começar</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {subs.map(sub => {
            const payStatus = sub.current_month_status
            const color = PAY_COLORS[payStatus] || '#64748b'
            return (
              <div key={sub.id} style={{ background: '#1a1a2e', borderRadius: 12, padding: '18px 24px', border: `1px solid ${payStatus === 'paid' ? '#166534' : '#7c2d12'}`, display: 'flex', alignItems: 'center', gap: 16 }}>
                {/* Status pill */}
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />

                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{sub.client_name}</div>
                  {sub.description && <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{sub.description}</div>}
                  {sub.contact_name && <div style={{ color: '#475569', fontSize: 12 }}>Contato: {sub.contact_name}</div>}
                </div>

                {/* Valor */}
                <div style={{ textAlign: 'right', minWidth: 100 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{formatBRL(sub.amount_cents)}<span style={{ fontWeight: 400, color: '#475569', fontSize: 12 }}>/mês</span></div>
                  <div style={{ fontSize: 12, color }}>Dia {sub.billing_day} · {PAY_LABELS[payStatus] || payStatus}</div>
                </div>

                {/* Histórico */}
                {sub.history?.length > 0 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {sub.history.slice(0, 3).map(h => (
                      <div key={h.id} title={`${h.reference_month}: ${PAY_LABELS[h.status] || h.status}`}
                        style={{ width: 8, height: 8, borderRadius: '50%', background: PAY_COLORS[h.status] || '#334155' }} />
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8 }}>
                  {payStatus !== 'paid' && (
                    <button
                      onClick={() => setPayModal(sub)}
                      style={{ padding: '6px 14px', background: '#14532d', border: '1px solid #166534', borderRadius: 8, color: '#22c55e', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                    >
                      Registrar
                    </button>
                  )}
                  {payStatus === 'paid' && (
                    <span style={{ padding: '6px 14px', color: '#22c55e', fontSize: 13 }}>✓ Pago</span>
                  )}
                  <button
                    onClick={() => handleCancel(sub)}
                    title="Cancelar assinatura"
                    style={{ padding: '6px 10px', background: 'transparent', border: '1px solid #2a2a4a', borderRadius: 8, color: '#475569', cursor: 'pointer', fontSize: 12 }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {payModal && (
        <PaymentModal
          sub={payModal}
          onClose={() => setPayModal(null)}
          onSave={() => { setPayModal(null); load() }}
        />
      )}
      {newSubModal && (
        <NewSubModal
          onClose={() => setNewSubModal(false)}
          onSave={() => { setNewSubModal(false); load() }}
        />
      )}
    </div>
  )
}
