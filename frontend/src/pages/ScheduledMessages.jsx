import { useEffect, useState } from 'react'
import {
  getScheduledMessages,
  createScheduledMessage,
  updateScheduledMessage,
  deleteScheduledMessage,
  retryScheduledMessage,
  getContacts,
} from '../api'

const STATUS_BADGES = {
  pending: 'badge-blue',
  sent: 'badge-green',
  failed: 'badge-red',
  cancelled: 'badge-yellow',
}

const STATUS_LABELS = {
  pending: 'Pendente',
  sent: 'Enviada',
  failed: 'Falhou',
  cancelled: 'Cancelada',
}

function formatDateLocal(isoString) {
  if (!isoString) return '-'
  const d = new Date(isoString)
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function timeUntil(isoString) {
  if (!isoString) return ''
  const diff = new Date(isoString) - new Date()
  if (diff <= 0) return 'agora'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `em ${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `em ${hours}h ${mins % 60}min`
  const days = Math.floor(hours / 24)
  return `em ${days}d ${hours % 24}h`
}

function toLocalDatetimeValue(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  const offset = d.getTimezoneOffset()
  const local = new Date(d.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

function localDatetimeToUTC(localStr) {
  if (!localStr) return ''
  return new Date(localStr).toISOString()
}

const EMPTY_FORM = {
  phone: '',
  message_text: '',
  scheduled_for: '',
  evolution_instance: 'guyfolkiz',
}

export default function ScheduledMessages() {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [contacts, setContacts] = useState([])
  const [now, setNow] = useState(new Date())

  const loadMessages = async () => {
    setLoading(true)
    try {
      const params = {}
      if (filter !== 'all') params.status = filter
      const data = await getScheduledMessages(params)
      setMessages(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('[SCHEDULED] Failed to load:', err)
    }
    setLoading(false)
  }

  const loadContacts = async () => {
    try {
      const data = await getContacts()
      const items = Array.isArray(data) ? data : data.items || []
      setContacts(items.filter((c) => c.phone))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadMessages()
    loadContacts()
  }, [filter])

  // Update "time until" every 30s
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(interval)
  }, [])

  const openCreate = () => {
    setEditingId(null)
    // Default to 1 hour from now
    const defaultTime = new Date(Date.now() + 3600000)
    setForm({
      ...EMPTY_FORM,
      scheduled_for: toLocalDatetimeValue(defaultTime.toISOString()),
    })
    setShowForm(true)
  }

  const openEdit = (msg) => {
    setEditingId(msg.id)
    setForm({
      phone: msg.phone,
      message_text: msg.message_text,
      scheduled_for: toLocalDatetimeValue(msg.scheduled_for),
      evolution_instance: msg.evolution_instance || 'guyfolkiz',
    })
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const payload = {
        phone: form.phone.replace(/\D/g, ''),
        message_text: form.message_text,
        scheduled_for: localDatetimeToUTC(form.scheduled_for),
        evolution_instance: form.evolution_instance || 'guyfolkiz',
      }
      if (editingId) {
        await updateScheduledMessage(editingId, payload)
      } else {
        await createScheduledMessage(payload)
      }
      setShowForm(false)
      await loadMessages()
    } catch (err) {
      console.error('[SCHEDULED] Save failed:', err)
      alert('Erro ao salvar: ' + (err.data?.detail || err.message))
    }
    setSubmitting(false)
  }

  const handleCancel = async (id) => {
    if (!confirm('Cancelar esta mensagem agendada?')) return
    try {
      await updateScheduledMessage(id, { status: 'cancelled' })
      await loadMessages()
    } catch (err) {
      console.error('[SCHEDULED] Cancel failed:', err)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Excluir permanentemente?')) return
    try {
      await deleteScheduledMessage(id)
      await loadMessages()
    } catch (err) {
      console.error('[SCHEDULED] Delete failed:', err)
      alert('Erro: ' + (err.data?.detail || err.message))
    }
  }

  const handleRetry = async (id) => {
    try {
      await retryScheduledMessage(id)
      await loadMessages()
    } catch (err) {
      console.error('[SCHEDULED] Retry failed:', err)
      alert('Erro ao reenviar: ' + (err.data?.detail || err.message))
    }
  }

  const selectContact = (contact) => {
    setForm((f) => ({ ...f, phone: contact.phone }))
  }

  const pendingCount = messages.filter((m) => m.status === 'pending').length
  const sentCount = messages.filter((m) => m.status === 'sent').length
  const failedCount = messages.filter((m) => m.status === 'failed').length

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Mensagens Agendadas</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {pendingCount} pendente{pendingCount !== 1 ? 's' : ''} · {sentCount} enviada{sentCount !== 1 ? 's' : ''}{failedCount > 0 ? ` · ${failedCount} falha${failedCount !== 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <span>+</span> Nova Mensagem
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {[
          { key: 'all', label: 'Todas' },
          { key: 'pending', label: 'Pendentes' },
          { key: 'sent', label: 'Enviadas' },
          { key: 'failed', label: 'Falhas' },
          { key: 'cancelled', label: 'Canceladas' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              filter === f.key
                ? 'bg-primary/20 text-primary font-medium'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center text-zinc-500 py-12">Carregando...</div>
      )}

      {/* Empty state */}
      {!loading && messages.length === 0 && (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📅</div>
          <p className="text-zinc-400">Nenhuma mensagem agendada</p>
          <button onClick={openCreate} className="btn-primary mt-4">
            Agendar primeira mensagem
          </button>
        </div>
      )}

      {/* Messages list */}
      {!loading && messages.length > 0 && (
        <div className="space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Phone + status */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white font-semibold text-sm">
                      {msg.contact_name || msg.phone}
                    </span>
                    {msg.contact_name && (
                      <span className="text-xs text-zinc-500">{msg.phone}</span>
                    )}
                    <span className={`badge ${STATUS_BADGES[msg.status] || 'badge-blue'}`}>
                      {STATUS_LABELS[msg.status] || msg.status}
                    </span>
                  </div>

                  {/* Message preview */}
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap line-clamp-3 mb-2">
                    {msg.message_text}
                  </p>

                  {/* Time info */}
                  <div className="flex items-center gap-4 text-xs text-zinc-500">
                    <span>Agendada: {formatDateLocal(msg.scheduled_for)}</span>
                    {msg.status === 'pending' && (
                      <span className="text-blue-400 font-medium">
                        {timeUntil(msg.scheduled_for)}
                      </span>
                    )}
                    {msg.sent_at && (
                      <span className="text-green-400">
                        Enviada: {formatDateLocal(msg.sent_at)}
                      </span>
                    )}
                    {msg.error_message && (
                      <span className="text-red-400 block mt-1" title={msg.error_message}>
                        Erro: {msg.error_message.slice(0, 120)}
                      </span>
                    )}
                    {msg.evolution_instance && (
                      <span>via {msg.evolution_instance}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {msg.status === 'pending' && (
                    <>
                      <button
                        onClick={() => openEdit(msg)}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleCancel(msg.id)}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 text-yellow-400 hover:bg-yellow-500/20"
                      >
                        Cancelar
                      </button>
                    </>
                  )}
                  {msg.status === 'failed' && (
                    <button
                      onClick={() => handleRetry(msg.id)}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 text-blue-400 hover:bg-blue-500/20 font-medium"
                    >
                      Reenviar
                    </button>
                  )}
                  {msg.status !== 'sent' && (
                    <button
                      onClick={() => handleDelete(msg.id)}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 text-red-400 hover:bg-red-500/20"
                    >
                      Excluir
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setShowForm(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-white mb-4">
              {editingId ? 'Editar Mensagem' : 'Nova Mensagem Agendada'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Phone */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Telefone (com DDD e pais)
                </label>
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="5541999999999"
                  required
                />
                {/* Quick contact selection */}
                {!editingId && contacts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {contacts.slice(0, 8).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectContact(c)}
                        className={`text-xs px-2 py-1 rounded-md transition-colors ${
                          form.phone === c.phone
                            ? 'bg-primary/20 text-primary'
                            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {c.name || c.push_name || c.phone}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Scheduled for */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Data e hora do envio
                </label>
                <input
                  type="datetime-local"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  value={form.scheduled_for}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, scheduled_for: e.target.value }))
                  }
                  required
                />
              </div>

              {/* Instance */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Instancia Evolution
                </label>
                <select
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  value={form.evolution_instance}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, evolution_instance: e.target.value }))
                  }
                >
                  <option value="guyfolkiz">guyfolkiz (trabalho)</option>
                  <option value="teste">teste (pessoal)</option>
                </select>
              </div>

              {/* Message */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Mensagem
                </label>
                <textarea
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:border-primary focus:outline-none min-h-[160px] resize-y"
                  value={form.message_text}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, message_text: e.target.value }))
                  }
                  placeholder="Texto da mensagem..."
                  required
                />
                <p className="text-xs text-zinc-600 mt-1">
                  {form.message_text.length} caracteres
                  {form.message_text.length > 4000 && (
                    <span className="text-red-400 ml-2">
                      WhatsApp limita ~4000 caracteres
                    </span>
                  )}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-6 py-2 rounded-lg font-medium"
                >
                  {submitting
                    ? 'Salvando...'
                    : editingId
                    ? 'Salvar'
                    : 'Agendar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
