import { useState, useEffect, useCallback } from 'react'
import { getContacts, updateContact, getProposals, getMessages, getContactSuggestions } from '../api'

const STAGES = [
  { id: 'lead', label: 'Leads', color: 'zinc', icon: '📋' },
  { id: 'onboarding', label: 'Onboarding', color: 'blue', icon: '🚀' },
  { id: 'building', label: 'Construindo', color: 'yellow', icon: '🔨' },
  { id: 'delivered', label: 'Entregue', color: 'emerald', icon: '✅' },
  { id: 'maintenance', label: 'Manutenção', color: 'purple', icon: '🔧' },
  { id: 'attention', label: 'Atenção', color: 'red', icon: '⚠️' },
]

const STAGE_COLORS = {
  zinc: { bg: 'bg-zinc-500/10', border: 'border-zinc-500/30', text: 'text-zinc-400', dot: 'bg-zinc-500' },
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400', dot: 'bg-blue-500' },
  yellow: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', dot: 'bg-yellow-500' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', dot: 'bg-emerald-500' },
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400', dot: 'bg-purple-500' },
  red: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', dot: 'bg-red-500' },
}

const SUGGESTION_ICONS = {
  follow_up: '📞', upsell: '💰', suporte: '🛠️', urgente: '🔴', relacionamento: '🤝', info: 'ℹ️',
}

