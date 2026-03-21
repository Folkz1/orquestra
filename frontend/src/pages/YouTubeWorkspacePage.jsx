import WorkspaceTabs from '../components/WorkspaceTabs'
import YouTubeAnalytics from './YouTubeAnalytics'
import YouTubeKanban from './YouTubeKanban'
import YouTubeStrategy from './YouTubeStrategy'

const tabs = [
  { id: 'kanban', label: 'Pipeline' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'estrategia', label: 'Estratégia' },
]

export default function YouTubeWorkspacePage() {
  function renderTab(activeTab) {
    if (activeTab === 'analytics') return <YouTubeAnalytics />
    if (activeTab === 'estrategia') return <YouTubeStrategy />
    return <YouTubeKanban />
  }

  return (
    <WorkspaceTabs
      title="YouTube"
      subtitle="A operacao editorial e a leitura do canal agora compartilham a mesma superficie."
      tabs={tabs}
      defaultTab="kanban"
      aside={<p className="text-sm text-zinc-400">O briefing publico continua disponivel em rota separada para Andriely.</p>}
      renderTab={renderTab}
    />
  )
}
