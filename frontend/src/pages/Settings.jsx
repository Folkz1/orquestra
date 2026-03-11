import { useState } from 'react'
import { syncProjects } from '../api'

export default function Settings() {
  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Configuracoes</h1>
      <SyncTab />
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
