import { useState, useEffect } from 'react'
import { getTasks, createTask, updateTask, deleteTask, getProjects } from '../api'

const COLUMNS = [
  { id: 'backlog', label: 'Backlog', color: '#6b7280', icon: '📋' },
  { id: 'in_progress', label: 'Em Andamento', color: '#3b82f6', icon: '⚡' },
  { id: 'review', label: 'Review / Teste', color: '#f59e0b', icon: '🔍' },
  { id: 'done', label: 'Concluido', color: '#22c55e', icon: '✅' },
]

const PRIORITY_COLORS = {
  high: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Alta' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Media' },
  low: { bg: 'bg-zinc-700', text: 'text-zinc-400', label: 'Baixa' },
}

const ASSIGNEE_LABELS = {
  claude: { label: 'Claude', color: 'text-purple-400' },
  diego: { label: 'Diego', color: 'text-blue-400' },
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `${diffMin}min atras`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h atras`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return 'ontem'
  if (diffD < 30) return `${diffD}d atras`
  const diffM = Math.floor(diffD / 30)
  if (diffM < 12) return `${diffM} mes${diffM > 1 ? 'es' : ''} atras`
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = (e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={handleCopy}
      className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors flex-shrink-0"
      title="Copiar"
    >
      {copied ? '✓' : '⎘'}
    </button>
  )
}

function CredentialValue({ label, value }) {
  if (!value || typeof value === 'object') return null
  const isUrl = typeof value === 'string' && value.startsWith('http')
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <span className="text-[10px] text-zinc-500 w-24 flex-shrink-0 font-mono uppercase">{label}</span>
      {isUrl ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-blue-400 hover:text-blue-300 truncate flex-1"
          onClick={(e) => e.stopPropagation()}
        >
          {value}
        </a>
      ) : (
        <span className="text-[11px] text-zinc-300 truncate flex-1 font-mono">{value}</span>
      )}
      <CopyButton text={value} />
    </div>
  )
}

function CredentialsSection({ credentials }) {
  if (!credentials || Object.keys(credentials).length === 0) return null

  return (
    <div className="space-y-3">
      {Object.entries(credentials).map(([provider, values]) => {
        if (!values || typeof values !== 'object') return null
        return (
          <div key={provider}>
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500/60" />
              {provider}
            </div>
            <div className="bg-zinc-900/80 rounded-lg p-2 border border-zinc-800/50">
              {Object.entries(values).map(([key, val]) => {
                if (typeof val === 'object' && val !== null) {
                  return Object.entries(val).map(([subKey, subVal]) => (
                    <CredentialValue key={`${key}.${subKey}`} label={`${key}.${subKey}`} value={String(subVal)} />
                  ))
                }
                return <CredentialValue key={key} label={key} value={String(val)} />
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ReviewDetailModal({ task, onClose }) {
  if (!task) return null
  const meta = task.metadata_json || {}
  const creds = task.project_credentials || {}
  const urls = creds.urls || {}
  const easypanel = creds.easypanel || {}
  const github = creds.github || {}

  const productionUrl = meta.review_url || urls.production || urls.frontend || urls.app || ''

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto animate-fade-in shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 p-4 rounded-t-2xl z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-amber-400">🔍</span>
                <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Review / Teste</span>
              </div>
              <h2 className="text-lg font-bold text-zinc-100 leading-snug">{task.title}</h2>
              {task.project_name && (
                <span
                  className="inline-block text-xs px-2 py-0.5 rounded-md mt-1.5 font-medium"
                  style={{
                    backgroundColor: (task.project_color || '#3b82f6') + '20',
                    color: task.project_color || '#3b82f6',
                  }}
                >
                  {task.project_name}
                </span>
              )}
            </div>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-1 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Quick Access - Production URL */}
          {productionUrl && (
            <a
              href={productionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl hover:bg-blue-500/15 transition-colors group"
            >
              <span className="text-2xl">🌐</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-blue-400 font-semibold uppercase tracking-wider">Abrir em Producao</div>
                <div className="text-sm text-blue-300 truncate group-hover:text-blue-200">{productionUrl}</div>
              </div>
              <svg className="w-5 h-5 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}

          {/* EasyPanel Quick Access */}
          {easypanel.server_url && (
            <a
              href={easypanel.server_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl hover:bg-purple-500/15 transition-colors group"
            >
              <span className="text-2xl">⚙️</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-purple-400 font-semibold uppercase tracking-wider">EasyPanel Dashboard</div>
                <div className="text-sm text-purple-300 truncate group-hover:text-purple-200">
                  {easypanel.project}/{easypanel.service || easypanel.backend_service || '...'}
                </div>
              </div>
              <svg className="w-5 h-5 text-purple-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}

          {/* GitHub Quick Access */}
          {github.repo && (
            <a
              href={`https://github.com/${github.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-zinc-800/80 border border-zinc-700/50 rounded-xl hover:bg-zinc-800 transition-colors group"
            >
              <span className="text-2xl">🐙</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-400 font-semibold uppercase tracking-wider">GitHub Repo</div>
                <div className="text-sm text-zinc-300 truncate group-hover:text-zinc-200">{github.repo} ({github.branch || 'main'})</div>
              </div>
              <svg className="w-5 h-5 text-zinc-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}

          {/* What Changed */}
          {(meta.review_changes || meta.review_files) && (
            <div className="bg-zinc-800/50 rounded-xl p-3 border border-zinc-700/30">
              <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <span>📝</span> O que mudou
              </div>
              {meta.review_changes && (
                <p className="text-sm text-zinc-200 mb-1.5">{meta.review_changes}</p>
              )}
              {meta.review_files && (
                <p className="text-xs text-zinc-500 font-mono">{meta.review_files}</p>
              )}
              {meta.review_date && (
                <p className="text-[10px] text-zinc-600 mt-1.5">Commit em {meta.review_date}</p>
              )}
            </div>
          )}

          {/* Description */}
          {task.description && (
            <div className="bg-zinc-800/50 rounded-xl p-3 border border-zinc-700/30">
              <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <span>📄</span> Descricao
              </div>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* All Credentials / ENV */}
          {Object.keys(creds).length > 0 && (
            <div className="bg-zinc-800/50 rounded-xl p-3 border border-zinc-700/30">
              <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <span>🔑</span> Credenciais / ENV do Projeto
              </div>
              <CredentialsSection credentials={creds} />
            </div>
          )}

          {/* Task Info */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-zinc-800/30 rounded-lg p-2.5">
              <span className="text-zinc-500 block mb-0.5">Prioridade</span>
              <span className={`font-medium ${PRIORITY_COLORS[task.priority]?.text || 'text-zinc-300'}`}>
                {PRIORITY_COLORS[task.priority]?.label || task.priority}
              </span>
            </div>
            <div className="bg-zinc-800/30 rounded-lg p-2.5">
              <span className="text-zinc-500 block mb-0.5">Responsavel</span>
              <span className={`font-medium ${ASSIGNEE_LABELS[task.assigned_to]?.color || 'text-zinc-300'}`}>
                {ASSIGNEE_LABELS[task.assigned_to]?.label || task.assigned_to}
              </span>
            </div>
            <div className="bg-zinc-800/30 rounded-lg p-2.5">
              <span className="text-zinc-500 block mb-0.5">Fonte</span>
              <span className="text-zinc-300 font-mono">{task.source}</span>
            </div>
            <div className="bg-zinc-800/30 rounded-lg p-2.5">
              <span className="text-zinc-500 block mb-0.5">Criada em</span>
              <span className="text-zinc-300">{new Date(task.created_at).toLocaleDateString('pt-BR')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MobileStatusButtons({ task, onStatusChange }) {
  const nextStatuses = COLUMNS.filter((col) => col.id !== task.status)
  return (
    <div className="flex gap-1.5 mt-2 pt-2 border-t border-zinc-700/50 sm:hidden">
      {nextStatuses.map((col) => (
        <button
          key={col.id}
          onClick={(e) => { e.stopPropagation(); onStatusChange(task.id, col.id) }}
          className="flex-1 text-[10px] font-medium py-1.5 rounded-lg border border-zinc-700/50 bg-zinc-800/50 text-zinc-400 active:bg-zinc-700 transition-colors"
        >
          {col.icon} {col.label.split(' ')[0]}
        </button>
      ))}
    </div>
  )
}

function TaskCard({ task, onDragStart, onEdit, onDelete, onOpenReview, onStatusChange }) {
  const priority = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium
  const assignee = ASSIGNEE_LABELS[task.assigned_to] || { label: task.assigned_to, color: 'text-zinc-400' }
  const isReview = task.status === 'review'
  const meta = task.metadata_json || {}
  const creds = task.project_credentials || {}
  const urls = creds.urls || {}
  const reviewUrl = meta.review_url || urls.production || urls.frontend || ''

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      className={`bg-zinc-800/80 rounded-lg p-3 mb-2 cursor-grab active:cursor-grabbing border transition-all group hover:shadow-lg hover:shadow-black/20 ${
        isReview
          ? 'border-amber-500/30 hover:border-amber-500/50'
          : 'border-zinc-700/50 hover:border-zinc-600'
      }`}
    >
      {/* Header: title + actions */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-zinc-100 font-medium leading-snug flex-1">
          {task.title}
        </p>
        <div className="flex gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(task) }}
            className="text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-700/50 transition-colors"
            title="Editar"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(task) }}
            className="text-zinc-500 hover:text-red-400 p-1 rounded hover:bg-red-500/10 transition-colors"
            title="Excluir"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-zinc-500 mt-1.5 line-clamp-2 leading-relaxed">{task.description}</p>
      )}

      {/* Badges row */}
      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
        <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium ${priority.bg} ${priority.text}`}>
          {priority.label}
        </span>
        <span className={`text-[11px] font-medium ${assignee.color}`}>
          {assignee.label}
        </span>
        {task.project_name && (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded-md font-medium"
            style={{
              backgroundColor: (task.project_color || '#3b82f6') + '15',
              color: task.project_color || '#3b82f6',
            }}
          >
            {task.project_name}
          </span>
        )}
        {task.source === 'backlog' && (
          <span className="text-[10px] text-zinc-600 font-mono">BACKLOG</span>
        )}
      </div>

      {/* Review quick info + open detail button */}
      {isReview && (
        <div className="mt-2.5 pt-2 border-t border-zinc-700/50">
          {reviewUrl && (
            <a
              href={reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors mb-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <span>🌐</span>
              <span className="truncate">{reviewUrl.replace(/^https?:\/\//, '')}</span>
            </a>
          )}
          {meta.review_changes && (
            <p className="text-xs text-zinc-500 mb-2 line-clamp-1">📝 {meta.review_changes}</p>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onOpenReview(task) }}
            className="w-full text-xs font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg py-1.5 px-3 transition-colors flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Abrir Review Completo
          </button>
        </div>
      )}

      {/* Timestamps */}
      <div className="flex items-center gap-2 mt-2 text-[10px] text-zinc-600">
        {task.status === 'done' && task.completed_at ? (
          <span title={new Date(task.completed_at).toLocaleString('pt-BR')}>
            Concluido {timeAgo(task.completed_at)}
          </span>
        ) : (
          <>
            <span title={new Date(task.created_at).toLocaleString('pt-BR')}>
              Criada {timeAgo(task.created_at)}
            </span>
            {task.updated_at && task.updated_at !== task.created_at && (
              <>
                <span className="text-zinc-700">·</span>
                <span title={new Date(task.updated_at).toLocaleString('pt-BR')}>
                  Atualizada {timeAgo(task.updated_at)}
                </span>
              </>
            )}
          </>
        )}
      </div>

      {onStatusChange && <MobileStatusButtons task={task} onStatusChange={onStatusChange} />}
    </div>
  )
}

function KanbanColumn({ column, tasks, onDrop, onDragStart, onEdit, onDelete, onOpenReview }) {
  const [isDragOver, setIsDragOver] = useState(false)
  const count = tasks.length

  return (
    <div
      className={`flex-1 min-w-[280px] max-w-[340px] transition-all ${isDragOver ? 'scale-[1.01]' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        setIsDragOver(false)
        onDrop(e, column.id)
      }}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="text-sm">{column.icon}</span>
        <h3 className="text-sm font-semibold text-zinc-300">{column.label}</h3>
        <span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded-full ml-auto font-mono">
          {count}
        </span>
      </div>

      {/* Column body */}
      <div
        className={`rounded-xl p-2 min-h-[300px] border transition-all ${
          isDragOver
            ? 'border-primary/40 bg-primary/5'
            : 'border-zinc-800/50 bg-zinc-900/30'
        }`}
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onDragStart={onDragStart}
            onEdit={onEdit}
            onDelete={onDelete}
            onOpenReview={onOpenReview}
          />
        ))}
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-700">
            <span className="text-2xl mb-2 opacity-50">{column.icon}</span>
            <p className="text-xs">Arraste tasks aqui</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Kanban() {
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [projectFilter, setProjectFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [reviewTask, setReviewTask] = useState(null)
  const [form, setForm] = useState({
    title: '', description: '', project_id: '', priority: 'medium', assigned_to: 'claude', status: 'backlog',
  })
  const [draggedTask, setDraggedTask] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')

  const loadData = async () => {
    setLoading(true)
    try {
      const [taskData, projectData] = await Promise.all([
        getTasks(projectFilter ? { project_id: projectFilter } : {}),
        getProjects(),
      ])
      setTasks(Array.isArray(taskData) ? taskData : [])
      const pList = Array.isArray(projectData) ? projectData : projectData.items || projectData.projects || []
      setProjects(pList)
    } catch (err) {
      console.error('[Kanban] Load failed:', err)
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [projectFilter])

  const openCreate = () => {
    setEditingTask(null)
    setForm({ title: '', description: '', project_id: '', priority: 'medium', assigned_to: 'claude', status: 'backlog' })
    setShowForm(true)
  }

  const openEdit = (task) => {
    setEditingTask(task)
    setForm({
      title: task.title,
      description: task.description || '',
      project_id: task.project_id || '',
      priority: task.priority,
      assigned_to: task.assigned_to,
      status: task.status,
    })
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      project_id: form.project_id || null,
      priority: form.priority,
      assigned_to: form.assigned_to,
      status: form.status,
    }

    try {
      if (editingTask) {
        await updateTask(editingTask.id, payload)
      } else {
        await createTask(payload)
      }
      setShowForm(false)
      await loadData()
    } catch (err) {
      console.error('[Kanban] Save failed:', err)
    }
  }

  const handleDelete = async (task) => {
    if (!confirm(`Excluir "${task.title}"?`)) return
    try {
      await deleteTask(task.id)
      await loadData()
    } catch (err) {
      console.error('[Kanban] Delete failed:', err)
    }
  }

  const handleStatusChange = async (taskId, newStatus) => {
    try {
      await updateTask(taskId, { status: newStatus })
      await loadData()
    } catch (err) {
      console.error('[Kanban] Status change failed:', err)
    }
  }

  const onDragStart = (e, task) => {
    setDraggedTask(task)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDrop = async (e, targetStatus) => {
    e.preventDefault()
    if (!draggedTask || draggedTask.status === targetStatus) {
      setDraggedTask(null)
      return
    }
    await handleStatusChange(draggedTask.id, targetStatus)
    setDraggedTask(null)
  }

  const tasksByStatus = {}
  COLUMNS.forEach((col) => {
    tasksByStatus[col.id] = tasks.filter((t) => t.status === col.id)
  })

  const totals = {
    total: tasks.length,
    backlog: tasksByStatus.backlog?.length || 0,
    in_progress: tasksByStatus.in_progress?.length || 0,
    review: tasksByStatus.review?.length || 0,
    done: tasksByStatus.done?.length || 0,
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Kanban</h1>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs text-zinc-500">{totals.total} tasks</span>
            <span className="text-xs text-zinc-600">|</span>
            <div className="flex items-center gap-2">
              {totals.in_progress > 0 && (
                <span className="text-[11px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                  {totals.in_progress} em andamento
                </span>
              )}
              {totals.review > 0 && (
                <span className="text-[11px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                  {totals.review} p/ review
                </span>
              )}
              {totals.done > 0 && (
                <span className="text-[11px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                  {totals.done} concluidas
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="select text-sm"
          >
            <option value="">Todos projetos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button onClick={openCreate} className="btn-primary text-sm">
            + Nova Task
          </button>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="card w-full max-w-md animate-fade-in shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4 text-zinc-100">
              {editingTask ? 'Editar Task' : 'Nova Task'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block font-medium uppercase tracking-wide">Titulo</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="input"
                  placeholder="O que precisa ser feito?"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block font-medium uppercase tracking-wide">Descricao</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="input resize-none"
                  rows={3}
                  placeholder="Detalhes, contexto, links..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block font-medium uppercase tracking-wide">Projeto</label>
                  <select
                    value={form.project_id}
                    onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                    className="select"
                  >
                    <option value="">Sem projeto</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block font-medium uppercase tracking-wide">Prioridade</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className="select"
                  >
                    <option value="high">Alta</option>
                    <option value="medium">Media</option>
                    <option value="low">Baixa</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block font-medium uppercase tracking-wide">Responsavel</label>
                  <select
                    value={form.assigned_to}
                    onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
                    className="select"
                  >
                    <option value="claude">Claude</option>
                    <option value="diego">Diego</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block font-medium uppercase tracking-wide">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="select"
                  >
                    {COLUMNS.map((col) => (
                      <option key={col.id} value={col.id}>{col.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" className="btn-primary flex-1">
                  {editingTask ? 'Salvar' : 'Criar'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review Detail Modal */}
      <ReviewDetailModal task={reviewTask} onClose={() => setReviewTask(null)} />

      {/* Mobile: Status filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-3 sm:hidden">
        <button
          onClick={() => setStatusFilter('all')}
          className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            statusFilter === 'all' ? 'bg-white/15 text-white' : 'bg-zinc-800/80 text-zinc-400'
          }`}
        >
          Todas ({totals.total})
        </button>
        {COLUMNS.map((col) => (
          <button
            key={col.id}
            onClick={() => setStatusFilter(col.id)}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === col.id ? 'bg-white/15 text-white' : 'bg-zinc-800/80 text-zinc-400'
            }`}
          >
            {col.icon} {col.label.split('/')[0].trim()} ({tasksByStatus[col.id]?.length || 0})
          </button>
        ))}
      </div>

      {/* Kanban Board */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Mobile: Vertical list */}
          <div className="space-y-2 sm:hidden">
            {(statusFilter === 'all' ? tasks : tasksByStatus[statusFilter] || []).map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onDragStart={onDragStart}
                onEdit={openEdit}
                onDelete={handleDelete}
                onOpenReview={setReviewTask}
                onStatusChange={handleStatusChange}
              />
            ))}
            {(statusFilter === 'all' ? tasks : tasksByStatus[statusFilter] || []).length === 0 && (
              <p className="text-center text-sm text-zinc-600 py-8">Nenhuma task neste filtro</p>
            )}
          </div>

          {/* Desktop: Kanban columns */}
          <div className="hidden sm:flex gap-4 overflow-x-auto pb-4 -mx-2 px-2">
            {COLUMNS.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                tasks={tasksByStatus[column.id] || []}
                onDrop={onDrop}
                onDragStart={onDragStart}
                onEdit={openEdit}
                onDelete={handleDelete}
                onOpenReview={setReviewTask}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
