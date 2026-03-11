import { useState } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import Recorder from './pages/Recorder'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import Briefs from './pages/Briefs'
import Contacts from './pages/Contacts'
import Memory from './pages/Memory'
import Recordings from './pages/Recordings'
import Settings from './pages/Settings'
import Kanban from './pages/Kanban'
import YouTubeBriefing from './pages/YouTubeBriefing'
import YouTubeKanban from './pages/YouTubeKanban'
import Proposals from './pages/Proposals'
import ProposalView from './pages/ProposalView'
import ClientSuccess from './pages/ClientSuccess'
import YouTubeAnalytics from './pages/YouTubeAnalytics'
import ScheduledMessages from './pages/ScheduledMessages'
import Credentials from './pages/Credentials'

function AppRoutes({ onLogout }) {
  const location = useLocation()

  // Public routes (no auth required)
  if (location.pathname.startsWith('/proposta/')) {
    return <ProposalView />
  }
  if (location.pathname === '/youtube-briefing') {
    return <YouTubeBriefing />
  }

  return (
    <Layout onLogout={onLogout}>
      <Routes>
        <Route path="/" element={<Recorder />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/briefs" element={<Briefs />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/recordings" element={<Recordings />} />
        <Route path="/kanban" element={<Kanban />} />
        <Route path="/youtube-kanban" element={<YouTubeKanban />} />
        <Route path="/youtube-analytics" element={<YouTubeAnalytics />} />
        <Route path="/proposals" element={<Proposals />} />
        <Route path="/proposta/:slug" element={<ProposalView />} />
        <Route path="/pos-venda" element={<ClientSuccess />} />
        <Route path="/mensagens-agendadas" element={<ScheduledMessages />} />
        <Route path="/credenciais" element={<Credentials />} />
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
          <Route path="*" element={<Login onLogin={() => setAuthenticated(true)} />} />
        </Routes>
      )}
    </BrowserRouter>
  )
}
