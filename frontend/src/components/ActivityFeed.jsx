import { Link } from 'react-router-dom'

export default function ActivityFeed({ title, items, emptyLabel }) {
  return (
    <section className="surface-panel p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Radar</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{title}</h2>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/2 px-4 py-6 text-sm text-zinc-500">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-white/6 bg-white/3 px-4 py-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{item.title}</p>
                  {item.description && <p className="mt-1 text-sm text-zinc-400">{item.description}</p>}
                </div>
                {item.meta && <span className="text-xs text-zinc-500">{item.meta}</span>}
              </div>
              {item.href && (
                <Link to={item.href} className="mt-3 inline-flex text-xs font-medium text-[color:var(--accent)] hover:text-white">
                  Abrir
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
