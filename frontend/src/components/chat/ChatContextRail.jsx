function StatusBadge({ label, tone = 'zinc' }) {
  const tones = {
    green: 'badge-green',
    blue: 'badge-blue',
    yellow: 'badge-yellow',
    red: 'badge-red',
    zinc: 'badge-zinc',
  }

  return <span className={tones[tone] || tones.zinc}>{label}</span>
}

export default function ChatContextRail({
  context,
  loading,
  suggestion,
  onGenerateSuggestion,
  notificationsEnabled,
  onEnableNotifications,
  onInstallApp,
}) {
  return (
    <section className="surface-panel flex min-h-[72vh] flex-col gap-4 p-4">
      <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
        <p className="eyebrow">Workspace inteligente</p>
        <h3 className="mt-2 text-xl font-semibold text-white">Contexto do cliente</h3>
        <p className="mt-2 text-sm text-zinc-500">
          {context?.project_name || 'Sem projeto vinculado'} · {context?.contact.pipeline_stage || 'lead'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <button type="button" onClick={onEnableNotifications} className="action-card text-left">
          <p className="eyebrow">Notificacoes</p>
          <p className="mt-2 text-sm font-semibold text-white">
            {notificationsEnabled ? 'Ativas no navegador' : 'Ativar alertas do chat'}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Instale o app e receba alertas quando novas mensagens chegarem.
          </p>
        </button>

        {onInstallApp && (
          <button type="button" onClick={onInstallApp} className="action-card text-left">
            <p className="eyebrow">PWA</p>
            <p className="mt-2 text-sm font-semibold text-white">Instalar como app</p>
            <p className="mt-2 text-sm text-zinc-500">
              Abre em janela dedicada e se comporta como WhatsApp Web.
            </p>
          </button>
        )}
      </div>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-[24px] bg-white/5" />
          ))}
        </div>
      )}

      {!loading && context && (
        <>
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{context.contact.name || context.contact.push_name || context.contact.phone}</p>
                <p className="mt-1 text-sm text-zinc-500">{context.contact.phone}</p>
              </div>
              <StatusBadge
                label={`${context.contact.unread_count || 0} nao lidas`}
                tone={context.contact.unread_count ? 'yellow' : 'green'}
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                <p className="metric-label">Receita mensal</p>
                <p className="mt-2 text-sm text-white">{context.contact.monthly_revenue || 'n/a'}</p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                <p className="metric-label">Receita total</p>
                <p className="mt-2 text-sm text-white">{context.contact.total_revenue || 'n/a'}</p>
              </div>
            </div>

            <p className="mt-4 text-sm leading-6 text-zinc-400">
              {context.contact.notes || 'Sem digest salvo para este cliente ainda.'}
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Resposta sugerida</p>
                <p className="mt-2 text-sm text-zinc-500">Usa conversa recente, propostas e tasks.</p>
              </div>
              <button type="button" onClick={onGenerateSuggestion} className="btn-secondary">
                Sugerir
              </button>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
              {suggestion || 'Ainda sem sugestao. Gere uma resposta contextual quando precisar.'}
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
            <p className="eyebrow">Propostas</p>
            <div className="mt-3 space-y-3">
              {context.proposals.length === 0 && <p className="text-sm text-zinc-500">Nenhuma proposta vinculada.</p>}
              {context.proposals.map((proposal) => (
                <div key={proposal.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                  <p className="text-sm font-semibold text-white">{proposal.title}</p>
                  <p className="mt-1 text-sm text-zinc-500">{proposal.total_value || 'Sem valor'}</p>
                  <div className="mt-3">
                    <StatusBadge label={proposal.status} tone={proposal.status === 'accepted' ? 'green' : 'blue'} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
            <p className="eyebrow">Tasks ativas</p>
            <div className="mt-3 space-y-3">
              {context.tasks.length === 0 && <p className="text-sm text-zinc-500">Nenhuma task aberta neste projeto.</p>}
              {context.tasks.map((task) => (
                <div key={task.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                  <p className="text-sm font-semibold text-white">{task.title}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <StatusBadge label={task.status} tone="blue" />
                    <StatusBadge label={task.priority} tone={task.priority === 'high' ? 'red' : 'zinc'} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
            <p className="eyebrow">Entregas</p>
            <div className="mt-3 space-y-3">
              {context.delivery_reports.length === 0 && <p className="text-sm text-zinc-500">Sem delivery reports gerados.</p>}
              {context.delivery_reports.map((report) => (
                <div key={report.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">Report {String(report.proposal_id).slice(0, 8)}</p>
                    <StatusBadge label={report.status} tone={report.status === 'final' ? 'green' : 'yellow'} />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    {report.comparison_analysis || 'Sem resumo comparativo ainda.'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
