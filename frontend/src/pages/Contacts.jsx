import { useState, useEffect } from 'react'
import { getContacts, getConversation, updateContact } from '../api'
import MessageList from '../components/MessageList'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now - date) / 1000)
  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

const STAGE_LABELS = {
  lead: { label: 'Lead', color: 'bg-blue-500/20 text-blue-400' },
  prospect: { label: 'Prospect', color: 'bg-yellow-500/20 text-yellow-400' },
  client: { label: 'Cliente', color: 'bg-green-500/20 text-green-400' },
  churned: { label: 'Churned', color: 'bg-red-500/20 text-red-400' },
  partner: { label: 'Parceiro', color: 'bg-purple-500/20 text-purple-400' },
}

function ContactCard({ contact, onOpen, onToggleIgnore }) {
  const name = contact.name || contact.push_name || contact.phone || 'Sem nome'
  const initial = name.charAt(0).toUpperCase()
  const stage = STAGE_LABELS[contact.pipeline_stage] || STAGE_LABELS.lead
  const hasActivity = contact.last_message_at && (Date.now() - new Date(contact.last_message_at)) < 7 * 86400000

  return (
    <div
      onClick={() => onOpen(contact)}
      className={`card cursor-pointer hover:border-zinc-600 transition-all ${
        contact.ignored ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
          hasActivity ? 'bg-primary/20 text-primary ring-2 ring-primary/30' : 'bg-zinc-800 text-zinc-400'
        }`}>
          {contact.profile_pic_url ? (
            <img src={contact.profile_pic_url} alt="" className="w-full h-full rounded-full object-cover" />
          ) : initial}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm text-zinc-100 truncate">{name}</span>
            {contact.is_group && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">grupo</span>
            )}
            {contact.ignored && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">ignorado</span>
            )}
          </div>

          {/* Phone + Company */}
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            {contact.phone && <span>{contact.phone}</span>}
            {contact.company && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="text-zinc-400">{contact.company}</span>
              </>
            )}
          </div>

          {/* Tags row */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${stage.color}`}>
              {stage.label}
            </span>
            {contact.tags && contact.tags.slice(0, 3).map((tag, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                {tag}
              </span>
            ))}
            {contact.email && (
              <span className="text-[10px] text-zinc-600 truncate max-w-[140px]">{contact.email}</span>
            )}
          </div>
        </div>

        {/* Right side: stats */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleIgnore(e, contact) }}
            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
              contact.ignored
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'bg-zinc-800/50 text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {contact.ignored ? 'Ativar' : 'Ignorar'}
          </button>

          {contact.message_count > 0 && (
            <span className="text-[11px] text-zinc-500 font-medium">
              {contact.message_count} msgs
            </span>
          )}

          {contact.last_message_at && (
            <span className="text-[10px] text-zinc-600">
              {timeAgo(contact.last_message_at)}
            </span>
          )}

          {contact.engagement_score > 0 && (
            <div className="flex items-center gap-1" title={`Engajamento: ${contact.engagement_score}%`}>
              <div className="w-12 h-1 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    contact.engagement_score > 70 ? 'bg-green-500' :
                    contact.engagement_score > 40 ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(contact.engagement_score, 100)}%` }}
                />
              </div>
              <span className="text-[9px] text-zinc-600">{contact.engagement_score}</span>
            </div>
          )}
        </div>
      </div>

      {/* Notes preview */}
      {contact.notes && (
        <p className="text-[11px] text-zinc-600 mt-2 pl-14 truncate italic">
          📝 {contact.notes}
        </p>
      )}

      {/* Revenue */}
      {(contact.monthly_revenue || contact.total_revenue) && (
        <div className="flex gap-3 mt-1.5 pl-14 text-[10px]">
          {contact.monthly_revenue && (
            <span className="text-green-500">{contact.monthly_revenue}/mês</span>
          )}
          {contact.total_revenue && (
            <span className="text-zinc-500">Total: {contact.total_revenue}</span>
          )}
        </div>
      )}
    </div>
  )
}

