import { useState, useEffect } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { getProposalPublic } from '../api'

function renderMarkdown(text) {
  if (!text) return ''
  return text
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-6 mb-2 text-white">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-8 mb-3 text-white border-b border-zinc-700 pb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-4 text-white">$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr class="border-zinc-700 my-6" />')
    // Tables
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split('|').filter(c => c.trim())
      if (cells.every(c => /^[\s-]+$/.test(c))) return ''
      const isHeader = cells.some(c => /Total|Valor|Servico|Custo/.test(c))
      const tag = isHeader ? 'th' : 'td'
      const cls = isHeader
        ? 'px-4 py-2 text-left text-sm font-semibold text-zinc-300 bg-zinc-800/50'
        : 'px-4 py-2 text-sm text-zinc-300 border-t border-zinc-800'
      return '<tr>' + cells.map(c => `<${tag} class="${cls}">${c.trim()}</${tag}>`).join('') + '</tr>'
    })
    // List items
    .replace(/^- (.+)$/gm, '<li class="text-zinc-300 ml-4 list-disc text-sm leading-relaxed">$1</li>')
    // Numbered list
    .replace(/^(\d+)\. (.+)$/gm, '<li class="text-zinc-300 ml-4 list-decimal text-sm leading-relaxed">$2</li>')
    // Paragraphs (lines that aren't already HTML)
    .replace(/^(?!<[hHluotd]|<li|<hr|<tr|<st)(.+)$/gm, '<p class="text-zinc-300 text-sm leading-relaxed mb-2">$1</p>')
    // Wrap table rows
    .replace(/((?:<tr>.*<\/tr>\s*)+)/g, '<table class="w-full border border-zinc-800 rounded-lg overflow-hidden my-4">$1</table>')
    // Wrap list items
    .replace(/((?:<li class="text-zinc-300 ml-4 list-disc.*<\/li>\s*)+)/g, '<ul class="my-2 space-y-1">$1</ul>')
    .replace(/((?:<li class="text-zinc-300 ml-4 list-decimal.*<\/li>\s*)+)/g, '<ol class="my-2 space-y-1">$1</ol>')
}

export default function ProposalView() {
  const params = useParams()
  const location = useLocation()
  // Extract slug from URL path when rendered outside <Route> (public route)
  const slug = params.slug || location.pathname.replace('/proposta/', '')
  const [proposal, setProposal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const data = await getProposalPublic(slug)
        setProposal(data)
      } catch (err) {
        setError(err.message)
      }
      setLoading(false)
    })()
  }, [slug])

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-zinc-400 mb-2">404</h1>
          <p className="text-zinc-500">Proposta nao encontrada</p>
        </div>
      </div>
    )
  }

  const date = new Date(proposal.created_at).toLocaleDateString('pt-BR')

  return (
    <div className="min-h-screen bg-zinc-950 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-full px-4 py-1.5 mb-4">
            <div className="w-2 h-2 bg-blue-500 rounded-full" />
            <span className="text-blue-400 text-xs font-medium">PROPOSTA COMERCIAL</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">{proposal.title}</h1>
          <p className="text-zinc-400 text-sm">
            Para <span className="text-white font-medium">{proposal.client_name}</span> &middot; {date}
          </p>
          {proposal.total_value && (
            <div className="mt-4 inline-block bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-6 py-3">
              <span className="text-emerald-400 text-sm">Investimento total</span>
              <p className="text-emerald-300 text-2xl font-bold">{proposal.total_value}</p>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 md:p-8">
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(proposal.content) }} />
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-zinc-600 text-xs">
          <p>Diego - Guy Folkz &middot; Automacao & IA para Negocios</p>
          <p>WhatsApp: +55 51 9344-8124</p>
        </div>
      </div>
    </div>
  )
}
