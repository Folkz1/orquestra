import { formatRelativeDate } from '../lib/formatters'

const STATUS = {
  active: { dot: 'bg-green-400', shadow: 'shadow-[0_0_8px_rgba(74,222,128,0.5)]', label: 'Ativo', color: 'text-green-400' },
  idle: { dot: 'bg-yellow-400', shadow: 'shadow-[0_0_8px_rgba(250,204,21,0.4)]', label: 'Idle', color: 'text-yellow-400' },
  error: { dot: 'bg-red-400', shadow: 'shadow-[0_0_8px_rgba(248,113,113,0.5)]', label: 'Erro', color: 'text-red-400' },
  paused: { dot: 'bg-zinc-500', shadow: '', label: 'Pausado', color: 'text-zinc-500' },
}

export default function AgentCard({ name, status, lastExecution, tasksToday, nextRun }) {
  const s = STATUS[status] || STATUS.paused
  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 px-4 py-3 transition-colors hover:bg-white/5">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${s.dot} ${s.shadow}`} />
        <span className="text-sm font-medium text-zinc-100">{name}</span>
        <span className={`ml-auto text-xs font-medium ${s.color}`}>{s.label}</span>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
        {lastExecution && <span>{formatRelativeDate(lastExecution)}</span>}
        {tasksToday > 0 && <span>{tasksToday} tasks hoje</span>}
        {nextRun && <span>Prox: {formatRelativeDate(nextRun)}</span>}
        {!lastExecution && !nextRun && <span>Sem execucao registrada</span>}
      </div>
    </div>
  )
}
