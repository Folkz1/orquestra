import { useState, useEffect, useCallback } from 'react'
import { getMessages, getProjects, getContacts, getConversation } from '../api'
import MessageList from '../components/MessageList'

export default function Dashboard() {
  const [messages, setMessages] = useState([])
  const [projects, setProjects] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [totalPages, setTotalPages] = useState(1)

  // Filters
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [contactFilter, setContactFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  // Conversation mode
  const [conversation, setConversation] = useState(null)
  const [conversationContact, setConversationContact] = useState(null)

  const perPage = 20

  // Load filter data
  useEffect(() => {
    Promise.allSettled([
      getProjects(),
      getContacts(),
    ]).then(([projRes, contRes]) => {
      if (projRes.status === 'fulfilled') {
        const data = projRes.value
        setProjects(Array.isArray(data) ? data : data.projects || [])
      }
      if (contRes.status === 'fulfilled') {
        const data = contRes.value
        setContacts(Array.isArray(data) ? data : data.contacts || [])
      }
    })
  }, [])

  // Load messages
  const loadMessages = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        page,
        per_page: perPage,
      }
      if (search) params.search = search
      if (projectFilter) params.project_id = projectFilter
      if (contactFilter) params.contact_id = contactFilter
      if (typeFilter) params.type = typeFilter
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo

      const data = await getMessages(params)
      setMessages(Array.isArray(data) ? data : data.messages || [])
      setTotalPages(data.total_pages || 1)
    } catch (err) {
      console.error('[Dashboard] Failed to load messages:', err)
      setMessages([])
    }
    setLoading(false)
  }, [search, projectFilter, contactFilter, typeFilter, dateFrom, dateTo, page])

  useEffect(() => {
    if (!conversation) {
      loadMessages()
    }
  }, [loadMessages, conversation])

  // Debounced search
  const [searchInput, setSearchInput] = useState('')
  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(timeout)
  }, [searchInput])

  // Load conversation
  const openConversation = async (contactId) => {
    try {
      const contact = contacts.find((c) => c.id === contactId)
      setConversationContact(contact || { name: 'Contato' })
      const data = await getConversation(contactId)
      setConversation(Array.isArray(data) ? data : data.messages || [])
    } catch (err) {
      console.error('[Dashboard] Failed to load conversation:', err)
    }
  }

  const closeConversation = () => {
    setConversation(null)
    setConversationContact(null)
  }

  // Conversation view
  if (conversation) {
    return (
      <div>
        <button
          onClick={closeConversation}
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 mb-4 transition-colors"
        >
          <span>&#8592;</span> Voltar
        </button>
        <h2 className="text-lg font-semibold mb-4">
          Conversa com {conversationContact?.name || conversationContact?.phone || 'Contato'}
        </h2>
        <MessageList messages={conversation} />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Dashboard</h1>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Buscar mensagens..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="input"
        />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
        <select
          value={projectFilter}
          onChange={(e) => { setProjectFilter(e.target.value); setPage(1) }}
          className="select text-sm"
        >
          <option value="">Todos projetos</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          value={contactFilter}
          onChange={(e) => { setContactFilter(e.target.value); setPage(1) }}
          className="select text-sm"
        >
          <option value="">Todos contatos</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>{c.name || c.phone}</option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
          className="select text-sm"
        >
          <option value="">Todos tipos</option>
          <option value="text">Texto</option>
          <option value="audio">Audio</option>
          <option value="image">Imagem</option>
        </select>

        <div className="flex gap-2 col-span-2 md:col-span-1">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            className="input text-xs flex-1"
            placeholder="De"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            className="input text-xs flex-1"
            placeholder="Ate"
          />
        </div>
      </div>

      {/* Messages */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <MessageList messages={messages} onContactClick={openConversation} />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-secondary text-sm disabled:opacity-30"
          >
            Anterior
          </button>
          <span className="text-sm text-zinc-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="btn-secondary text-sm disabled:opacity-30"
          >
            Proximo
          </button>
        </div>
      )}
    </div>
  )
}
