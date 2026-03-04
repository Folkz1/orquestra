import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
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

export default function App() {
  const [authenticated, setAuthenticated] = useState(
    () => !!localStorage.getItem('orquestra_token')
  )

  if (!authenticated) {
    return <Login onLogin={() => setAuthenticated(true)} />
  }

  return (
    <BrowserRouter>
      <Layout onLogout={() => { localStorage.removeItem('orquestra_token'); setAuthenticated(false) }}>
        <Routes>
          <Route path="/" element={<Recorder />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/briefs" element={<Briefs />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/recordings" element={<Recordings />} />
          <Route path="/war-tasks" element={<WarTasks />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
