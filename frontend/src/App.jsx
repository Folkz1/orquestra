import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Recorder from './pages/Recorder'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import Briefs from './pages/Briefs'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Recorder />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/briefs" element={<Briefs />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
