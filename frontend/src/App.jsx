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
import WarTasks from './pages/WarTasks'
import Kanban from './pages/Kanban'
import YouTubeBriefing from './pages/YouTubeBriefing'

function AppRoutes({ onLogout }) {
  const location = useLocation()

  // Public routes (no auth required)
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
        <Route path="/war-tasks" element={<WarTasks />} />
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
          <Route path="*" element={<Login onLogin={() => setAuthenticated(true)} />} />
        </Routes>
      )}
    </BrowserRouter>
  )
}
