import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import ClientsWorkspace from './pages/ClientsWorkspace'
import ExecutiveHome from './pages/ExecutiveHome'
import JarbasChat from './pages/JarbasChat'
import Login from './pages/Login'
import Briefs from './pages/Briefs'
import Memory from './pages/Memory'
import Recordings from './pages/Recordings'
import Recorder from './pages/Recorder'
import Settings from './pages/Settings'
import Kanban from './pages/Kanban'
import ProposalView from './pages/ProposalView'
import ScheduledMessages from './pages/ScheduledMessages'
import ClientPortal from './pages/ClientPortal'
import ProjectsWorkspace from './pages/ProjectsWorkspace'
import WhatsAppChat from './pages/WhatsAppChat'
import YouTubeBriefing from './pages/YouTubeBriefing'
import YouTubeWorkspacePage from './pages/YouTubeWorkspacePage'
import PlaybookPlatform from './pages/PlaybookPlatform'
import { isStandalonePWA } from './lib/native'

function AppRoutes({ onLogout }) {
  const location = useLocation()
  const standaloneChat =
    isStandalonePWA() &&
    (location.pathname.startsWith('/chat') || location.pathname.startsWith('/mensagens'))

  if (location.pathname.startsWith('/proposta/')) {
    return <ProposalView />
  }

  if (location.pathname === '/youtube-briefing') {
    return <YouTubeBriefing />
  }

  if (location.pathname.startsWith('/playbook')) {
    return <PlaybookPlatform />
  }

  if (location.pathname.startsWith('/app/chat')) {
    return <WhatsAppChat appMode />
  }

  if (standaloneChat) {
    return <WhatsAppChat appMode />
  }

  return (
    <Layout onLogout={onLogout}>
      <Routes>
        <Route path="/" element={<ExecutiveHome />} />
        <Route path="/dashboard" element={<Navigate to="/chat" replace />} />
        <Route path="/mensagens" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<WhatsAppChat />} />
        <Route path="/app/chat" element={<WhatsAppChat appMode />} />
        <Route path="/gravador" element={<Recorder />} />
        <Route path="/recorder" element={<Navigate to="/gravador" replace />} />
        <Route path="/briefs" element={<Briefs />} />
        <Route path="/contacts" element={<Navigate to="/clientes?tab=contatos" replace />} />
        <Route path="/clientes" element={<ClientsWorkspace />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/recordings" element={<Recordings />} />
        <Route path="/kanban" element={<Navigate to="/tarefas" replace />} />
        <Route path="/tarefas" element={<Kanban />} />
        <Route path="/youtube-kanban" element={<Navigate to="/youtube?tab=kanban" replace />} />
        <Route path="/youtube-analytics" element={<Navigate to="/youtube?tab=analytics" replace />} />
        <Route path="/youtube" element={<YouTubeWorkspacePage />} />
        <Route path="/proposals" element={<Navigate to="/clientes?tab=propostas" replace />} />
        <Route path="/proposta/:slug" element={<ProposalView />} />
        <Route path="/pos-venda" element={<Navigate to="/clientes?tab=pipeline" replace />} />
        <Route path="/mensagens-agendadas" element={<ScheduledMessages />} />
        <Route path="/projects" element={<Navigate to="/projetos?tab=projetos" replace />} />
        <Route path="/credenciais" element={<Navigate to="/projetos?tab=credenciais" replace />} />
        <Route path="/projetos" element={<ProjectsWorkspace />} />
        <Route path="/client-portal" element={<ClientPortal />} />
        <Route path="/jarbas" element={<JarbasChat />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(
    () => !!localStorage.getItem('orquestra_token')
  )

  return (
    <BrowserRouter>
      {authenticated ? (
        <AppRoutes onLogout={() => { localStorage.removeItem('orquestra_token'); setAuthenticated(false) }} />
      ) : (
        <Routes>
          <Route path="/youtube-briefing" element={<YouTubeBriefing />} />
          <Route path="/proposta/:slug" element={<ProposalView />} />
          <Route path="/playbook/*" element={<PlaybookPlatform />} />
          <Route path="*" element={<Login onLogin={() => setAuthenticated(true)} />} />
        </Routes>
      )}
    </BrowserRouter>
  )
}