function timeAgo(dateStr) {
  if (!dateStr) return 'nunca'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}m`
}

function HealthBar({ score }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] text-zinc-500 w-6 text-right">{score}</span>
    </div>
  )
}

function ClientCard({ contact, proposals, onClick, onDragStart }) {
  const linkedProposals = proposals.filter(p => p.contact_id === contact.id?.toString() || p.contact_id === contact.id)
  const lastActive = contact.last_contacted_at || contact.last_message_at || contact.updated_at

  return (
    <div
      className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 cursor-pointer hover:border-zinc-600 transition-all group"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('contact_id', contact.id)
        onDragStart?.(contact)
      }}
      onClick={() => onClick(contact)}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white truncate">{contact.name || contact.push_name || contact.phone}</p>
          {contact.company && <p className="text-[11px] text-zinc-500 truncate">{contact.company}</p>}
        </div>
        {contact.monthly_revenue && (
          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded shrink-0 ml-2">
            {contact.monthly_revenue}
          </span>
        )}
      </div>

      <HealthBar score={contact.engagement_score || 0} />

      <div className="flex items-center justify-between mt-2 text-[10px] text-zinc-600">
        <span>{contact.phone}</span>
        <span>{timeAgo(lastActive)}</span>
      </div>

      {contact.next_action && (
        <div className="mt-2 text-[10px] text-zinc-500 bg-zinc-800/50 rounded px-2 py-1 truncate">
          → {contact.next_action}
        </div>
      )}

      {linkedProposals.length > 0 && (
        <div className="mt-2 flex gap-1 flex-wrap">
          {linkedProposals.map(p => (
            <span key={p.id} className={`text-[9px] px-1.5 py-0.5 rounded ${
              p.status === 'accepted' ? 'bg-emerald-500/15 text-emerald-400' :
              p.status === 'viewed' ? 'bg-blue-500/15 text-blue-400' :
              p.status === 'sent' ? 'bg-yellow-500/15 text-yellow-400' :
              'bg-zinc-800 text-zinc-500'
            }`}>
              {p.total_value || p.title?.slice(0, 15)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function StageColumn({ stage, contacts, proposals, onCardClick, onDrop, onDragStart }) {
  const [isDragOver, setIsDragOver] = useState(false)
  const colors = STAGE_COLORS[stage.color]

  return (
    <div
      className={`flex-1 min-w-[240px] max-w-[320px] ${isDragOver ? 'scale-[1.01]' : ''} transition-transform`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragOver(false)
        const contactId = e.dataTransfer.getData('contact_id')
        if (contactId) onDrop(contactId, stage.id)
      }}
    >
      <div className={`flex items-center gap-2 mb-3 px-1`}>
        <span className="text-base">{stage.icon}</span>
        <h3 className={`text-sm font-medium ${colors.text}`}>{stage.label}</h3>
        <span className={`text-[10px] ${colors.text} ${colors.bg} px-1.5 py-0.5 rounded-full`}>
          {contacts.length}
        </span>
      </div>
      <div className={`space-y-2 min-h-[200px] rounded-xl p-2 border border-dashed transition-colors ${
        isDragOver ? `${colors.border} ${colors.bg}` : 'border-transparent'
      }`}>
        {contacts.map(c => (
          <ClientCard
            key={c.id}
            contact={c}
            proposals={proposals}
            onClick={onCardClick}
            onDragStart={onDragStart}
          />
        ))}
        {contacts.length === 0 && (
          <div className="text-center py-8 text-zinc-700 text-xs">
            Arraste clientes aqui
          </div>
        )}
      </div>
    </div>
  )
}

function DetailPanel({ contact, proposals, onClose, onUpdate }) {
  const [suggestions, setSuggestions] = useState(null)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [messages, setMessages] = useState([])
  const [editing, setEditing] = useState(null)
  const [editValues, setEditValues] = useState({})

  const linkedProposals = proposals.filter(p => p.contact_id === contact.id?.toString() || p.contact_id === contact.id)

  useEffect(() => {
    getMessages({ contact_id: contact.id, per_page: 20 }).then(data => {
      setMessages(data?.items || [])
    }).catch(() => {})
  }, [contact.id])

  const generateSuggestions = async () => {
    setLoadingSuggestions(true)
    try {
      const data = await getContactSuggestions(contact.id)
      setSuggestions(data.suggestions || [])
    } catch {
      setSuggestions([{ tipo: 'info', titulo: 'Erro', descricao: 'Nao foi possivel gerar sugestoes', prioridade: 'baixa' }])
    }
    setLoadingSuggestions(false)
  }

  const startEdit = (field) => {
    setEditing(field)
    setEditValues({ ...editValues, [field]: contact[field] || '' })
  }

  const saveEdit = async (field) => {
    const value = editValues[field]
    try {
      await updateContact(contact.id, { [field]: value || null })
      onUpdate({ ...contact, [field]: value })
    } catch {}
    setEditing(null)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-lg bg-zinc-950 border-l border-zinc-800 h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 p-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-white">{contact.name || contact.push_name || contact.phone}</h2>
            <p className="text-xs text-zinc-500">{contact.company || contact.phone}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Health Score */}
          <div>
            <p className="text-xs text-zinc-500 mb-1.5">Engagement Score</p>
            <HealthBar score={contact.engagement_score || 0} />
          </div>

          {/* Quick Info Grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Telefone', value: contact.phone },
              { label: 'Email', value: contact.email, field: 'email' },
              { label: 'Receita/mes', value: contact.monthly_revenue, field: 'monthly_revenue' },
              { label: 'Total receita', value: contact.total_revenue, field: 'total_revenue' },
              { label: 'Suporte ate', value: contact.support_ends_at ? new Date(contact.support_ends_at).toLocaleDateString('pt-BR') : null, field: 'support_ends_at' },
              { label: 'Empresa', value: contact.company, field: 'company' },
            ].map(item => (
              <div key={item.label} className="bg-zinc-900/50 rounded-lg p-2.5">
                <p className="text-[10px] text-zinc-600 uppercase tracking-wide">{item.label}</p>
                {editing === item.field ? (
                  <div className="flex gap-1 mt-1">
                    <input
                      value={editValues[item.field] || ''}
                      onChange={(e) => setEditValues({ ...editValues, [item.field]: e.target.value })}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-white w-full"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && saveEdit(item.field)}
                    />
                    <button onClick={() => saveEdit(item.field)} className="text-emerald-400 text-xs">ok</button>
                  </div>
                ) : (
                  <p
                    className={`text-sm ${item.value ? 'text-zinc-300' : 'text-zinc-700'} ${item.field ? 'cursor-pointer hover:text-white' : ''} mt-0.5`}
                    onClick={() => item.field && startEdit(item.field)}
                  >
                    {item.value || '-'}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Next Action */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3">
            <p className="text-[10px] text-zinc-600 uppercase tracking-wide mb-1">Proxima Acao</p>
            {editing === 'next_action' ? (
              <div className="flex gap-1">
                <input
                  value={editValues.next_action || ''}
                  onChange={(e) => setEditValues({ ...editValues, next_action: e.target.value })}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-white"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && saveEdit('next_action')}
                />
                <button onClick={() => saveEdit('next_action')} className="text-emerald-400 text-xs px-2">ok</button>
              </div>
            ) : (
              <p
                className={`text-sm ${contact.next_action ? 'text-zinc-300' : 'text-zinc-700'} cursor-pointer hover:text-white`}
                onClick={() => startEdit('next_action')}
              >
                {contact.next_action || 'Clique para definir...'}
              </p>
            )}
          </div>

          {/* AI Suggestions */}
          <div className="border border-zinc-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between p-3 bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <span className="text-base">🧠</span>
                <span className="text-sm font-medium text-white">Sugestoes IA</span>
              </div>
              <button
                onClick={generateSuggestions}
                disabled={loadingSuggestions}
                className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                {loadingSuggestions ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                    Analisando...
                  </span>
                ) : suggestions ? 'Atualizar' : 'Gerar'}
              </button>
            </div>

            {suggestions && (
              <div className="p-3 space-y-2 border-t border-zinc-800">
                {suggestions.map((s, i) => (
                  <div key={i} className={`rounded-lg p-3 text-xs ${
                    s.prioridade === 'alta' ? 'bg-red-500/5 border border-red-500/20' :
                    s.prioridade === 'media' ? 'bg-yellow-500/5 border border-yellow-500/20' :
                    'bg-zinc-800/50 border border-zinc-800'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span>{SUGGESTION_ICONS[s.tipo] || '💡'}</span>
                      <span className="font-medium text-white">{s.titulo}</span>
                      <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded ${
                        s.prioridade === 'alta' ? 'bg-red-500/20 text-red-400' :
                        s.prioridade === 'media' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-zinc-700 text-zinc-400'
                      }`}>
                        {s.prioridade}
                      </span>
                    </div>
                    <p className="text-zinc-400 leading-relaxed">{s.descricao}</p>
                  </div>
                ))}
              </div>
            )}

            {!suggestions && !loadingSuggestions && (
              <div className="p-4 text-center text-zinc-700 text-xs">
                Clique em "Gerar" para analisar este cliente com IA
              </div>
            )}
          </div>

          {/* Linked Proposals */}
          {linkedProposals.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Propostas ({linkedProposals.length})</p>
              <div className="space-y-2">
                {linkedProposals.map(p => (
                  <a
                    key={p.id}
                    href={`/proposta/${p.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 hover:border-zinc-600 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-white truncate flex-1">{p.title}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ml-2 ${
                        p.status === 'accepted' ? 'bg-emerald-500/15 text-emerald-400' :
                        p.status === 'viewed' ? 'bg-blue-500/15 text-blue-400' :
                        p.status === 'sent' ? 'bg-yellow-500/15 text-yellow-400' :
                        'bg-zinc-800 text-zinc-500'
                      }`}>
                        {p.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[10px] text-zinc-600">
                      <span>{p.total_value}</span>
                      <span>{new Date(p.created_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Recent Messages */}
          {messages.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Ultimas Mensagens</p>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {messages.map(m => (
                  <div key={m.id} className={`text-xs py-1.5 px-2 rounded ${
                    m.direction === 'outgoing' ? 'bg-blue-500/5 text-blue-300 ml-4' : 'bg-zinc-800/50 text-zinc-400 mr-4'
                  }`}>
                    <p className="leading-relaxed">{(m.content || m.transcription || `[${m.message_type}]`)?.slice(0, 200)}</p>
                    <p className="text-[9px] text-zinc-600 mt-0.5">{timeAgo(m.timestamp)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick WhatsApp */}
          <a
            href={`https://wa.me/${contact.phone?.replace(/\D/g, '')}`}
            target="_blank"
            rel="noreferrer"
            className="block w-full text-center bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-3 rounded-xl transition-colors"
          >
            Abrir WhatsApp
          </a>
        </div>
      </div>
    </div>
  )
}

