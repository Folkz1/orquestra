import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ActivityFeed from '../components/ActivityFeed'
import StatCard from '../components/StatCard'
import { getBriefs, getContacts, getProjects, getProposals, getTasks } from '../api'
import {
  formatCompactNumber,
  formatCurrency,
  formatRelativeDate,
  isClientContact,
  isUrgentTask,
  parseMoney,
  proposalLabel,
} from '../lib/formatters'

function WorkspaceLink({ to, title, description, meta }) {
  return (
    <Link to={to} className="action-card">
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-1 text-sm text-zinc-400">{description}</p>
      {meta && <p className="mt-3 text-xs text-zinc-500">{meta}</p>}
    </Link>
  )
}

export default function ExecutiveHome() {
  const [loading, setLoading] = useState(true)
  const [contacts, setContacts] = useState([])
  const [tasks, setTasks] = useState([])
  const [proposals, setProposals] = useState([])
  const [projects, setProjects] = useState([])
  const [briefs, setBriefs] = useState([])

  useEffect(() => {
    let active = true

    Promise.allSettled([
      getContacts(),
      getTasks(),
      getProposals(),
      getProjects(),
      getBriefs(),
    ]).then(([contactsRes, tasksRes, proposalsRes, projectsRes, briefsRes]) => {
      if (!active) return

      setContacts(Array.isArray(contactsRes.value) ? contactsRes.value : [])
      setTasks(Array.isArray(tasksRes.value) ? tasksRes.value : [])
      setProposals(Array.isArray(proposalsRes.value) ? proposalsRes.value : [])
      setProjects(Array.isArray(projectsRes.value) ? projectsRes.value : [])
      setBriefs(Array.isArray(briefsRes.value) ? briefsRes.value : [])
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [])

  const metrics = useMemo(() => {
    const clientContacts = contacts.filter(isClientContact)
    const activeTasks = tasks.filter((task) => task.status !== 'done')
    const urgentTasks = tasks.filter(isUrgentTask)
    const openProposals = proposals.filter((proposal) => !['accepted', 'rejected'].includes(proposal.status))
    const mrr = clientContacts.reduce((sum, contact) => sum + parseMoney(contact.monthly_revenue), 0)

    return {
      mrr,
      clients: clientContacts.length,
      tasks: activeTasks.length,
      proposals: openProposals.length,
      urgent: urgentTasks.length,
    }
  }, [contacts, proposals, tasks])

  const recentProjects = useMemo(() => {
    return [...projects]
      .sort((left, right) => {
        const leftDate = left.stats?.last_activity || left.updated_at || 0
        const rightDate = right.stats?.last_activity || right.updated_at || 0
        return new Date(rightDate) - new Date(leftDate)
      })
      .slice(0, 4)
      .map((project) => ({
        id: project.id,
        title: project.name,
        description: project.description || 'Projeto sem descricao operacional.',
        meta: `${project.stats?.total_messages || 0} msgs · ${formatRelativeDate(project.stats?.last_activity || project.updated_at)}`,
        href: '/projetos?tab=projetos',
      }))
  }, [projects])

  const urgentQueue = useMemo(() => {
    return tasks
      .filter(isUrgentTask)
      .slice(0, 5)
      .map((task) => ({
        id: task.id,
        title: task.title,
        description: task.project_name || task.description || 'Sem descricao adicional.',
        meta: `${task.priority} · ${task.status}`,
        href: '/tarefas',
      }))
  }, [tasks])

  const proposalPulse = useMemo(() => {
    return proposals
      .slice(0, 5)
      .map((proposal) => ({
        id: proposal.id,
        title: proposal.title,
        description: `${proposal.client_name} · ${proposalLabel(proposal.status)}`,
        meta: proposal.total_value || 'Sem valor informado',
        href: '/clientes?tab=propostas',
      }))
  }, [proposals])

  const latestBrief = briefs[0]

  return (
    <div className="space-y-6">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Visao executiva</p>
          <h1 className="mt-2 text-2xl font-bold text-white sm:mt-3 sm:text-4xl">
            Motor 100K
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-300 sm:mt-4 sm:text-base">
            Receita, urgencias, clientes e projetos num lugar so.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/clientes?tab=pipeline" className="btn-primary">
              Abrir pipeline
            </Link>
            <Link to="/jarbas" className="btn-secondary">
              Conversar com Jarbas
            </Link>
          </div>
        </div>

        <div className="hero-brief">
          <p className="eyebrow">Brief do dia</p>
          <div className="mt-3 rounded-3xl border border-white/8 bg-black/25 p-5">
            {latestBrief ? (
              <>
                <p className="text-sm text-zinc-200">{latestBrief.summary || 'Briefing gerado, mas sem resumo visivel.'}</p>
                <p className="mt-4 text-xs text-zinc-500">
                  Ultima geracao: {formatRelativeDate(latestBrief.generated_at || latestBrief.date)}
                </p>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Ainda sem briefing gerado nesta base.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <div className="col-span-2 xl:col-span-1">
          <StatCard label="MRR" value={loading ? '...' : formatCurrency(metrics.mrr)} footnote="Receita mensal recorrente" accent="lime" />
        </div>
        <StatCard label="Clientes" value={loading ? '...' : formatCompactNumber(metrics.clients)} footnote="Clientes ativos" accent="cyan" />
        <StatCard label="Tasks" value={loading ? '...' : formatCompactNumber(metrics.tasks)} footnote="Pendentes" accent="blue" />
        <StatCard label="Propostas" value={loading ? '...' : formatCompactNumber(metrics.proposals)} footnote="Em aberto" accent="amber" />
        <StatCard label="Urgentes" value={loading ? '...' : formatCompactNumber(metrics.urgent)} footnote="Alta prioridade" accent="rose" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="surface-panel p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Acesso rapido</p>
              <h2 className="mt-2 text-lg font-semibold text-white">Quatro blocos, doze entradas.</h2>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <WorkspaceLink
              to="/clientes?tab=contatos"
              title="Clientes"
              description="Mesma base, agora com tabs para contatos, pipeline e propostas."
              meta={`${metrics.clients} clientes operacionais`}
            />
            <WorkspaceLink
              to="/tarefas"
              title="Tarefas"
              description="Fila unica de execucao, review e urgencias."
              meta={`${metrics.urgent} itens pressionando o dia`}
            />
            <WorkspaceLink
              to="/projetos?tab=projetos"
              title="Projetos"
              description="Gestao de projetos e credenciais em um unico workspace."
              meta={`${projects.length} projetos mapeados`}
            />
            <WorkspaceLink
              to="/youtube?tab=kanban"
              title="YouTube"
              description="Pipeline editorial e analytics no mesmo eixo."
              meta={`${formatCompactNumber(proposals.length)} sinais comerciais ativos`}
            />
          </div>
        </div>

        <ActivityFeed
          title="Fila urgente"
          items={urgentQueue}
          emptyLabel="Sem tasks urgentes. O painel esta limpo agora."
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ActivityFeed
          title="Comercial em movimento"
          items={proposalPulse}
          emptyLabel="Sem propostas recentes. Abra o workspace de Clientes para iniciar uma nova."
        />
        <ActivityFeed
          title="Projetos com atividade"
          items={recentProjects}
          emptyLabel="Sem projetos ativos encontrados nesta base."
        />
      </section>
    </div>
  )
}
