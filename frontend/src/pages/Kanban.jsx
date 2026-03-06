import { useState, useEffect } from 'react'
import { getTasks, createTask, updateTask, deleteTask, getProjects } from '../api'

const COLUMNS = [
  { id: 'backlog', label: 'Backlog', color: '#6b7280' },
  { id: 'in_progress', label: 'Em Andamento', color: '#3b82f6' },
  { id: 'review', label: 'Review / Teste', color: '#f59e0b' },
  { id: 'done', label: 'Concluido', color: '#22c55e' },
]

const PRIORITY_COLORS = {
  high: 'bg-red-500/20 text-red-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-zinc-700 text-zinc-400',
}

const ASSIGNEE_LABELS = {
  claude: 'Claude',
  diego: 'Diego',
}

function TaskCard({ task, onDragStart, onEdit, onDelete, onStatusChange }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      className="bg-zinc-800 rounded-lg p-3 mb-2 cursor-grab active:cursor-grabbing border border-zinc-700 hover:border-zinc-600 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-zinc-100 font-medium leading-tight flex-1">{task.title}</p>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(task) }}
            className="text-xs text-zinc-500 hover:text-zinc-300 p-1"
            title="Editar"
          >
            E
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(task) }}
            className="text-xs text-red-500 hover:text-red-300 p-1"
            title="Excluir"
          >
            X
          </button>
        </div>
      </div>

      {task.description && (
        <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{task.description}</p>
      )}

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span className={`text-xs px-1.5 py-0.5 rounded ${PRIORITY_COLORS[task.priority]}`}>
          {task.priority}
        </span>
        <span className="text-xs text-zinc-500">
          {ASSIGNEE_LABELS[task.assigned_to] || task.assigned_to}
        </span>
        {task.project_name && (
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: (task.project_color || '#3b82f6') + '20',
              color: task.project_color || '#3b82f6',
            }}
          >
            {task.project_name}
          </span>
        )}
        {task.source === 'backlog' && (
          <span className="text-xs text-zinc-600">BACKLOG</span>
        )}
      </div>
    </div>
  )
}

function KanbanColumn({ column, tasks, onDrop, onDragOver, onDragStart, onEdit, onDelete, onStatusChange }) {
  const count = tasks.length

  return (
    <div
      className="flex-1 min-w-[260px]"
      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('bg-zinc-800/30') }}
      onDragLeave={(e) => { e.currentTarget.classList.remove('bg-zinc-800/30') }}
      onDrop={(e) => {
        e.currentTarget.classList.remove('bg-zinc-800/30')
        onDrop(e, column.id)
      }}
    >
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: column.color }} />
        <h3 className="text-sm font-semibold text-zinc-300">{column.label}</h3>
        <span className="text-xs text-zinc-600 ml-auto">{count}</span>
      </div>

      <div className="rounded-lg p-2 min-h-[200px] border border-zinc-800 transition-colors">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onDragStart={onDragStart}
            onEdit={onEdit}
            onDelete={onDelete}
            onStatusChange={onStatusChange}
          />
        ))}
        {tasks.length === 0 && (
          <p className="text-xs text-zinc-700 text-center py-8">Arraste tasks aqui</p>
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
    done: tasksByStatus.done?.length || 0,
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Kanban</h1>
          <p className="text-xs text-zinc-500 mt-1">
            {totals.total} tasks | {totals.done} concluidas
          </p>
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
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="card w-full max-w-md animate-fade-in">
            <h2 className="text-lg font-semibold mb-4">
              {editingTask ? 'Editar Task' : 'Nova Task'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Titulo *</label>
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
                <label className="text-sm text-zinc-400 mb-1 block">Descricao</label>
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
                  <label className="text-sm text-zinc-400 mb-1 block">Projeto</label>
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
                  <label className="text-sm text-zinc-400 mb-1 block">Prioridade</label>
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
                  <label className="text-sm text-zinc-400 mb-1 block">Responsavel</label>
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
                  <label className="text-sm text-zinc-400 mb-1 block">Status</label>
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
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              tasks={tasksByStatus[column.id] || []}
              onDrop={onDrop}
              onDragOver={() => {}}
              onDragStart={onDragStart}
              onEdit={openEdit}
              onDelete={handleDelete}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
