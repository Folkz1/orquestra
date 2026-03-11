import { useState } from 'react'
import { syncProjects, triggerProactive } from '../api'

export default function Settings() {
  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Configuracoes</h1>
      <ProactiveBot />
      <SyncTab />
    </div>
  )
}

function ProactiveBot() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleTrigger = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await triggerProactive()
      setResult(data)
    } catch (err) {
      setError(err.message || 'Erro ao executar bot')
    }
    setLoading(false)
  }

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold mb-3">Bot Proativo</h2>
      <div className="card mb-4">
        <p className="text-sm text-zinc-400 mb-2">
          Analisa tasks, propostas, contatos e oportunidades. Envia relatório via WhatsApp com ações urgentes, oportunidades e follow-ups.
        </p>
        <p className="text-xs text-zinc-600 mb-4">
          Executa automaticamente 2x/dia: 7h e 14h BRT. Use o botão para disparar manualmente.
        </p>
        <button
          onClick={handleTrigger}
          disabled={loading}
          className="btn-primary text-sm"
        >
          {loading ? 'Analisando...' : 'Executar Agora'}
        </button>
      </div>

      {error && (
        <div className="card border border-red-500/30 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="card flex-1 text-center">
              <p className={`text-2xl font-bold ${result.sent_whatsapp ? 'text-green-400' : 'text-red-400'}`}>
                {result.sent_whatsapp ? 'Enviado' : 'Falhou'}
              </p>
              <p className="text-xs text-zinc-500">WhatsApp</p>
            </div>
            <div className="card flex-1 text-center">
              <p className="text-2xl font-bold text-primary">{result.tasks_created || 0}</p>
              <p className="text-xs text-zinc-500">Tasks Criadas</p>
            </div>
            <div className="card flex-1 text-center">
              <p className="text-2xl font-bold text-yellow-400">{result.analysis?.urgente?.length || 0}</p>
              <p className="text-xs text-zinc-500">Urgentes</p>
            </div>
          </div>

          {result.analysis?.resumo_executivo && (
            <div className="card">
              <p className="text-xs text-zinc-500 mb-1">Resumo</p>
              <p className="text-sm">{result.analysis.resumo_executivo}</p>
            </div>
          )}

          {result.analysis?.urgente?.length > 0 && (
            <div className="card border border-red-500/20">
              <p className="text-xs text-red-400 font-semibold mb-2">Urgente</p>
              {result.analysis.urgente.map((item, i) => (
                <div key={i} className="mb-2">
                  <p className="text-sm">{item.acao}</p>
                  {item.motivo && <p className="text-xs text-zinc-500">{item.motivo}</p>}
                </div>
              ))}
            </div>
          )}

          {result.analysis?.oportunidades?.length > 0 && (
            <div className="card border border-green-500/20">
              <p className="text-xs text-green-400 font-semibold mb-2">Oportunidades</p>
              {result.analysis.oportunidades.map((item, i) => (
                <div key={i} className="mb-2">
                  <p className="text-sm">{item.acao}</p>
                  {item.potencial && <p className="text-xs text-zinc-500">{item.potencial}</p>}
                </div>
              ))}
            </div>
          )}

          {result.analysis?.analise_clientes?.length > 0 && (
            <div className="card border border-purple-500/20">
              <p className="text-xs text-purple-400 font-semibold mb-2">Saúde dos Clientes</p>
              {result.analysis.analise_clientes.map((item, i) => (
                <div key={i} className="mb-2 flex items-start gap-2">
                  <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                    item.saude === 'verde' ? 'bg-green-400' :
                    item.saude === 'amarelo' ? 'bg-yellow-400' : 'bg-red-400'
                  }`} />
                  <div>
                    <p className="text-sm font-medium">{item.cliente}</p>
                    <p className="text-xs text-zinc-500">{item.diagnostico}</p>
                    {item.proxima_acao && <p className="text-xs text-zinc-400 mt-0.5">→ {item.proxima_acao}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.analysis?.follow_ups?.length > 0 && (
            <div className="card border border-yellow-500/20">
              <p className="text-xs text-yellow-400 font-semibold mb-2">Follow-ups</p>
              {result.analysis.follow_ups.map((item, i) => (
                <div key={i} className="mb-2">
                  <p className="text-sm">{item.contato} ({item.dias_sem_contato}d sem contato)</p>
                  {item.acao && <p className="text-xs text-zinc-500">{item.acao}</p>}
                </div>
              ))}
            </div>
          )}

          {result.analysis?.tasks_sugeridas?.length > 0 && (
            <div className="card border border-blue-500/20">
              <p className="text-xs text-blue-400 font-semibold mb-2">Tasks Criadas</p>
              {result.analysis.tasks_sugeridas.map((item, i) => (
                <div key={i} className="mb-2">
                  <p className="text-sm">
                    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                      item.prioridade === 'high' ? 'bg-red-400' :
                      item.prioridade === 'medium' ? 'bg-yellow-400' : 'bg-green-400'
                    }`} />
                    {item.titulo}
                  </p>
                </div>
              ))}
            </div>
          )}

          {result.message_preview && (
            <details className="card">
              <summary className="text-xs text-zinc-500 cursor-pointer">Preview da mensagem WhatsApp</summary>
              <pre className="text-xs text-zinc-400 mt-2 whitespace-pre-wrap">{result.message_preview}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function SyncTab() {
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)

  const handleSync = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await syncProjects()
      setResults(data)
    } catch (err) {
      setError(err.message || 'Erro ao sincronizar')
    }
    setLoading(false)
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">Sincronizar Projetos</h2>
      <div className="card mb-4">
        <p className="text-sm text-zinc-400 mb-4">
          Sincroniza o estado git de todos os projetos registrados (branch, commits, arquivos modificados) e salva na memoria do Orquestra.
        </p>
        <button
          onClick={handleSync}
          disabled={loading}
          className="btn-primary text-sm"
        >
          {loading ? 'Sincronizando...' : 'Sincronizar Agora'}
        </button>
      </div>

      {error && (
        <div className="card border border-red-500/30 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {results && (
        <div>
          <div className="flex gap-3 mb-4">
            <div className="card flex-1 text-center">
              <p className="text-2xl font-bold text-primary">{results.summary?.created || 0}</p>
              <p className="text-xs text-zinc-500">Criados</p>
            </div>
            <div className="card flex-1 text-center">
              <p className="text-2xl font-bold text-blue-400">{results.summary?.updated || 0}</p>
              <p className="text-xs text-zinc-500">Atualizados</p>
            </div>
            <div className="card flex-1 text-center">
              <p className="text-2xl font-bold text-red-400">{results.summary?.errors || 0}</p>
              <p className="text-xs text-zinc-500">Erros</p>
            </div>
          </div>

          <div className="space-y-2">
            {results.projects?.map((p, i) => (
              <div key={i} className="card flex items-start gap-3">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                  p.status === 'created' ? 'bg-green-400' :
                  p.status === 'updated' ? 'bg-blue-400' : 'bg-red-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{p.name}</p>
                  {p.status !== 'error' && p.detail && (
                    <div className="text-xs text-zinc-500 mt-1 space-y-0.5">
                      <p>Branch: <span className="text-zinc-300">{p.detail.branch}</span></p>
                      <p>Commits (7d): <span className="text-zinc-300">{p.detail.commits_7d}</span></p>
                      {p.detail.modified_files?.length > 0 && (
                        <p>Modificados: <span className="text-zinc-300">{p.detail.modified_files.length} arquivo(s)</span></p>
                      )}
                      <p className="text-zinc-600 truncate">{p.detail.last_commit}</p>
                    </div>
                  )}
                  {p.status === 'error' && (
                    <p className="text-xs text-red-400 mt-1">{typeof p.detail === 'string' ? p.detail : 'Erro'}</p>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                  p.status === 'created' ? 'bg-green-500/20 text-green-400' :
                  p.status === 'updated' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
