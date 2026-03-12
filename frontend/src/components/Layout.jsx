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

function NativeDockItem({ item }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `native-dock-item ${isActive ? 'native-dock-active' : ''}`
      }
    >
      <span className="nav-sigil">{getInitials(item.label)}</span>
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

      <header className={`sticky top-0 z-20 border-b border-white/6 bg-black/35 backdrop-blur ${nativeApp ? '' : 'lg:ml-80'}`}>
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

      <main className={`${nativeApp ? '' : 'lg:ml-80'} pb-24`}>
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
