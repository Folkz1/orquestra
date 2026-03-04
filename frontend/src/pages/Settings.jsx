import { useState, useEffect } from 'react'
import { syncProjects, getNotionDatabases, importNotion, getNotionStatus } from '../api'

export default function Settings() {
  const [tab, setTab] = useState('sync')

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Configuracoes</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('sync')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'sync'
              ? 'bg-primary/20 text-primary'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Sync Projetos
        </button>
        <button
          onClick={() => setTab('notion')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'notion'
              ? 'bg-primary/20 text-primary'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Import Notion
        </button>
      </div>

      {tab === 'sync' && <SyncTab />}
      {tab === 'notion' && <NotionTab />}
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
          {/* Summary */}
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

          {/* Project list */}
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

function NotionTab() {
  const [status, setStatus] = useState(null)
  const [databases, setDatabases] = useState(null)
  const [loadingDbs, setLoadingDbs] = useState(false)
  const [importing, setImporting] = useState(null) // database_id being imported
  const [importResults, setImportResults] = useState({}) // {db_id: result}
  const [error, setError] = useState(null)

  useEffect(() => {
    getNotionStatus().then(setStatus).catch(() => {})
  }, [])

  const handleListDatabases = async () => {
    setLoadingDbs(true)
    setError(null)
    try {
      const data = await getNotionDatabases()
      setDatabases(data.databases || [])
    } catch (err) {
      setError(err.message || 'Erro ao listar databases')
    }
    setLoadingDbs(false)
  }

  const handleImport = async (db) => {
    setImporting(db.id)
    try {
      const result = await importNotion({
        database_id: db.id,
        database_name: db.title,
      })
      setImportResults(prev => ({ ...prev, [db.id]: result }))
      // Refresh status
      getNotionStatus().then(setStatus).catch(() => {})
    } catch (err) {
      setImportResults(prev => ({ ...prev, [db.id]: { error: err.message } }))
    }
    setImporting(null)
  }

  return (
    <div>
      <div className="card mb-4">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-3 h-3 rounded-full ${status?.configured ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-sm text-zinc-400">
            {status?.configured
              ? `Notion configurado (${status.notion_memories} memorias importadas)`
              : 'NOTION_API_KEY nao configurada no .env'}
          </span>
        </div>

        <button
          onClick={handleListDatabases}
          disabled={loadingDbs || !status?.configured}
          className="btn-primary text-sm"
        >
          {loadingDbs ? 'Carregando...' : 'Listar Databases'}
        </button>
      </div>

      {error && (
        <div className="card border border-red-500/30 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {databases && (
        <div className="space-y-2">
          {databases.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhuma database encontrada. Verifique as permissoes da integracao no Notion.</p>
          ) : (
            databases.map((db) => (
              <div key={db.id} className="card flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{db.title}</p>
                  <p className="text-xs text-zinc-600 truncate">{db.id}</p>
                </div>

                {importResults[db.id] ? (
                  importResults[db.id].error ? (
                    <span className="text-xs text-red-400">{importResults[db.id].error}</span>
                  ) : (
                    <span className="text-xs text-green-400">
                      {importResults[db.id].imported}/{importResults[db.id].total_pages} importadas
                    </span>
                  )
                ) : (
                  <button
                    onClick={() => handleImport(db)}
                    disabled={importing === db.id}
                    className="btn-primary text-xs px-3 py-1 shrink-0"
                  >
                    {importing === db.id ? 'Importando...' : 'Importar'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
