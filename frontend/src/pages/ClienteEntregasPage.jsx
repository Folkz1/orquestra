import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || 'https://orquestra-backend.jz9bd8.easypanel.host'

// — Color system —
const C = {
  bg: '#06060f',
  surface: '#0c0c1d',
  card: '#111127',
  cardHover: '#16163a',
  border: '#1e1e4a',
  borderGlow: '#3730a3',
  text: '#e2e8f0',
  textMuted: '#64748b',
  textDim: '#475569',
  accent: '#6366f1',
  accentGlow: '#818cf8',
  green: '#22c55e',
  greenDim: '#166534',
  amber: '#f59e0b',
  amberDim: '#78350f',
  red: '#ef4444',
  cyan: '#06b6d4',
  white: '#ffffff',
}

// — Keyframe injection (once) —
const STYLE_ID = 'entregas-keyframes'
function injectKeyframes() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500&display=swap');
    @keyframes fadeSlideUp { from { opacity:0; transform:translateY(24px) } to { opacity:1; transform:translateY(0) } }
    @keyframes ringFill { from { stroke-dashoffset: var(--ring-circumference) } to { stroke-dashoffset: var(--ring-target) } }
    @keyframes barGrow { from { width: 0% } to { width: var(--bar-target) } }
    @keyframes shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
    @keyframes pulseGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(99,102,241,0) } 50% { box-shadow: 0 0 20px 4px rgba(99,102,241,0.15) } }
    @keyframes dotPulse { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.3); opacity: 0.7 } }
    @keyframes countUp { from { opacity: 0 } to { opacity: 1 } }
  `
  document.head.appendChild(style)
}

// — Animated counter hook —
function useCountUp(target, duration = 1200) {
  const [value, setValue] = useState(0)
  const ref = useRef(null)
  useEffect(() => {
    if (target === 0) { setValue(0); return }
    const start = performance.now()
    function tick(now) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(eased * target))
      if (progress < 1) ref.current = requestAnimationFrame(tick)
    }
    ref.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(ref.current)
  }, [target, duration])
  return value
}

// — SVG Progress Ring —
function ProgressRing({ pct, size = 96, stroke = 6, color = C.accent, delay = 0 }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const target = circumference - (pct / 100) * circumference
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={C.border} strokeWidth={stroke} />
      <circle
        cx={size/2} cy={size/2} r={radius} fill="none"
        stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference}
        style={{
          '--ring-circumference': circumference,
          '--ring-target': target,
          animation: `ringFill 1.4s cubic-bezier(0.4,0,0.2,1) ${delay}s forwards`,
        }}
      />
    </svg>
  )
}

// — Animated bar —
function AnimBar({ pct, color, delay = 0 }) {
  return (
    <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
      <div style={{
        height: '100%', borderRadius: 4, background: `linear-gradient(90deg, ${color}, ${color}cc)`,
        '--bar-target': `${Math.min(pct, 100)}%`,
        animation: `barGrow 1s cubic-bezier(0.4,0,0.2,1) ${delay}s forwards`,
        width: 0,
      }} />
    </div>
  )
}

// — Stagger wrapper —
function Stagger({ children, delay = 0, style = {} }) {
  return (
    <div style={{ animation: `fadeSlideUp 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}s both`, ...style }}>
      {children}
    </div>
  )
}

// — Glass card —
function GlassCard({ children, style = {}, glow = false }) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${C.card}ee, ${C.surface}dd)`,
      border: `1px solid ${glow ? C.borderGlow : C.border}`,
      borderRadius: 16,
      padding: '20px 24px',
      backdropFilter: 'blur(12px)',
      position: 'relative',
      overflow: 'hidden',
      ...(glow ? { animation: 'pulseGlow 4s ease-in-out infinite' } : {}),
      ...style,
    }}>
      {children}
    </div>
  )
}

