import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || 'https://orquestra-backend.jz9bd8.easypanel.host'

const STAGE_LABELS = {
  lead: 'Lead',
  prospect: 'Prospect',
  negotiation: 'Negociação',
  client: 'Cliente ativo',
  churned: 'Cancelado',
}

const TASK_STATUS_COLORS = {
  done: '#22c55e',
  completed: '#22c55e',
  review: '#6366f1',
  in_progress: '#f59e0b',
  todo: '#475569',
  blocked: '#ef4444',
}

const PAY_COLORS = { paid: '#22c55e', pending: '#f59e0b', overdue: '#ef4444' }
const PAY_LABELS = { paid: 'Pago', pending: 'Pendente', overdue: 'Atrasado' }

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 16px' }}>{title}</h2>
      {children}
    </div>
  )
}

function Card({ children, style = {} }) {
  return (
    <div style={{ background: '#1a1a2e', borderRadius: 10, padding: '16px 20px', border: '1px solid #2a2a4a', ...style }}>
      {children}
    </div>
  )
}

export default function ClientePage() {
  const { slug } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${API}/api/cliente/${slug}`)
      .then(r => {
        if (!r.ok) throw new Error(`Cliente "${slug}" não encontrado`)
        return r.json()
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f0f23', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontFamily: 'system-ui' }}>
      Carregando...
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0f0f23', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', fontFamily: 'system-ui', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 40 }}>404</div>
      <div>{error}</div>
    </div>
  )

  const { client, project, proposals, timeline, subscriptions } = data

  const completedTasks = timeline.filter(t => ['done', 'completed'].includes(t.status))
  const inProgressTasks = timeline.filter(t => !['done', 'completed'].includes(t.status))

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f23', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #0f0f23 100%)', borderBottom: '1px solid #2a2a4a', padding: '32px 0' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700 }}>
              {(client.name || '?')[0].toUpperCase()}
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>{client.name}</h1>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ padding: '3px 10px', background: '#1e293b', borderRadius: 20, fontSize: 12, color: '#94a3b8' }}>
                  {STAGE_LABELS[client.pipeline_stage] || client.pipeline_stage}
                </span>
                {client.company && (
                  <span style={{ padding: '3px 10px', background: '#1e293b', borderRadius: 20, fontSize: 12, color: '#94a3b8' }}>
                    {client.company}
                  </span>
                )}
                {project && (
                  <span style={{ padding: '3px 10px', background: '#312e81', borderRadius: 20, fontSize: 12, color: '#a5b4fc' }}>
                    {project.name}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 32 }}>
          {[
            { label: 'Entregas concluídas', value: completedTasks.length, color: '#22c55e' },
            { label: 'Em andamento', value: inProgressTasks.length, color: '#6366f1' },
            { label: 'Propostas aceitas', value: (data.accepted_proposals || []).length, color: '#f59e0b' },
          ].map(({ label, value, color }) => (
            <Card key={label}>
              <div style={{ color: '#64748b', fontSize: 12 }}>{label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
            </Card>
          ))}
        </div>

        {/* Link para dashboard de entregas */}
        <Link to={`/cliente/${slug}/entregas`} style={{
          display: 'block', padding: '14px 20px', marginBottom: 32, borderRadius: 10,
          background: 'linear-gradient(135deg, #1e1b4b, #312e81)', border: '1px solid #3730a3',
          textDecoration: 'none', color: '#e2e8f0',
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Dashboard de Entregas e Resultados</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Progresso, comparativos, timeline e financeiro</div>
            </div>
            <span style={{ fontSize: 20, color: '#a5b4fc' }}>&rarr;</span>
          </div>
        </Link>

        {/* Modelo de parceria (assinaturas) */}
        {subscriptions.length > 0 && (
          <Section title="Modelo de Parceria">
            {subscriptions.map(sub => {
              const lastPayments = sub.payments.slice(0, 3)
              return (
                <Card key={sub.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{sub.description || 'Mensalidade'}</div>
                      <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>Vence dia {sub.billing_day} · R${sub.amount_brl.toFixed(0)}/mês</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {lastPayments.map(p => (
                        <div key={p.reference_month} title={`${p.reference_month}: ${PAY_LABELS[p.status]}`}
                          style={{ width: 28, height: 28, borderRadius: 6, background: PAY_COLORS[p.status] || '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 600 }}>
                          {p.reference_month.slice(5)}
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              )
            })}
          </Section>
        )}

        {/* Propostas */}
        {proposals.length > 0 && (
          <Section title="Propostas">
            {proposals.map(p => (
              <Card key={p.id} style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{p.title}</div>
                  <div style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>{new Date(p.created_at).toLocaleDateString('pt-BR')}</div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {p.total_value && <span style={{ fontWeight: 600 }}>R${Number(p.total_value).toLocaleString('pt-BR')}</span>}
                  <span style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                    background: p.status === 'accepted' ? '#14532d' : p.status === 'sent' ? '#1e3a5f' : '#1e293b',
                    color: p.status === 'accepted' ? '#22c55e' : p.status === 'sent' ? '#60a5fa' : '#94a3b8',
                  }}>
                    {p.status === 'accepted' ? 'Aceita' : p.status === 'sent' ? 'Enviada' : p.status === 'signed' ? 'Assinada' : p.status}
                  </span>
                </div>
              </Card>
            ))}
          </Section>
        )}

        {/* Timeline */}
        {timeline.length > 0 && (
          <Section title="Entregas">
            <div style={{ position: 'relative', paddingLeft: 24 }}>
              <div style={{ position: 'absolute', left: 7, top: 0, bottom: 0, width: 2, background: '#2a2a4a' }} />
              {timeline.map((t, i) => {
                const color = TASK_STATUS_COLORS[t.status] || '#475569'
                return (
                  <div key={i} style={{ position: 'relative', marginBottom: 16 }}>
                    <div style={{ position: 'absolute', left: -21, top: 4, width: 10, height: 10, borderRadius: '50%', background: color, border: '2px solid #0f0f23' }} />
                    <Card>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 500 }}>{t.title}</div>
                          {t.description && <div style={{ color: '#475569', fontSize: 13, marginTop: 3 }}>{t.description}</div>}
                        </div>
                        <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: color + '22', color, flexShrink: 0, marginLeft: 12 }}>
                          {t.status === 'done' || t.status === 'completed' ? 'Entregue' : t.status === 'in_progress' ? 'Em andamento' : t.status === 'review' ? 'Em revisão' : t.status}
                        </span>
                      </div>
                      {t.completed_at && (
                        <div style={{ color: '#475569', fontSize: 12, marginTop: 6 }}>
                          Concluído {new Date(t.completed_at).toLocaleDateString('pt-BR')}
                        </div>
                      )}
                    </Card>
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {client.next_action && (
          <Card style={{ marginTop: 8, borderColor: '#3730a3' }}>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Próximo passo</div>
            <div style={{ color: '#a5b4fc' }}>{client.next_action}</div>
          </Card>
        )}
      </div>
    </div>
  )
}
