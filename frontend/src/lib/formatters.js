const CLIENT_STAGES = new Set([
  'client',
  'partner',
  'onboarding',
  'building',
  'delivered',
  'maintenance',
  'attention',
])

export function parseMoney(value) {
  if (typeof value === 'number') return value
  if (!value) return 0

  const raw = String(value).trim()
  const hasComma = raw.includes(',')
  const normalized = raw
    .replace(/[^\d,.-]/g, '')
    .replace(hasComma ? /\./g : /,(?=.*?,)/g, '')
    .replace(',', '.')

  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value || 0)
}

export function formatCompactNumber(value) {
  return new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value || 0)
}

export function formatRelativeDate(value) {
  if (!value) return 'sem atividade'

  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)

  if (minutes < 1) return 'agora'
  if (minutes < 60) return `${minutes}min`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`

  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  })
}

export function getInitials(label) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('')
}

export function isClientContact(contact) {
  if (!contact || contact.is_group || contact.ignored) return false
  if (CLIENT_STAGES.has(contact.pipeline_stage)) return true
  return Boolean(contact.monthly_revenue || contact.total_revenue || contact.company)
}

export function isUrgentTask(task) {
  if (!task || task.status === 'done') return false
  return task.priority === 'high' || task.status === 'review'
}

export function proposalLabel(status) {
  const labels = {
    draft: 'Rascunho',
    sent: 'Enviada',
    viewed: 'Vista',
    accepted: 'Fechada',
    rejected: 'Perdida',
    negotiation: 'Negociacao',
  }

  return labels[status] || status || 'Sem status'
}
