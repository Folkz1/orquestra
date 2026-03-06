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

function ReviewInfo({ meta }) {
  if (!meta?.review_url && !meta?.review_changes && !meta?.review_files) return null

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50 space-y-1.5">
      {meta.review_url && (
        <a
          href={meta.review_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="flex-shrink-0">🔗</span>
          <span className="truncate">{meta.review_url.replace(/^https?:\/\//, '')}</span>
        </a>
      )}
      {meta.review_changes && (
        <div className="flex items-start gap-1.5 text-xs text-zinc-400">
          <span className="flex-shrink-0 mt-0.5">📝</span>
          <span className="line-clamp-2">{meta.review_changes}</span>
        </div>
      )}
      {meta.review_files && (
        <div className="flex items-start gap-1.5 text-xs text-zinc-500">
          <span className="flex-shrink-0 mt-0.5">📁</span>
          <span className="line-clamp-2">{meta.review_files}</span>
        </div>
      )}
      {meta.review_date && (
        <div className="text-[10px] text-zinc-600 text-right">
          {meta.review_date}
        </div>
      )}
    </div>
  )
}

function TaskCard({ task, onDragStart, onEdit, onDelete }) {
  const priority = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium
  const assignee = ASSIGNEE_LABELS[task.assigned_to] || { label: task.assigned_to, color: 'text-zinc-400' }
  const isReview = task.status === 'review'
  const meta = task.metadata_json || {}

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
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
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

      {/* Review info */}
      {isReview && <ReviewInfo meta={meta} />}

      {/* Done timestamp */}
      {task.status === 'done' && task.completed_at && (
        <div className="mt-2 text-[10px] text-zinc-600">
          Concluido em {new Date(task.completed_at).toLocaleDateString('pt-BR')}
        </div>
      )}
    </div>
  )
}

function KanbanColumn({ column, tasks, onDrop, onDragStart, onEdit, onDelete }) {
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
  const [form, setForm] = useState({
    title: '', description: '', project_id: '', priority: 'medium', assigned_to: 'claude', status: 'backlog',
  })
  const [draggedTask, setDraggedTask] = useState(null)

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

  // Drag and drop
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

      {/* Kanban Board */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2">
          {COLUMNS.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              tasks={tasksByStatus[column.id] || []}
              onDrop={onDrop}
              onDragStart={onDragStart}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
