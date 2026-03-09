import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { getProposalPublic, addProposalComment } from '../api'

function renderMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-6 mb-2 text-white">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-8 mb-3 text-white border-b border-zinc-700 pb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-4 text-white">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr class="border-zinc-700 my-6" />')
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
    .replace(/^- (.+)$/gm, '<li class="text-zinc-300 ml-4 list-disc text-sm leading-relaxed">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="text-zinc-300 ml-4 list-decimal text-sm leading-relaxed">$2</li>')
    .replace(/^(?!<[hHluotd]|<li|<hr|<tr|<st)(.+)$/gm, '<p class="text-zinc-300 text-sm leading-relaxed mb-2">$1</p>')
    .replace(/((?:<tr>.*<\/tr>\s*)+)/g, '<table class="w-full border border-zinc-800 rounded-lg overflow-hidden my-4">$1</table>')
    .replace(/((?:<li class="text-zinc-300 ml-4 list-disc.*<\/li>\s*)+)/g, '<ul class="my-2 space-y-1">$1</ul>')
    .replace(/((?:<li class="text-zinc-300 ml-4 list-decimal.*<\/li>\s*)+)/g, '<ol class="my-2 space-y-1">$1</ol>')
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export default function ProposalView() {
  const params = useParams()
  const location = useLocation()
  const slug = params.slug || location.pathname.replace('/proposta/', '')
  const [proposal, setProposal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Selection & annotation
  const [selection, setSelection] = useState(null) // { text, x, y }
  const [annotating, setAnnotating] = useState(null) // { text } - when form is open
  const [annotationText, setAnnotationText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const contentRef = useRef(null)
  const inputRef = useRef(null)

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

  // Detect text selection inside the proposal content
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !contentRef.current) {
      // Don't clear if we're in the annotation form
      if (!annotating) setSelection(null)
      return
    }

    // Only if selection is inside proposal content
    const range = sel.getRangeAt(0)
    if (!contentRef.current.contains(range.commonAncestorContainer)) {
      return
    }

    const text = sel.toString().trim()
    if (text.length < 3) return

    const rect = range.getBoundingClientRect()
    const containerRect = contentRef.current.getBoundingClientRect()

    setSelection({
      text,
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 8,
    })
  }, [annotating])

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseUp])

  const startAnnotation = () => {
    setAnnotating({ text: selection.text })
    setSelection(null)
    setAnnotationText('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const cancelAnnotation = () => {
    setAnnotating(null)
    setAnnotationText('')
  }

  const submitAnnotation = async (e) => {
    e.preventDefault()
    if (!annotationText.trim() || !annotating) return
    setSubmitting(true)
    try {
      const newComment = await addProposalComment(slug, {
        author_name: proposal.client_name,
        content: annotationText.trim(),
        highlighted_text: annotating.text,
      })
      setProposal(prev => ({
        ...prev,
        comments: [...(prev.comments || []), newComment],
      }))
      setAnnotating(null)
      setAnnotationText('')
    } catch (err) {
      alert('Erro ao enviar anotacao')
    }
    setSubmitting(false)
  }

  const handleDownload = () => {
    const html = renderMarkdown(proposal.content)
    const date = new Date(proposal.created_at).toLocaleDateString('pt-BR')
    const printWindow = window.open('', '_blank')
    printWindow.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${proposal.title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #1a1a1a; max-width: 800px; margin: 0 auto; line-height: 1.6; }
  h1 { font-size: 24px; margin: 20px 0 10px; }
  h2 { font-size: 18px; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #e5e5e5; }
  h3 { font-size: 16px; margin: 16px 0 8px; }
  p { font-size: 14px; margin-bottom: 8px; color: #333; }
  strong { color: #000; }
  hr { border: none; border-top: 1px solid #e5e5e5; margin: 24px 0; }
  li { font-size: 14px; margin-left: 20px; margin-bottom: 4px; color: #333; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { padding: 8px 12px; text-align: left; font-size: 14px; border: 1px solid #e5e5e5; }
  th { background: #f5f5f5; font-weight: 600; }
  .header { text-align: center; margin-bottom: 32px; }
  .badge { display: inline-block; background: #eff6ff; color: #2563eb; font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 20px; margin-bottom: 12px; }
  .value-box { display: inline-block; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 12px 24px; margin-top: 12px; }
  .value-label { font-size: 12px; color: #16a34a; }
  .value-amount { font-size: 24px; font-weight: 700; color: #15803d; }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #999; }
  @media print { body { padding: 20px; } }
</style>
</head><body>
<div class="header">
  <div class="badge">PROPOSTA COMERCIAL</div>
  <h1>${proposal.title}</h1>
  <p>Para <strong>${proposal.client_name}</strong> &middot; ${date}</p>
  ${proposal.total_value ? `<div class="value-box"><div class="value-label">Investimento total</div><div class="value-amount">${proposal.total_value}</div></div>` : ''}
</div>
${html}
<div class="footer">
  <p>Diego - Guy Folkz &middot; Automacao & IA para Negocios</p>
  <p>WhatsApp: +55 51 9344-8124</p>
</div>
<script>window.print()<\/script>
</body></html>`)
    printWindow.document.close()
  }

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
  const comments = proposal.comments || []

  return (
    <div className="min-h-screen bg-zinc-950 py-8 px-4">
      <div className="max-w-3xl mx-auto">
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

        {/* Hint + Download */}
        <div className="flex items-center justify-between mb-4 px-1">
          <p className="text-zinc-600 text-xs">Selecione qualquer trecho para anotar</p>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Baixar PDF
          </button>
        </div>

        {/* Content + sidebar annotations */}
        <div className="flex gap-4">
          {/* Main content */}
          <div className="flex-1 min-w-0 relative" ref={contentRef}>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 md:p-8">
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(proposal.content) }} />
            </div>

            {/* Floating "Anotar" button on text selection */}
            {selection && (
              <button
                onClick={startAnnotation}
                style={{ left: `${Math.max(16, Math.min(selection.x - 40, 300))}px`, top: `${selection.y}px` }}
                className="absolute z-50 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg shadow-blue-500/20 -translate-y-full transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                Anotar
              </button>
            )}
          </div>

          {/* Sidebar: annotations */}
          {comments.length > 0 && (
            <div className="hidden md:block w-64 shrink-0">
              <div className="sticky top-8 space-y-3">
                <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2">Anotacoes ({comments.length})</p>
                {comments.map(c => (
                  <div key={c.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-xs">
                    {c.highlighted_text && (
                      <div className="border-l-2 border-blue-500/40 pl-2 mb-2 text-zinc-500 italic line-clamp-2">
                        "{c.highlighted_text}"
                      </div>
                    )}
                    <p className="text-zinc-300 leading-relaxed">{c.content}</p>
                    <div className="flex items-center justify-between mt-2 text-zinc-600">
                      <span>{c.author_name}</span>
                      <span>{timeAgo(c.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Mobile annotations (below content) */}
        {comments.length > 0 && (
          <div className="md:hidden mt-6 space-y-2">
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2">Anotacoes ({comments.length})</p>
            {comments.map(c => (
              <div key={c.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-xs">
                {c.highlighted_text && (
                  <div className="border-l-2 border-blue-500/40 pl-2 mb-2 text-zinc-500 italic line-clamp-2">
                    "{c.highlighted_text}"
                  </div>
                )}
                <p className="text-zinc-300 leading-relaxed">{c.content}</p>
                <div className="flex items-center justify-between mt-2 text-zinc-600">
                  <span>{c.author_name}</span>
                  <span>{timeAgo(c.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Annotation form (floating modal) */}
        {annotating && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={cancelAnnotation}>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
              <div className="border-l-2 border-blue-500 pl-3 mb-4">
                <p className="text-zinc-500 text-xs mb-1">Anotando sobre:</p>
                <p className="text-zinc-300 text-sm italic line-clamp-3">"{annotating.text}"</p>
              </div>
              <form onSubmit={submitAnnotation}>
                <textarea
                  ref={inputRef}
                  placeholder="Sua duvida ou observacao sobre este trecho..."
                  value={annotationText}
                  onChange={e => setAnnotationText(e.target.value)}
                  rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 resize-none focus:outline-none focus:border-blue-500 mb-3"
                />
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={cancelAnnotation} className="text-zinc-500 hover:text-zinc-300 text-sm px-3 py-1.5 transition-colors">
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !annotationText.trim()}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
                  >
                    {submitting ? 'Enviando...' : 'Enviar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-10 text-zinc-600 text-xs">
          <p>Diego - Guy Folkz &middot; Automacao & IA para Negocios</p>
          <p>WhatsApp: +55 51 9344-8124</p>
        </div>
      </div>
    </div>
  )
}
