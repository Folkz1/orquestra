import { useState, useEffect } from 'react'
import { getProjects, createProject, updateProject, deleteProject } from '../api'
import ProjectCard from '../components/ProjectCard'

const COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
]

const emptyForm = {
  name: '',
  description: '',
  keywords: '',
  color: '#22c55e',
  status: 'active',
}

export default function Projects() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [submitting, setSubmitting] = useState(false)

  const loadProjects = async () => {
    setLoading(true)
    try {
      const data = await getProjects()
      setProjects(Array.isArray(data) ? data : data.projects || [])
    } catch (err) {
      console.error('[Projects] Failed to load:', err)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadProjects()
  }, [])

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...emptyForm })
    setShowForm(true)
  }

  const openEdit = (project) => {
    setEditingId(project.id)
    setForm({
      name: project.name || '',
      description: project.description || '',
      keywords: Array.isArray(project.keywords)
        ? project.keywords.join(', ')
        : project.keywords || '',
      color: project.color || '#22c55e',
      status: project.status || 'active',
    })
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm({ ...emptyForm })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return

    setSubmitting(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        keywords: form.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
        color: form.color,
        status: form.status,
      }

      if (editingId) {
        await updateProject(editingId, payload)
      } else {
        await createProject(payload)
      }

      closeForm()
      await loadProjects()
    } catch (err) {
      console.error('[Projects] Save failed:', err)
    }
    setSubmitting(false)
  }

  const handleDelete = async (project) => {
    if (!confirm(`Excluir projeto "${project.name}"?`)) return

    try {
      await deleteProject(project.id)
      await loadProjects()
    } catch (err) {
      console.error('[Projects] Delete failed:', err)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Projetos</h1>
        <button onClick={openCreate} className="btn-primary text-sm">
          + Novo Projeto
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="card w-full max-w-md animate-fade-in">
            <h2 className="text-lg font-semibold mb-4">
              {editingId ? 'Editar Projeto' : 'Novo Projeto'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Nome *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input"
                  placeholder="Nome do projeto"
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
                  placeholder="Descricao do projeto"
                  rows={3}
                />
              </div>

              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Keywords</label>
                <input
                  type="text"
                  value={form.keywords}
                  onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                  className="input"
                  placeholder="palavra1, palavra2, palavra3"
                />
              </div>

              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Cor</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, color: c })}
                      className={`w-8 h-8 rounded-full border-2 transition-transform ${
                        form.color === c
                          ? 'border-white scale-110'
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="select"
                >
                  <option value="active">Ativo</option>
                  <option value="paused">Pausado</option>
                  <option value="archived">Arquivado</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary flex-1"
                >
                  {submitting ? 'Salvando...' : editingId ? 'Salvar' : 'Criar'}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="btn-secondary"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project Grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-4xl mb-3">📁</p>
          <p>Nenhum projeto criado</p>
          <button onClick={openCreate} className="btn-primary text-sm mt-4">
            Criar primeiro projeto
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
