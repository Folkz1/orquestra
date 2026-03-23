import WorkspaceTabs from '../components/WorkspaceTabs'
import YouTubeAnalytics from './YouTubeAnalytics'
import YouTubeCentral from './YouTubeCentral'
import YouTubeKanban from './YouTubeKanban'
import YouTubeStrategy from './YouTubeStrategy'

const tabs = [
  { id: 'central', label: 'Central' },
  { id: 'kanban', label: 'Pipeline' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'estrategia', label: 'Estrategia' },
]

export default function YouTubeWorkspacePage() {
  function renderTab(activeTab) {
    if (activeTab === 'central') return <YouTubeCentral />
    if (activeTab === 'analytics') return <YouTubeAnalytics />
    if (activeTab === 'estrategia') return <YouTubeStrategy />
    return <YouTubeKanban />
  }

  return (
    <WorkspaceTabs
      title="YouTube"
      subtitle="A decisao editorial, o pipeline e a estrategia agora podem viver na mesma superficie."
      tabs={tabs}
      defaultTab="central"
      aside={<p className="text-sm text-zinc-400">A aba Central virou a porta principal. Os outros tabs seguem como drill-down operacional.</p>}
      renderTab={renderTab}
    />
  )
}
