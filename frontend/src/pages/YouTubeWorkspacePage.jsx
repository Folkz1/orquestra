import WorkspaceTabs from '../components/WorkspaceTabs'
import YouTubeAnalytics from './YouTubeAnalytics'
import YouTubeKanban from './YouTubeKanban'

const tabs = [
  { id: 'kanban', label: 'Pipeline' },
  { id: 'analytics', label: 'Analytics' },
]

export default function YouTubeWorkspacePage() {
  return (
    <WorkspaceTabs
      title="YouTube"
      subtitle="A operacao editorial e a leitura do canal agora compartilham a mesma superficie."
      tabs={tabs}
      defaultTab="kanban"
      aside={<p className="text-sm text-zinc-400">O briefing publico continua disponivel em rota separada para Andriely.</p>}
      renderTab={(activeTab) => (activeTab === 'analytics' ? <YouTubeAnalytics /> : <YouTubeKanban />)}
    />
  )
}
