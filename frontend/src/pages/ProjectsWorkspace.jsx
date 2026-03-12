import { Link } from 'react-router-dom'
import WorkspaceTabs from '../components/WorkspaceTabs'
import Credentials from './Credentials'
import Projects from './Projects'

const tabs = [
  { id: 'projetos', label: 'Projetos' },
  { id: 'credenciais', label: 'Credenciais' },
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
      renderTab={(activeTab) => (activeTab === 'credenciais' ? <Credentials /> : <Projects />)}
    />
  )
}