export default function Contacts() {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [conversation, setConversation] = useState(null)
  const [selectedContact, setSelectedContact] = useState(null)
  const [convLoading, setConvLoading] = useState(false)
  const [filterStage, setFilterStage] = useState('')
  const [sortBy, setSortBy] = useState('messages')

  const loadContacts = () => {
    getContacts()
      .then((data) => {
        const list = Array.isArray(data) ? data : data.items || data.contacts || []
        setContacts(list)
      })
      .catch((err) => console.error('[Contacts] Load failed:', err))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadContacts() }, [])

  const toggleIgnore = async (e, contact) => {
    e.stopPropagation()
    try {
      await updateContact(contact.id, { ignored: !contact.ignored })
      setContacts((prev) =>
        prev.map((c) => c.id === contact.id ? { ...c, ignored: !c.ignored } : c)
      )
    } catch (err) {
      console.error('[Contacts] Toggle ignore failed:', err)
    }
  }

  const openConversation = async (contact) => {
    setConvLoading(true)
    setSelectedContact(contact)
    try {
      const data = await getConversation(contact.id)
      setConversation(Array.isArray(data) ? data : data.items || data.messages || [])
    } catch (err) {
      console.error('[Contacts] Conversation failed:', err)
      setConversation([])
    }
    setConvLoading(false)
  }

  const closeConversation = () => {
    setConversation(null)
    setSelectedContact(null)
  }

  const filtered = contacts
    .filter((c) => {
      if (filterStage && c.pipeline_stage !== filterStage) return false
      if (!search) return true
      const s = search.toLowerCase()
      return (
        (c.name && c.name.toLowerCase().includes(s)) ||
        (c.phone && c.phone.includes(s)) ||
        (c.push_name && c.push_name.toLowerCase().includes(s)) ||
        (c.company && c.company.toLowerCase().includes(s)) ||
        (c.email && c.email.toLowerCase().includes(s))
      )
    })
    .sort((a, b) => {
      if (sortBy === 'messages') return (b.message_count || 0) - (a.message_count || 0)
      if (sortBy === 'recent') return new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0)
      if (sortBy === 'name') return (a.name || a.phone || '').localeCompare(b.name || b.phone || '')
      return 0
    })

  if (conversation !== null) {
    const sc = selectedContact
    return (
      <div>
        <button
          onClick={closeConversation}
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 mb-4 transition-colors"
        >
          <span>&#8592;</span> Voltar
        </button>

        {/* Contact header */}
        <div className="card mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-lg font-bold text-zinc-300">
              {(sc?.name || sc?.phone || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">
                {sc?.name || sc?.push_name || sc?.phone || 'Contato'}
              </h2>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                {sc?.phone && <span>{sc.phone}</span>}
                {sc?.company && <><span className="text-zinc-700">·</span><span>{sc.company}</span></>}
                {sc?.pipeline_stage && (
                  <span className={`px-1.5 py-0.5 rounded ${(STAGE_LABELS[sc.pipeline_stage] || STAGE_LABELS.lead).color}`}>
                    {(STAGE_LABELS[sc.pipeline_stage] || STAGE_LABELS.lead).label}
                  </span>
                )}
              </div>
            </div>
            <div className="ml-auto text-right text-xs text-zinc-500">
              <div>{sc?.message_count || 0} mensagens</div>
              {sc?.email && <div className="text-zinc-600">{sc.email}</div>}
            </div>
          </div>
        </div>

        {convLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <MessageList messages={conversation} showAsConversation />
        )}
      </div>
    )
  }

  const totalContacts = contacts.length
  const activeContacts = contacts.filter(c => !c.ignored).length
  const recentContacts = contacts.filter(c => c.last_message_at && (Date.now() - new Date(c.last_message_at)) < 7 * 86400000).length

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Contatos</h1>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>{totalContacts} total</span>
          <span className="text-zinc-700">·</span>
          <span className="text-green-500">{activeContacts} ativos</span>
          <span className="text-zinc-700">·</span>
          <span>{recentContacts} recentes (7d)</span>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Buscar por nome, telefone, empresa ou email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input flex-1"
        />
        <select
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          className="input w-32"
        >
          <option value="">Todos</option>
          <option value="lead">Lead</option>
          <option value="prospect">Prospect</option>
          <option value="client">Cliente</option>
          <option value="partner">Parceiro</option>
          <option value="churned">Churned</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="input w-32"
        >
          <option value="messages">Mais msgs</option>
          <option value="recent">Mais recente</option>
          <option value="name">Nome A-Z</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-4xl mb-3">👥</p>
          <p>Nenhum contato encontrado</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((contact) => (
            <ContactCard
              key={contact.id}
              contact={contact}
              onOpen={openConversation}
              onToggleIgnore={toggleIgnore}
            />
          ))}
        </div>
      )}
    </div>
  )
}