export default function ClientSuccess() {
  const [contacts, setContacts] = useState([])
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedContact, setSelectedContact] = useState(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    Promise.all([getContacts(), getProposals()])
      .then(([c, p]) => {
        // Show all non-group contacts (leads + all pipeline stages)
        const clients = (Array.isArray(c) ? c : []).filter(ct => !ct.is_group)
        setContacts(clients)
        setProposals(Array.isArray(p) ? p : [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleDrop = async (contactId, newStage) => {
    const contact = contacts.find(c => c.id === contactId)
    if (!contact || contact.pipeline_stage === newStage) return

    // Optimistic update
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, pipeline_stage: newStage } : c))

    try {
      await updateContact(contactId, { pipeline_stage: newStage })
    } catch {
      // Rollback
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, pipeline_stage: contact.pipeline_stage } : c))
    }
  }

  const handleUpdateContact = (updated) => {
    setContacts(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
    if (selectedContact?.id === updated.id) {
      setSelectedContact({ ...selectedContact, ...updated })
    }
  }

  const filteredContacts = filter
    ? contacts.filter(c =>
        (c.name || '').toLowerCase().includes(filter.toLowerCase()) ||
        (c.company || '').toLowerCase().includes(filter.toLowerCase()) ||
        (c.phone || '').includes(filter)
      )
    : contacts

  // Stats
  const totalRevenue = contacts.reduce((sum, c) => {
    const val = parseFloat((c.monthly_revenue || '0').replace(/[^\d.,]/g, '').replace(',', '.'))
    return sum + (isNaN(val) ? 0 : val)
  }, 0)
  const needsAttention = contacts.filter(c => c.pipeline_stage === 'attention' || (c.engagement_score || 0) < 30).length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Pos-Venda</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Gestao de clientes ativos</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-emerald-400 text-lg font-bold">
              {totalRevenue > 0 ? `R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}` : '-'}
            </p>
            <p className="text-[10px] text-zinc-600">receita mensal</p>
          </div>
          <div className="text-right">
            <p className={`text-lg font-bold ${needsAttention > 0 ? 'text-red-400' : 'text-zinc-500'}`}>{needsAttention}</p>
            <p className="text-[10px] text-zinc-600">precisam atencao</p>
          </div>
          <div className="text-right">
            <p className="text-white text-lg font-bold">{contacts.length}</p>
            <p className="text-[10px] text-zinc-600">clientes</p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Buscar cliente, empresa ou telefone..."
          className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
        />
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGES.map(stage => (
          <StageColumn
            key={stage.id}
            stage={stage}
            contacts={filteredContacts.filter(c => c.pipeline_stage === stage.id)}
            proposals={proposals}
            onCardClick={setSelectedContact}
            onDrop={handleDrop}
          />
        ))}
      </div>

      {/* Empty state */}
      {contacts.length === 0 && (
        <div className="text-center py-16">
          <p className="text-zinc-500 text-lg mb-2">Nenhum cliente no pos-venda</p>
          <p className="text-zinc-700 text-sm">
            Para adicionar clientes, edite o campo "pipeline_stage" de um contato para: onboarding, building, delivered, maintenance ou attention
          </p>
        </div>
      )}

      {/* Detail Panel */}
      {selectedContact && (
        <DetailPanel
          contact={selectedContact}
          proposals={proposals}
          onClose={() => setSelectedContact(null)}
          onUpdate={handleUpdateContact}
        />
      )}
    </div>
  )
}
