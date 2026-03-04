import { useState, useEffect } from 'react'
import { getBriefs, getBrief, generateBrief } from '../api'

function formatDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function BriefDetail({ brief, onClose }) {
  return (
    <div className="animate-fade-in">
      <button
        onClick={onClose}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 mb-4 transition-colors"
      >
        <span>&#8592;</span> Voltar
      </button>

      <div className="card">
        <h2 className="text-lg font-semibold mb-1">
          Briefing - {formatDate(brief.date || brief.created_at)}
        </h2>

        {brief.period && (
          <p className="text-xs text-zinc-500 mb-4">{brief.period}</p>
        )}

        {/* Summary */}
        {brief.summary && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-primary mb-2">Resumo</h3>
            <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {brief.summary}
            </p>
          </div>
        )}

        {/* Pending Actions */}
        {brief.pending_actions && brief.pending_actions.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-yellow-400 mb-2">
              Acoes Pendentes
            </h3>
            <ul className="space-y-1">
              {brief.pending_actions.map((action, i) => (
                <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                  <span className="text-yellow-400 mt-0.5">&#9679;</span>
                  {typeof action === 'string' ? action : action.description || JSON.stringify(action)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Decisions */}
        {brief.decisions && brief.decisions.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-blue-400 mb-2">Decisoes</h3>
            <ul className="space-y-1">
              {brief.decisions.map((decision, i) => (
                <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">&#9679;</span>
                  {typeof decision === 'string' ? decision : decision.description || JSON.stringify(decision)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Insights */}
        {brief.insights && brief.insights.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-purple-400 mb-2">Insights</h3>
            <ul className="space-y-1">
              {brief.insights.map((insight, i) => (
                <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                  <span className="text-purple-400 mt-0.5">&#9679;</span>
                  {typeof insight === 'string' ? insight : insight.description || JSON.stringify(insight)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Projects mentioned */}
        {brief.projects && brief.projects.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Projetos Mencionados</h3>
            <div className="flex flex-wrap gap-2">
              {brief.projects.map((proj, i) => (
                <span key={i} className="badge-green">
                  {typeof proj === 'string' ? proj : proj.name || JSON.stringify(proj)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="flex gap-4 text-xs text-zinc-500 pt-4 border-t border-zinc-800">
          {brief.total_messages !== undefined && (
            <span>💬 {brief.total_messages} mensagens</span>
          )}
          {brief.total_recordings !== undefined && (
            <span>🎙️ {brief.total_recordings} gravacoes</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Briefs() {
  const [briefs, setBriefs] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [selectedBrief, setSelectedBrief] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const loadBriefs = async () => {
    setLoading(true)
    try {
      const data = await getBriefs()
      const list = Array.isArray(data) ? data : data.items || data.briefs || []
      // Sort by date DESC
      list.sort((a, b) => {
        const dateA = new Date(a.date || a.created_at || 0)
        const dateB = new Date(b.date || b.created_at || 0)
        return dateB - dateA
      })
      setBriefs(list)
    } catch (err) {
      console.error('[Briefs] Failed to load:', err)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadBriefs()
  }, [])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      await generateBrief()
      await loadBriefs()
    } catch (err) {
      console.error('[Briefs] Generate failed:', err)
    }
    setGenerating(false)
  }

  const openBrief = async (brief) => {
    setDetailLoading(true)
    try {
      if (brief.id) {
        const full = await getBrief(brief.id)
        setSelectedBrief(full)
      } else {
        setSelectedBrief(brief)
      }
    } catch {
      setSelectedBrief(brief)
    }
    setDetailLoading(false)
  }

  if (detailLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  if (selectedBrief) {
    return (
      <BriefDetail
        brief={selectedBrief}
        onClose={() => setSelectedBrief(null)}
      />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Briefings</h1>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="btn-primary text-sm"
        >
          {generating ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-zinc-800 border-t-transparent rounded-full animate-spin" />
              Gerando...
            </span>
          ) : (
            'Gerar Briefing'
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-primary rounded-full animate-spin" />
        </div>
      ) : briefs.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-4xl mb-3">📋</p>
          <p>Nenhum briefing gerado</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-primary text-sm mt-4"
          >
            Gerar primeiro briefing
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {briefs.map((brief, idx) => (
            <div
              key={brief.id || idx}
              onClick={() => openBrief(brief)}
              className="card cursor-pointer hover:border-zinc-700 transition-colors animate-fade-in"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-medium text-zinc-100">
                  {formatDate(brief.date || brief.created_at)}
                </h3>
                <div className="flex gap-3 text-xs text-zinc-500">
                  {brief.total_messages !== undefined && (
                    <span>💬 {brief.total_messages}</span>
                  )}
                  {brief.total_recordings !== undefined && (
                    <span>🎙️ {brief.total_recordings}</span>
                  )}
                </div>
              </div>

              {brief.summary && (
                <p className="text-sm text-zinc-400 line-clamp-2">
                  {brief.summary}
                </p>
              )}

              {brief.projects && brief.projects.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {brief.projects.slice(0, 5).map((proj, i) => (
                    <span key={i} className="badge-green text-xs">
                      {typeof proj === 'string' ? proj : proj.name}
                    </span>
                  ))}
                  {brief.projects.length > 5 && (
                    <span className="badge-zinc text-xs">
                      +{brief.projects.length - 5}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
