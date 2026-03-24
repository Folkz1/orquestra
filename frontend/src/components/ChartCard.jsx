export default function ChartCard({ title, subtitle, children, isEmpty }) {
  return (
    <div className="surface-panel p-5">
      <div className="mb-4">
        <p className="eyebrow">{subtitle || 'Metricas'}</p>
        <h3 className="mt-1 text-base font-semibold text-white">{title}</h3>
      </div>
      <div className="h-48">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/8 bg-white/2">
            <p className="text-sm text-zinc-500">Sem dados ainda</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
