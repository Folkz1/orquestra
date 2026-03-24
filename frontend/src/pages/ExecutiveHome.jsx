import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import ActivityFeed from '../components/ActivityFeed'
import AgentCard from '../components/AgentCard'
import ChartCard from '../components/ChartCard'
import StatCard from '../components/StatCard'
import { getBriefs, getContacts, getProjects, getProposals, getTasks, getAgentStatuses, getChartMrr, getChartTasks, getChartMessages } from '../api'
import {
  formatCompactNumber,
  formatCurrency,
  formatRelativeDate,
  isClientContact,
  isUrgentTask,
  parseMoney,
  proposalLabel,
} from '../lib/formatters'

const CHART_GRID = { strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.06)' }
const CHART_TICK = { fill: '#71717a', fontSize: 11 }
const CHART_TOOLTIP = { background: '#10141b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#e4e4e7' }

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
  const [agents, setAgents] = useState([])
  const [chartMrr, setChartMrr] = useState([])
  const [chartTasks, setChartTasks] = useState([])
  const [chartMessages, setChartMessages] = useState([])

  useEffect(() => {
    let active = true

    Promise.allSettled([
      getContacts(),
      getTasks(),
      getProposals(),
      getProjects(),
      getBriefs(),
      getAgentStatuses(),
      getChartMrr(),
      getChartTasks(),
      getChartMessages(),
    ]).then(([contactsRes, tasksRes, proposalsRes, projectsRes, briefsRes, agentsRes, mrrRes, tasksChartRes, msgsRes]) => {
      if (!active) return

      setContacts(Array.isArray(contactsRes.value) ? contactsRes.value : [])
      setTasks(Array.isArray(tasksRes.value) ? tasksRes.value : [])
      setProposals(Array.isArray(proposalsRes.value) ? proposalsRes.value : [])
      setProjects(Array.isArray(projectsRes.value) ? projectsRes.value : [])
      setBriefs(Array.isArray(briefsRes.value) ? briefsRes.value : [])
      setAgents(Array.isArray(agentsRes.value) ? agentsRes.value : [])
      setChartMrr(Array.isArray(mrrRes.value?.months) ? mrrRes.value.months : [])
      setChartTasks(Array.isArray(tasksChartRes.value?.weeks) ? tasksChartRes.value.weeks : [])
      setChartMessages(Array.isArray(msgsRes.value?.days) ? msgsRes.value.days : [])
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

      {/* Agent Status Board */}
      <section className="surface-panel p-5">
        <div className="mb-4">
          <p className="eyebrow">Infraestrutura</p>
          <h2 className="mt-2 text-lg font-semibold text-white">Agentes</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.name}
              name={agent.name}
              status={agent.status}
              lastExecution={agent.last_execution}
              tasksToday={agent.tasks_completed_today}
              nextRun={agent.next_run}
            />
          ))}
          {agents.length === 0 && !loading && (
            <p className="col-span-full text-sm text-zinc-500">Sem dados de agentes.</p>
          )}
        </div>
      </section>

      {/* Charts */}
      <section className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="MRR Trend" subtitle="Receita" isEmpty={chartMrr.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartMrr}>
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="month" tick={CHART_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${(v / 100).toLocaleString('pt-BR')}`} />
              <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v) => [`R$ ${(v / 100).toLocaleString('pt-BR')}`, 'MRR']} />
              <Line type="monotone" dataKey="amount_cents" stroke="#8bd450" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Velocidade de Tasks" subtitle="Produtividade" isEmpty={chartTasks.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartTasks}>
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="week_start" tick={CHART_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v) => [v, 'Concluidas']} labelFormatter={(l) => `Semana ${l.slice(5)}`} />
              <Bar dataKey="completed" fill="#5ea6ff" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Volume de Mensagens" subtitle="Comunicacao" isEmpty={chartMessages.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartMessages}>
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="date" tick={CHART_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(8)} />
              <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v, name) => [v, name === 'incoming' ? 'Recebidas' : name === 'outgoing' ? 'Enviadas' : 'Total']} labelFormatter={(l) => `Dia ${l.slice(8)}/${l.slice(5, 7)}`} />
              <Area type="monotone" dataKey="incoming" stroke="#67d7d0" fill="rgba(103,215,208,0.12)" strokeWidth={2} />
              <Area type="monotone" dataKey="outgoing" stroke="#f7b955" fill="rgba(247,185,85,0.08)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
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
