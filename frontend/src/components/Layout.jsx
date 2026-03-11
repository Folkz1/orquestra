import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/', label: 'Gravador', icon: '🎙️' },
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/contacts', label: 'Contatos', icon: '👥' },
  { to: '/recordings', label: 'Gravacoes', icon: '🎧' },
  { to: '/memory', label: 'Memoria', icon: '🧠' },
  { to: '/kanban', label: 'Kanban', icon: '📌' },
  { to: '/youtube-kanban', label: 'YouTube', icon: '📺' },
  { to: '/youtube-analytics', label: 'YT Analytics', icon: '📈' },
  { to: '/proposals', label: 'Propostas', icon: '📄' },
  { to: '/pos-venda', label: 'Pós-Venda', icon: '🤝' },
  { to: '/projects', label: 'Projetos', icon: '📁' },
  { to: '/briefs', label: 'Briefings', icon: '📋' },
  { to: '/war-tasks', label: 'War Tasks', icon: '⚔️' },
  { to: '/settings', label: 'Config', icon: '⚙️' },
]

function NavItem({ to, label, icon, mobile = false }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        mobile
          ? `flex flex-col items-center gap-0.5 py-2 px-3 text-xs transition-colors ${
              isActive
                ? 'text-primary'
                : 'text-zinc-500 hover:text-zinc-300'
            }`
          : `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-colors ${
              isActive
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'
            }`
      }
    >
      <span className={mobile ? 'text-lg' : 'text-base'}>{icon}</span>
      <span>{label}</span>
    </NavLink>
  )
}

export default function Layout({ children, onLogout }) {
  return (
    <div className="min-h-screen flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:flex-col w-64 bg-zinc-900 border-r border-zinc-800 fixed inset-y-0 left-0 z-30">
        <div className="p-6">
          <h1 className="text-xl font-bold text-primary tracking-tight">
            Orquestra
          </h1>
          <p className="text-xs text-zinc-500 mt-1">Central de gravacoes</p>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {navItems.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>

        <div className="p-4 border-t border-zinc-800 flex items-center justify-between">
          <p className="text-xs text-zinc-600">v1.1.0</p>
          {onLogout && (
            <button
              onClick={onLogout}
              className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
            >
              Sair
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 pb-20 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 py-6">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-zinc-900 border-t border-zinc-800 z-30 flex justify-around items-center safe-bottom">
        {navItems.map((item) => (
          <NavItem key={item.to} {...item} mobile />
        ))}
      </nav>
    </div>
  )
}