// — Section title —
function SectionTitle({ children, icon, delay = 0 }) {
  return (
    <Stagger delay={delay} style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {icon && <span style={{ fontSize: 18, opacity: 0.8 }}>{icon}</span>}
        <h2 style={{
          fontSize: 13, fontWeight: 600, color: C.accent, textTransform: 'uppercase',
          letterSpacing: '0.12em', margin: 0, fontFamily: "'DM Sans', system-ui",
        }}>{children}</h2>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${C.border}, transparent)` }} />
      </div>
    </Stagger>
  )
}

// — Status helpers —
const STATUS_MAP = {
  done: { label: 'Entregue', color: C.green, bg: C.greenDim + '33' },
  completed: { label: 'Entregue', color: C.green, bg: C.greenDim + '33' },
  review: { label: 'Em revisao', color: C.accent, bg: C.accent + '22' },
  in_progress: { label: 'Em andamento', color: C.amber, bg: C.amberDim + '33' },
  todo: { label: 'Planejado', color: C.textMuted, bg: C.textDim + '22' },
  blocked: { label: 'Bloqueado', color: C.red, bg: C.red + '22' },
  planned: { label: 'Planejado', color: C.cyan, bg: C.cyan + '22' },
}

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.todo
  return (
    <span style={{
      padding: '3px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.color, whiteSpace: 'nowrap',
      fontFamily: "'DM Sans', system-ui",
    }}>{s.label}</span>
  )
}

function PriorityDot({ priority }) {
  const colors = { high: C.red, medium: C.amber, low: C.green }
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%',
      background: colors[priority] || C.textDim,
      display: 'inline-block', flexShrink: 0,
    }} />
  )
}

function formatBRL(v) {
  if (!v && v !== 0) return 'R$ 0'
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ═══════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════
export default function ClienteEntregasPage() {
  const { slug } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    injectKeyframes()
    fetch(`${API}/api/cliente/${slug}/entregas`)
      .then(r => { if (!r.ok) throw new Error(`Cliente "${slug}" nao encontrado`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug])

  const client = data?.client || {}
  const project = data?.project || null
  const kpis = data?.kpis || {
    completion_pct: 0,
    total_delivered: 0,
    total_proposed: 0,
    total_extras: 0,
    tasks_completed: 0,
    tasks_in_progress: 0,
    tasks_pending: 0,
    total_value_proposed: 0,
    total_value_paid: 0,
    total_value_pending: 0,
  }
  const deliveries = data?.deliveries || []
  const timeline = data?.timeline || []
  const next_steps = data?.next_steps || []
  const subscriptions = data?.subscriptions || []

  const completionPct = useCountUp(kpis.completion_pct, 1400)
  const deliveredCount = useCountUp(kpis.total_delivered, 1000)
  const extrasCount = useCountUp(kpis.total_extras, 1000)
  const tasksCompletedCount = useCountUp(kpis.tasks_completed, 1000)

  const totalTasks = kpis.tasks_completed + kpis.tasks_in_progress + kpis.tasks_pending
  const tasksPct = totalTasks > 0 ? Math.round(kpis.tasks_completed / totalTasks * 100) : 0

  const completedTimeline = timeline.filter(t => ['done', 'completed'].includes(t.status))
  const activeTimeline = timeline.filter(t => !['done', 'completed'].includes(t.status))

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', system-ui" }}>
      <div style={{ textAlign: 'center', color: C.textMuted }}>
        <div style={{
          width: 48, height: 48, border: `3px solid ${C.border}`, borderTopColor: C.accent,
          borderRadius: '50%', margin: '0 auto 16px',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        Carregando entregas...
      </div>
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', system-ui", flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 56, color: C.red, fontWeight: 700 }}>404</div>
      <div style={{ color: C.textMuted, fontSize: 15 }}>{error}</div>
      <Link to={`/cliente/${slug}`} style={{ color: C.accent, fontSize: 13, textDecoration: 'none', marginTop: 8 }}>
        Voltar para o perfil
      </Link>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "'DM Sans', system-ui" }}>
      {/* ═══ HERO HEADER ═══ */}
      <div style={{
        background: `linear-gradient(160deg, #1a1145 0%, ${C.bg} 50%, #0a1628 100%)`,
        borderBottom: `1px solid ${C.border}`,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Ambient grid pattern */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.04,
          backgroundImage: `linear-gradient(${C.accent} 1px, transparent 1px), linear-gradient(90deg, ${C.accent} 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }} />
        {/* Gradient orb */}
        <div style={{
          position: 'absolute', right: -100, top: -100, width: 400, height: 400,
          background: `radial-gradient(circle, ${C.accent}12 0%, transparent 70%)`,
          borderRadius: '50%',
        }} />

        <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 28px 36px', position: 'relative' }}>
          <Stagger delay={0}>
            <Link to={`/cliente/${slug}`} style={{
              color: C.textMuted, fontSize: 12, textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 20,
              letterSpacing: '0.04em',
            }}>
              <span style={{ fontSize: 16 }}>&larr;</span> Voltar ao perfil
            </Link>
          </Stagger>

          <Stagger delay={0.1}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
              <div style={{
                width: 64, height: 64, borderRadius: 16,
                background: `linear-gradient(135deg, ${C.accent}, #7c3aed)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26, fontWeight: 700, color: C.white,
                boxShadow: `0 8px 32px ${C.accent}33`,
              }}>
                {(client.name || '?')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                  Entregas e Resultados
                </h1>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 15, color: C.textMuted }}>{client.name}</span>
                  {client.company && (
                    <>
                      <span style={{ color: C.textDim }}>·</span>
                      <span style={{ fontSize: 14, color: C.textDim }}>{client.company}</span>
                    </>
                  )}
                  {project && (
                    <>
                      <span style={{ color: C.textDim }}>·</span>
                      <span style={{
                        padding: '2px 10px', borderRadius: 20, fontSize: 12,
                        background: C.accent + '22', color: C.accentGlow,
                      }}>{project.name}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </Stagger>
        </div>
      </div>

      {/* ═══ BODY ═══ */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 28px 64px' }}>

        {/* ═══ KPI RING CARDS ═══ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 48 }}>
          {/* Completion ring */}
          <Stagger delay={0.15}>
            <GlassCard glow style={{ textAlign: 'center', padding: '28px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
                <ProgressRing pct={kpis.completion_pct} size={100} stroke={7} color={C.green} delay={0.3} />
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column',
                }}>
                  <span style={{ fontSize: 26, fontWeight: 700, color: C.white, fontFamily: "'JetBrains Mono', monospace" }}>
                    {completionPct}%
                  </span>
                </div>
              </div>
              <div style={{ marginTop: 14, fontSize: 13, color: C.textMuted, fontWeight: 500 }}>Progresso geral</div>
              <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>
                {deliveredCount} de {kpis.total_proposed} itens
              </div>
            </GlassCard>
          </Stagger>

          {/* Tasks ring */}
          <Stagger delay={0.2}>
            <GlassCard style={{ textAlign: 'center', padding: '28px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
                <ProgressRing pct={tasksPct} size={100} stroke={7} color={C.accent} delay={0.5} />
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column',
                }}>
                  <span style={{ fontSize: 26, fontWeight: 700, color: C.white, fontFamily: "'JetBrains Mono', monospace" }}>
                    {tasksCompletedCount}
                  </span>
                </div>
              </div>
              <div style={{ marginTop: 14, fontSize: 13, color: C.textMuted, fontWeight: 500 }}>Tarefas concluidas</div>
              <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>
                {kpis.tasks_in_progress} em andamento · {kpis.tasks_pending} pendentes
              </div>
            </GlassCard>
          </Stagger>

          {/* Extras */}
          <Stagger delay={0.25}>
            <GlassCard style={{ textAlign: 'center', padding: '28px 20px' }}>
              <div style={{
                width: 100, height: 100, borderRadius: '50%', margin: '0 auto',
                background: `linear-gradient(135deg, ${C.amberDim}44, ${C.amber}11)`,
                border: `2px solid ${C.amber}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
              }}>
                <span style={{ fontSize: 26, fontWeight: 700, color: C.amber, fontFamily: "'JetBrains Mono', monospace" }}>
                  +{extrasCount}
                </span>
              </div>
              <div style={{ marginTop: 14, fontSize: 13, color: C.textMuted, fontWeight: 500 }}>Extras entregues</div>
              <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>Alem do escopo original</div>
            </GlassCard>
          </Stagger>

          {/* Financial */}
          <Stagger delay={0.3}>
            <GlassCard style={{ padding: '28px 20px' }}>
              <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 500, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Financeiro
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: C.textMuted }}>Proposta</span>
                  <span style={{ color: C.white, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
                    {formatBRL(kpis.total_value_proposed)}
                  </span>
                </div>
                <AnimBar pct={100} color={C.textDim} delay={0.4} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: C.textMuted }}>Pago</span>
                  <span style={{ color: C.green, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
                    {formatBRL(kpis.total_value_paid)}
                  </span>
                </div>
                <AnimBar pct={kpis.total_value_proposed > 0 ? (kpis.total_value_paid / kpis.total_value_proposed * 100) : 0} color={C.green} delay={0.6} />
              </div>
              {kpis.total_value_pending > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                    <span style={{ color: C.textMuted }}>Pendente</span>
                    <span style={{ color: C.amber, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
                      {formatBRL(kpis.total_value_pending)}
                    </span>
                  </div>
                  <AnimBar pct={kpis.total_value_proposed > 0 ? (kpis.total_value_pending / kpis.total_value_proposed * 100) : 0} color={C.amber} delay={0.8} />
                </div>
              )}
            </GlassCard>
          </Stagger>
        </div>

        {/* ═══ DELIVERY REPORTS (Escopo proposto vs entregue) ═══ */}
        {deliveries.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <SectionTitle icon={'\u2B50'} delay={0.35}>Comparativo de entregas</SectionTitle>
            {deliveries.map((d, di) => (
              <Stagger key={di} delay={0.4 + di * 0.1} style={{ marginBottom: 20 }}>
                <GlassCard>
                  {d.proposal_title && (
                    <div style={{ marginBottom: 16 }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{d.proposal_title}</span>
                      <StatusBadge status={d.status === 'sent_to_client' ? 'done' : d.status === 'final' ? 'review' : 'todo'} />
                    </div>
                  )}

                  {/* Side-by-side scope comparison */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                        Proposto ({d.proposed_scope.length})
                      </div>
                      {d.proposed_scope.map((item, i) => (
                        <div key={i} style={{
                          padding: '8px 12px', marginBottom: 6, borderRadius: 10,
                          background: C.surface, border: `1px solid ${C.border}`,
                          fontSize: 13, color: C.text,
                        }}>
                          {item.item || item.description || item}
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: C.green, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                        Entregue ({d.delivered_scope.length})
                      </div>
                      {d.delivered_scope.map((item, i) => {
                        const cat = item.category || 'core'
                        const catColor = cat === 'extra' ? C.amber : cat === 'upgrade' ? C.cyan : C.green
                        return (
                          <div key={i} style={{
                            padding: '8px 12px', marginBottom: 6, borderRadius: 10,
                            background: catColor + '0a', border: `1px solid ${catColor}22`,
                            fontSize: 13, color: C.text,
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          }}>
                            <span>{item.item || item.description || item}</span>
                            {cat !== 'core' && (
                              <span style={{
                                fontSize: 10, fontWeight: 600, padding: '1px 8px', borderRadius: 10,
                                background: catColor + '22', color: catColor,
                              }}>{cat.toUpperCase()}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Extras */}
                  {d.extras.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, color: C.amber, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                        Extras entregues (+{d.extras.length})
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {d.extras.map((e, i) => (
                          <div key={i} style={{
                            padding: '6px 14px', borderRadius: 10,
                            background: C.amber + '0c', border: `1px solid ${C.amber}22`,
                            fontSize: 13, color: C.amber,
                          }}>
                            {e.item || e.description || e}
                            {e.value && <span style={{ color: C.textMuted, marginLeft: 8, fontSize: 12 }}>{e.value}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Financial mini-summary */}
                  {d.financial_summary && Object.keys(d.financial_summary).length > 0 && (
                    <div style={{
                      display: 'flex', gap: 24, padding: '12px 16px', borderRadius: 12,
                      background: C.surface, border: `1px solid ${C.border}`, flexWrap: 'wrap',
                    }}>
                      {[
                        { label: 'Proposta', value: d.financial_summary.proposed, color: C.text },
                        { label: 'Extras', value: d.financial_summary.extras_total, color: C.amber },
                        { label: 'Total', value: d.financial_summary.total, color: C.white },
                        { label: 'Pago', value: d.financial_summary.paid, color: C.green },
                        { label: 'Pendente', value: d.financial_summary.pending, color: C.amber },
                      ].filter(f => f.value).map(f => (
                        <div key={f.label}>
                          <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{f.label}</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: f.color, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                            {typeof f.value === 'number' ? formatBRL(f.value) : f.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Analysis text */}
                  {d.comparison_analysis && (
                    <div style={{
                      marginTop: 16, padding: '14px 16px', borderRadius: 12,
                      background: C.accent + '08', border: `1px solid ${C.accent}15`,
                      fontSize: 13, color: C.textMuted, lineHeight: 1.7, whiteSpace: 'pre-wrap',
                    }}>
                      {d.comparison_analysis}
                    </div>
                  )}
                </GlassCard>
              </Stagger>
            ))}
          </div>
        )}

        {/* ═══ TIMELINE ═══ */}
        {timeline.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <SectionTitle icon={'\u23F1'} delay={0.5}>Timeline de entregas</SectionTitle>

            <Stagger delay={0.55}>
              <div style={{ position: 'relative', paddingLeft: 36 }}>
                {/* Vertical line */}
                <div style={{
                  position: 'absolute', left: 11, top: 8, bottom: 8, width: 2,
                  background: `linear-gradient(180deg, ${C.accent}44, ${C.border}, transparent)`,
                }} />

                {/* Active items first */}
                {activeTimeline.map((t, i) => {
                  const s = STATUS_MAP[t.status] || STATUS_MAP.todo
                  return (
                    <div key={`active-${i}`} style={{ position: 'relative', marginBottom: 14 }}>
                      {/* Dot */}
                      <div style={{
                        position: 'absolute', left: -31, top: 16, width: 12, height: 12,
                        borderRadius: '50%', background: s.color,
                        border: `3px solid ${C.bg}`,
                        boxShadow: `0 0 12px ${s.color}55`,
                        animation: t.status === 'in_progress' ? 'dotPulse 2s ease-in-out infinite' : 'none',
                      }} />
                      <GlassCard style={{ padding: '14px 18px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <PriorityDot priority={t.priority} />
                              <span style={{ fontWeight: 500, fontSize: 14 }}>{t.title}</span>
                            </div>
                            {t.description && (
                              <div style={{ color: C.textDim, fontSize: 13, marginTop: 4, marginLeft: 16 }}>{t.description}</div>
                            )}
                          </div>
                          <StatusBadge status={t.status} />
                        </div>
                        {t.created_at && (
                          <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, marginLeft: 16 }}>
                            Criada em {formatDate(t.created_at)}
                          </div>
                        )}
                      </GlassCard>
                    </div>
                  )
                })}

                {/* Completed items */}
                {completedTimeline.map((t, i) => {
                  const s = STATUS_MAP[t.status] || STATUS_MAP.done
                  return (
                    <div key={`done-${i}`} style={{ position: 'relative', marginBottom: 12 }}>
                      <div style={{
                        position: 'absolute', left: -31, top: 14, width: 12, height: 12,
                        borderRadius: '50%', background: s.color,
                        border: `3px solid ${C.bg}`,
                      }} />
                      <div style={{
                        padding: '10px 18px', borderRadius: 12,
                        background: C.card + '88', border: `1px solid ${C.border}66`,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: C.green, fontSize: 14 }}>{'\u2713'}</span>
                          <span style={{ fontSize: 13, color: C.textMuted }}>{t.title}</span>
                        </div>
                        <span style={{ fontSize: 11, color: C.textDim }}>
                          {t.completed_at ? formatDate(t.completed_at) : formatDate(t.created_at)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Stagger>
          </div>
        )}

        {/* ═══ SUBSCRIPTIONS ═══ */}
        {subscriptions.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <SectionTitle icon={'\uD83D\uDD04'} delay={0.6}>Modelo de parceria</SectionTitle>
            {subscriptions.map((sub, si) => (
              <Stagger key={si} delay={0.65 + si * 0.05}>
                <GlassCard style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{sub.description || 'Mensalidade'}</div>
                      <div style={{ color: C.textDim, fontSize: 13, marginTop: 4 }}>
                        Vence dia {sub.billing_day} · <span style={{ fontFamily: "'JetBrains Mono', monospace", color: C.accent }}>{formatBRL(sub.amount_brl)}/mes</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {sub.payments.slice(0, 6).map((p, pi) => (
                        <div key={pi} title={`${p.reference_month}: ${p.status === 'paid' ? 'Pago' : 'Pendente'}`}
                          style={{
                            width: 36, height: 36, borderRadius: 8,
                            background: p.status === 'paid' ? C.green + '22' : C.amber + '22',
                            border: `1px solid ${p.status === 'paid' ? C.green : C.amber}33`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
                            color: p.status === 'paid' ? C.green : C.amber,
                          }}>
                          {p.reference_month ? p.reference_month.slice(5) : '?'}
                        </div>
                      ))}
                    </div>
                  </div>
                </GlassCard>
              </Stagger>
            ))}
          </div>
        )}

        {/* ═══ NEXT STEPS ═══ */}
        {next_steps.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <SectionTitle icon={'\uD83D\uDE80'} delay={0.7}>Proximos passos</SectionTitle>
            <Stagger delay={0.75}>
              <GlassCard glow>
                {next_steps.map((step, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '12px 0',
                    borderBottom: i < next_steps.length - 1 ? `1px solid ${C.border}` : 'none',
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: C.accent + '18', border: `1px solid ${C.accent}33`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700, color: C.accentGlow, flexShrink: 0,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{step.title}</div>
                      {step.description && (
                        <div style={{ fontSize: 13, color: C.textDim, marginTop: 4 }}>{step.description}</div>
                      )}
                    </div>
                    <StatusBadge status={step.status} />
                  </div>
                ))}
              </GlassCard>
            </Stagger>
          </div>
        )}

        {/* ═══ FOOTER ═══ */}
        <Stagger delay={0.85}>
          <div style={{
            textAlign: 'center', padding: '32px 0 0', borderTop: `1px solid ${C.border}`,
            color: C.textDim, fontSize: 12, lineHeight: 1.8,
          }}>
            <div style={{ marginBottom: 8 }}>
              <Link to={`/cliente/${slug}`} style={{ color: C.accent, textDecoration: 'none', fontSize: 13 }}>
                Ver perfil completo &rarr;
              </Link>
            </div>
            Dashboard gerado automaticamente · Orquestra
          </div>
        </Stagger>
      </div>
    </div>
  )
}
