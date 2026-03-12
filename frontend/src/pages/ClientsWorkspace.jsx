import WorkspaceTabs from '../components/WorkspaceTabs'
import ClientSuccess from './ClientSuccess'
import Contacts from './Contacts'
import Proposals from './Proposals'

const tabs = [
  { id: 'contatos', label: 'Contatos' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'propostas', label: 'Propostas' },
]

export default function ClientsWorkspace() {
  return (
    <WorkspaceTabs
      title="Clientes"
      subtitle="Unifica o que estava espalhado entre contatos, pos-venda e propostas comerciais."
      tabs={tabs}
      defaultTab="contatos"
      aside={
        <p className="text-sm text-zinc-400">
          Cada aba reaproveita a tela existente, preservando fetches, filtros e comportamento operacional.
        </p>
      }
      renderTab={(activeTab) => {
        if (activeTab === 'pipeline') return <ClientSuccess />
        if (activeTab === 'propostas') return <Proposals />
        return <Contacts />
      }}
    />
  )
}
