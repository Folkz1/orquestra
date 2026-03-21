import { useMemo, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { getInitials } from '../lib/formatters'
import { desktopNavSections, getNavMeta, nativeMobileTabs } from '../lib/navigation'
import { isNativeApp } from '../lib/native'

function DesktopItem({ item }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `nav-item ${isActive ? 'nav-item-active' : ''}`
      }
    >
      <span className="nav-sigil">{getInitials(item.label)}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{item.label}</span>
        <span className="mt-0.5 block text-xs text-zinc-500">{item.description}</span>
      </span>
    </NavLink>
  )
}

const dockIcons = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  tasks: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="12" y2="17" />
    </svg>
  ),
  bot: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" />
      <line x1="16" y1="16" x2="16" y2="16" />
    </svg>
  ),
}

function NativeDockItem({ item }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `native-dock-item ${isActive ? 'native-dock-active' : ''}`
      }
    >
      {dockIcons[item.icon] || <span className="nav-sigil">{getInitials(item.label)}</span>}
      <span>{item.label}</span>
    </NavLink>
  )
}

export default function Layout({ children, onLogout }) {
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const nativeApp = useMemo(() => isNativeApp(), [])
  const meta = getNavMeta(location.pathname)

  return (
    <div className="min-h-screen bg-grid">
      {!nativeApp && (
        <aside className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:w-80 lg:flex-col lg:border-r lg:border-white/6 lg:bg-black/40 lg:backdrop-blur">
          <div className="border-b border-white/6 px-6 py-7">
            <p className="eyebrow">Jarbas control room</p>
            <h1 className="mt-3 text-2xl font-bold text-white">Orquestra</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Home executiva, merges por workspace e navegação com quatro blocos claros.
            </p>
          </div>

          <nav className="flex-1 overflow-y-auto px-4 py-5">
            {desktopNavSections.map((section) => (
              <div key={section.id} className="mb-6 border-b border-white/6 pb-6 last:border-b-0 last:pb-0">
                <p className="mb-3 px-3 text-[11px] font-medium uppercase tracking-[0.28em] text-zinc-500">
                  {section.label}
                </p>
                <div className="space-y-1.5">
                  {section.items.map((item) => (
                    <DesktopItem key={item.to} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-white/6 px-6 py-4">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>v2.0 shell</span>
              {onLogout && (
                <button type="button" onClick={onLogout} className="hover:text-red-300">
                  Sair
                </button>
              )}
            </div>
          </div>
        </aside>
      )}

      <header className={`sticky top-0 z-20 border-b border-white/6 bg-black/35 backdrop-blur ${nativeApp ? 'native-header' : 'lg:ml-80'}`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <p className="eyebrow">Workspace ativo</p>
            <h2 className="mt-1 text-lg font-semibold text-white">{meta.label}</h2>
          </div>

          {!nativeApp && (
            <div className="flex items-center gap-2 lg:hidden">
              <button type="button" onClick={() => setDrawerOpen((open) => !open)} className="btn-secondary">
                Menu
              </button>
              {onLogout && (
                <button type="button" onClick={onLogout} className="btn-secondary">
                  Sair
                </button>
              )}
            </div>
          )}

          {nativeApp && (
            <Link to="/jarbas" className="btn-secondary">
              Jarbas
            </Link>
          )}
        </div>
      </header>

      {!nativeApp && drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/65 lg:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="h-full w-[82vw] max-w-sm border-r border-white/8 bg-zinc-950/96 p-4 backdrop-blur" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="eyebrow">Navegacao</p>
                <h3 className="mt-2 text-lg font-semibold text-white">Orquestra</h3>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="btn-secondary">
                Fechar
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto pb-10">
              {desktopNavSections.map((section) => (
                <div key={section.id}>
                  <p className="mb-2 px-2 text-[11px] uppercase tracking-[0.28em] text-zinc-500">{section.label}</p>
                  <div className="space-y-1.5">
                    {section.items.map((item) => (
                      <div key={item.to} onClick={() => setDrawerOpen(false)}>
                        <DesktopItem item={item} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className={`${nativeApp ? 'native-main' : 'lg:ml-80'} pb-24`}>
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          {children}
        </div>
      </main>

      {nativeApp && (
        <nav className="native-dock">
          {nativeMobileTabs.map((item) => (
            <NativeDockItem key={item.to} item={item} />
          ))}
        </nav>
      )}
    </div>
  )
}
