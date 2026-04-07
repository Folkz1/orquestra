import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import WorkspaceTabs from '../components/WorkspaceTabs'
import Credentials from './Credentials'
import Projects from './Projects'
import { getTestSessions } from '../api'

const tabs = [
  { id: 'projetos', label: 'Projetos' },
  { id: 'credenciais', label: 'Credenciais' },
  { id: 'testes', label: 'Testes' },
]

export default function ProjectsWorkspace() {
  return (
    <WorkspaceTabs
      title="Projetos"
      subtitle="CRUD de projetos e gestao de credenciais agora no mesmo fluxo operacional."
      tabs={tabs}
      defaultTab="projetos"
      aside={
        <div className="rounded-3xl border border-white/8 bg-black/25 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Portal publico</p>
          <p className="mt-2 text-sm text-zinc-300">
            O portal do cliente continua separado para nao misturar operacao interna com links externos.
          </p>
          <Link to="/client-portal" className="mt-4 inline-flex text-xs font-medium text-[color:var(--accent)] hover:text-white">
            Abrir portal cliente
          </Link>
        </div>
      }
      renderTab={(activeTab) => {
        if (activeTab === 'credenciais') return <Credentials />
        if (activeTab === 'testes') return <TestSessionsTab />
        return <Projects />
      }}
    />
  )
}

function TestSessionsTab() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTestSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-500 text-sm py-8 text-center">Carregando...</div>

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <div className="text-3xl mb-3">🧪</div>
        <p className="text-sm">Nenhuma sessão de teste ainda.</p>
        <p className="text-xs mt-1 text-gray-600">Use <code className="bg-white/5 px-1 rounded">/human-tester</code> para criar um teste.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sessions.map(session => (
        <div
          key={session.id}
          className="rounded-xl border border-white/10 p-4 hover:border-white/20 transition-colors"
          style={{ background: '#0d1117' }}
        >
          <div className="flex items-center justify-between mb-1">
            <div className="font-medium text-sm text-white">
              {session.plan?.projeto} — {session.plan?.nome}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              session.status === 'concluido' ? 'bg-green-500/20 text-green-400' :
              session.status === 'em_progresso' ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-gray-500/20 text-gray-400'
            }`}>
              {session.status}
            </span>
          </div>
          <div className="text-xs text-gray-500">
            {new Date(session.criado_em).toLocaleDateString('pt-BR')}
            {session.concluido_em && ` · Concluído em ${new Date(session.concluido_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
          </div>
        </div>
      ))}
    </div>
  )
}
