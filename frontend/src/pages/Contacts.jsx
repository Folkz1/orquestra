import { useState, useEffect } from 'react'
import { getContacts, getConversation, updateContact } from '../api'
import MessageList from '../components/MessageList'

export default function Contacts() {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [conversation, setConversation] = useState(null)
  const [selectedContact, setSelectedContact] = useState(null)
  const [convLoading, setConvLoading] = useState(false)

  const loadContacts = () => {
    getContacts()
      .then((data) => {
        const list = Array.isArray(data) ? data : data.items || data.contacts || []
        list.sort((a, b) => (b.message_count || 0) - (a.message_count || 0))
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

  const filtered = contacts.filter((c) => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      (c.name && c.name.toLowerCase().includes(s)) ||
      (c.phone && c.phone.includes(s))
    )
  })

  if (conversation !== null) {
    return (
      <div>
        <button
          onClick={closeConversation}
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 mb-4 transition-colors"
        >
          <span>&#8592;</span> Voltar
        </button>
        <h2 className="text-lg font-semibold mb-4">
          {selectedContact?.name || selectedContact?.phone || 'Contato'}
        </h2>
        {convLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <MessageList messages={conversation} />
        )}
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Contatos</h1>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Buscar contato..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
        />
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
            <div
              key={contact.id}
              onClick={() => openConversation(contact)}
              className={`card cursor-pointer hover:border-zinc-700 transition-colors flex items-center justify-between ${
                contact.ignored ? 'opacity-50' : ''
              }`}
            >
              <div>
                <p className="font-medium text-zinc-100">
                  {contact.name || contact.phone || 'Sem nome'}
                  {contact.ignored && (
                    <span className="ml-2 text-xs text-red-400 font-normal">ignorado</span>
                  )}
                </p>
                {contact.phone && contact.name && (
                  <p className="text-xs text-zinc-500">{contact.phone}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => toggleIgnore(e, contact)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    contact.ignored
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                  }`}
                  title={contact.ignored ? 'Ativar captura' : 'Ignorar contato'}
                >
                  {contact.ignored ? 'Ignorado' : 'Ignorar'}
                </button>
                <div className="text-xs text-zinc-500">
                  {contact.message_count !== undefined && (
                    <span>{contact.message_count} msgs</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
