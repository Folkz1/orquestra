import YouTubeKanban from './YouTubeKanban'
import YouTubeStrategy from './YouTubeStrategy'

const jumpButtonClass =
  'rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100'

export default function YouTubeCentral() {
  function jumpTo(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-zinc-800 bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.14),_transparent_42%),linear-gradient(135deg,_rgba(24,24,27,0.95),_rgba(9,9,11,0.96))] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-red-300/80">YouTube Command Center</div>
            <h1 className="mt-2 text-2xl font-semibold text-zinc-50">Uma superficie so para decidir e operar</h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              Aqui a decisao editorial, a fila de gravacao, o pipeline do kanban e o banco da estrategia passam a
              conviver no mesmo fluxo. O foco e escolher o proximo video certo e executar sem perder contexto.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={jumpButtonClass} onClick={() => jumpTo('youtube-central-strategy')}>
              Inteligencia
            </button>
            <button className={jumpButtonClass} onClick={() => jumpTo('youtube-central-pipeline')}>
              Pipeline
            </button>
            <a href="/youtube?tab=analytics" className={jumpButtonClass}>
              Analytics
            </a>
            <a href="/youtube-briefing" target="_blank" rel="noopener noreferrer" className={jumpButtonClass}>
              Briefing publico
            </a>
          </div>
        </div>
      </section>

      <section id="youtube-central-strategy" className="space-y-4">
        <YouTubeStrategy embedded />
      </section>

      <section id="youtube-central-pipeline" className="space-y-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/65 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Pipeline operacional</div>
          <div className="mt-1 text-sm text-zinc-300">
            O board abaixo agora usa o mesmo workspace consolidado que alimenta a recomendacao editorial.
          </div>
        </div>
        <YouTubeKanban embedded />
      </section>
    </div>
  )
}
