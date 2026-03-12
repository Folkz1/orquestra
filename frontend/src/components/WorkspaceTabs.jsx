import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export default function WorkspaceTabs({
  title,
  subtitle,
  tabs,
  defaultTab,
  renderTab,
  aside,
}) {
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTab = useMemo(() => {
    const current = searchParams.get('tab')
    return tabs.some((tab) => tab.id === current) ? current : defaultTab
  }, [defaultTab, searchParams, tabs])

  function selectTab(tabId) {
    const next = new URLSearchParams(searchParams)
    next.set('tab', tabId)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="space-y-6">
      <section className="surface-panel overflow-hidden">
        <div className="surface-gradient p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="eyebrow">Workspace</p>
              <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{title}</h1>
              {subtitle && <p className="mt-2 max-w-2xl text-sm text-zinc-300">{subtitle}</p>}
            </div>
            {aside && <div className="lg:max-w-sm">{aside}</div>}
          </div>
        </div>

        <div className="border-t border-white/6 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const active = tab.id === activeTab

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                    active
                      ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-white'
                      : 'border-white/8 bg-white/3 text-zinc-400 hover:border-white/14 hover:text-zinc-200'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <div className="animate-fade-in">{renderTab(activeTab)}</div>
    </div>
  )
}
