import { useState, useEffect } from 'react'
import { getWarTasks } from '../api'

const STATUS_COLORS = {
  'Done': 'bg-green-500/20 text-green-400',
  'Concluído': 'bg-green-500/20 text-green-400',
  'Feito': 'bg-green-500/20 text-green-400',
  'In progress': 'bg-blue-500/20 text-blue-400',
  'Em andamento': 'bg-blue-500/20 text-blue-400',
  'Fazendo': 'bg-blue-500/20 text-blue-400',
  'Not started': 'bg-zinc-500/20 text-zinc-400',
  'A fazer': 'bg-zinc-500/20 text-zinc-400',
  'To Do': 'bg-zinc-500/20 text-zinc-400',
}

const PRIORITY_COLORS = {
  'Alta': 'text-red-400',
  'High': 'text-red-400',
  'Urgente': 'text-red-400',
  'Média': 'text-yellow-400',
  'Medium': 'text-yellow-400',
  'Baixa': 'text-zinc-500',
  'Low': 'text-zinc-500',
}

function getStatusColor(status) {
  return STATUS_COLORS[status] || 'bg-purple-500/20 text-purple-400'
}

function getPriorityColor(priority) {
  return PRIORITY_COLORS[priority] || 'text-zinc-400'
}

export default function WarTasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all') // all, active, done

  useEffect(() => {
    loadTasks()
  }, [])

  const loadTasks = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getWarTasks()
      setTasks(data.tasks || [])
    } catch (err) {
      setError(err.message || 'Erro ao carregar War Tasks')
    }
    setLoading(false)
  }

  const filtered = tasks.filter(t => {
    if (filter === 'all') return true
    const s = (t.status || '').toLowerCase()
    const isDone = ['done', 'concluído', 'feito'].some(d => s.includes(d))
    return filter === 'done' ? isDone : !isDone
  })

  // Group by status
  const grouped = {}
  filtered.forEach(t => {
    const key = t.status || 'Sem status'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(t)
  })

  // Sort groups: active first, done last
  const doneStatuses = ['done', 'concluído', 'feito']
  const sortedGroups = Object.entries(grouped).sort(([a], [b]) => {
    const aIsDone = doneStatuses.some(d => a.toLowerCase().includes(d))
    const bIsDone = doneStatuses.some(d => b.toLowerCase().includes(d))
    if (aIsDone && !bIsDone) return 1
    if (!aIsDone && bIsDone) return -1
    return a.localeCompare(b)
  })

  const activeCount = tasks.filter(t => {
    const s = (t.status || '').toLowerCase()
    return !doneStatuses.some(d => s.includes(d))
  }).length

  const doneCount = tasks.length - activeCount

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">War Tasks</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {tasks.length} tasks ({activeCount} ativas, {doneCount} concluidas)
          </p>
        </div>
        <button onClick={loadTasks} disabled={loading} className="btn-primary text-sm">
          {loading ? 'Carregando...' : 'Atualizar'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {[
          { key: 'all', label: 'Todas' },
          { key: 'active', label: 'Ativas' },
          { key: 'done', label: 'Concluidas' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f.key
                ? 'bg-primary/20 text-primary'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="card border border-red-500/30 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-4xl mb-3">📋</p>
          <p>Nenhuma task encontrada</p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedGroups.map(([status, groupTasks]) => (
            <div key={status}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${getStatusColor(status)}`}>
                  {status}
                </span>
                <span className="text-xs text-zinc-600">{groupTasks.length}</span>
              </div>

              <div className="space-y-2">
                {groupTasks.map(task => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TaskCard({ task }) {
  const isDone = ['done', 'concluído', 'feito'].some(d =>
    (task.status || '').toLowerCase().includes(d)
  )

  return (
    <a
      href={task.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`card block hover:bg-zinc-800/70 transition-colors ${isDone ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${isDone ? 'line-through text-zinc-500' : ''}`}>
            {task.title}
          </p>

          <div className="flex flex-wrap gap-2 mt-2">
            {task.priority && (
              <span className={`text-xs ${getPriorityColor(task.priority)}`}>
                {task.priority}
              </span>
            )}
            {task.project && (
              <span className="text-xs bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded">
                {task.project}
              </span>
            )}
            {task.assignee && (
              <span className="text-xs text-zinc-500">
                {task.assignee}
              </span>
            )}
            {task.due_date && (
              <span className="text-xs text-zinc-500">
                {task.due_date}
              </span>
            )}
            {task.tags?.map((tag, i) => (
              <span key={i} className="text-xs bg-zinc-700/50 text-zinc-400 px-1.5 py-0.5 rounded">
                {tag}
              </span>
            ))}
          </div>

          {task.notes && (
            <p className="text-xs text-zinc-600 mt-2 line-clamp-2">{task.notes}</p>
          )}
        </div>

        <span className="text-zinc-700 shrink-0 text-xs">↗</span>
      </div>
    </a>
  )
}
