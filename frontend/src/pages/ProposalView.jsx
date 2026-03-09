import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { getProposalPublic, addProposalComment, deleteProposalComment, trackProposalEvent } from '../api'

// Generate a stable session ID per browser tab visit
function getSessionId() {
  let sid = sessionStorage.getItem('proposal_sid')
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36)
    sessionStorage.setItem('proposal_sid', sid)
  }
  return sid
}

function renderMarkdown(text) {
  if (!text) return ''

  const lines = text.split('\n')
  const processed = []
  let metaBlock = []

  const flushMeta = () => {
    if (metaBlock.length > 0) {
      processed.push('{{META_BLOCK}}' + metaBlock.join('{{BR}}') + '{{/META_BLOCK}}')
      metaBlock = []
    }
  }

  for (const line of lines) {
    if (/^\*\*[^*]+:\*\*/.test(line.trim())) {
      metaBlock.push(line)
    } else {
      flushMeta()
      processed.push(line)
    }
  }
  flushMeta()

  return processed.join('\n')
    .replace(/\{\{META_BLOCK\}\}([\s\S]*?)\{\{\/META_BLOCK\}\}/g, (_, content) => {
      const html = content
        .split('{{BR}}')
        .map(l => l.replace(/\*\*(.+?)\*\*/g, '<strong class="text-zinc-400 font-medium">$1</strong>'))
        .join('<br />')
      return `<div class="text-zinc-300 text-sm leading-loose mb-4 bg-zinc-800/30 rounded-lg px-4 py-3">${html}</div>`
    })
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-6 mb-2 text-white">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-8 mb-3 text-white border-b border-zinc-700 pb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-4 text-white">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr class="border-zinc-700 my-6" />')
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split('|').filter(c => c.trim())
      if (cells.every(c => /^[\s-]+$/.test(c))) return ''
      const isHeader = cells.some(c => /Total|Valor|Servi|Custo/.test(c))
      const tag = isHeader ? 'th' : 'td'
      const cls = isHeader
        ? 'px-4 py-2 text-left text-sm font-semibold text-zinc-300 bg-zinc-800/50'
        : 'px-4 py-2 text-sm text-zinc-300 border-t border-zinc-800'
      return '<tr>' + cells.map(c => `<${tag} class="${cls}">${c.trim()}</${tag}>`).join('') + '</tr>'
    })
    .replace(/^- (.+)$/gm, '<li class="text-zinc-300 ml-4 list-disc text-sm leading-relaxed">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="text-zinc-300 ml-4 list-decimal text-sm leading-relaxed">$2</li>')
    .replace(/^(?!<[hHluotd]|<li|<hr|<tr|<st|<div)(.+)$/gm, '<p class="text-zinc-300 text-sm leading-relaxed mb-2">$1</p>')
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

// Animated tutorial overlay
function TutorialOverlay({ onDismiss, isMobile }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (step < 3) {
      const t = setTimeout(() => setStep(s => s + 1), 2200)
      return () => clearTimeout(t)
    }
  }, [step])

  const steps = [
    {
      emoji: isMobile ? '\uD83D\uDC46' : '\uD83D\uDDB1\uFE0F',
      title: isMobile ? 'Toque e segure no texto' : 'Selecione um trecho',
      desc: isMobile
        ? 'Pressione e segure qualquer parte do texto para selecionar'
        : 'Clique e arraste sobre o texto que deseja comentar',
    },
    {
      emoji: '\uD83D\uDCAC',
      title: 'Toque em "Anotar"',
      desc: isMobile
        ? 'Um botão aparecerá na parte inferior da tela'
        : 'Um botão azul aparecerá próximo ao texto selecionado',
    },
    {
      emoji: '\u270D\uFE0F',
      title: 'Escreva sua observação',
      desc: 'Digite sua dúvida ou comentário e envie',
    },
  ]

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-4" onClick={onDismiss}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <p className="text-zinc-500 text-xs uppercase tracking-widest mb-5 text-center">Como anotar esta proposta</p>

        <div className="space-y-4 mb-6">
          {steps.map((s, i) => (
            <div
              key={i}
              className="flex items-start gap-3 transition-all duration-500"
              style={{
                opacity: i <= step ? 1 : 0.15,
                transform: i <= step ? 'translateX(0)' : 'translateX(12px)',
                transitionDelay: `${i * 100}ms`,
              }}
            >
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0 transition-all duration-500 ${
                i === step ? 'bg-blue-500/20 ring-2 ring-blue-500 scale-110' : i < step ? 'bg-emerald-500/15' : 'bg-zinc-800'
              }`}>
                {i < step ? '\u2713' : s.emoji}
              </div>
              <div>
                <p className={`text-sm font-medium transition-colors duration-300 ${i === step ? 'text-white' : i < step ? 'text-zinc-400' : 'text-zinc-600'}`}>{s.title}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Animated demo preview */}
        <div className="bg-zinc-800/50 rounded-xl p-4 mb-5 relative overflow-hidden h-20">
          {/* Simulated text lines */}
          <div className="space-y-1.5">
            <div className="h-2 bg-zinc-700/50 rounded w-full" />
            <div className="relative h-2 rounded w-4/5">
              <div className="absolute inset-0 bg-zinc-700/50 rounded" />
              {/* Moving highlight */}
              <div
                className="absolute inset-y-0 bg-blue-500/30 rounded transition-all duration-1000"
                style={{
                  left: step >= 1 ? '10%' : '50%',
                  right: step >= 1 ? '15%' : '50%',
                  opacity: step >= 1 ? 1 : 0,
                }}
              />
            </div>
            <div className="h-2 bg-zinc-700/50 rounded w-3/5" />
            <div className="h-2 bg-zinc-700/50 rounded w-full" />
          </div>
          {/* Simulated floating button */}
          <div
            className="absolute bg-blue-600 text-white text-[9px] px-2 py-0.5 rounded transition-all duration-500"
            style={{
              top: step >= 2 ? '8px' : '20px',
              right: '24px',
              opacity: step >= 2 ? 1 : 0,
              transform: step >= 2 ? 'scale(1)' : 'scale(0.8)',
            }}
          >
            Anotar
          </div>
        </div>

        <button
          onClick={onDismiss}
          className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
            step >= 2
              ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'
          }`}
        >
          {step >= 2 ? 'Entendi!' : 'Pular'}
        </button>
      </div>
    </div>
  )
}

export default function ProposalView() {
  const params = useParams()
  const location = useLocation()
  const slug = params.slug || location.pathname.replace('/proposta/', '')
  const [proposal, setProposal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Selection & annotation
  const [selection, setSelection] = useState(null)
  const [annotating, setAnnotating] = useState(null)
  const [annotationText, setAnnotationText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const contentRef = useRef(null)
  const inputRef = useRef(null)

  // Mobile & tutorial
  const [isMobile, setIsMobile] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const sessionId = useRef(getSessionId())
  const timeOnPage = useRef(0)
  const maxScroll = useRef(0)
  const sectionsViewed = useRef(new Set())

  // Helper: fire analytics event (fire-and-forget)
  const track = useCallback((eventType, eventData = {}) => {
    if (!slug) return
    trackProposalEvent(slug, {
      session_id: sessionId.current,
      event_type: eventType,
      event_data: eventData,
    })
  }, [slug])

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024 || 'ontouchstart' in window)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Show tutorial on first visit
  useEffect(() => {
    if (proposal && !localStorage.getItem(`proposal-tutorial-${slug}`)) {
      const t = setTimeout(() => setShowTutorial(true), 1000)
      return () => clearTimeout(t)
    }
  }, [proposal, slug])

  const dismissTutorial = () => {
    setShowTutorial(false)
    localStorage.setItem(`proposal-tutorial-${slug}`, '1')
  }

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

  // ─── Analytics tracking ─────────────────────────────────────────────────

  // Track page_view on load
  useEffect(() => {
    if (proposal) {
      track('page_view', { device: isMobile ? 'mobile' : 'desktop' })
    }
  }, [proposal, isMobile, track])

  // Track time_on_page every 15 seconds
  useEffect(() => {
    if (!proposal) return
    const interval = setInterval(() => {
      timeOnPage.current += 15
      track('time_on_page', { seconds: timeOnPage.current })
    }, 15000)
    return () => {
      clearInterval(interval)
      if (timeOnPage.current > 0) {
        track('time_on_page', { seconds: timeOnPage.current, final: true })
      }
    }
  }, [proposal, track])

  // Track scroll depth
  useEffect(() => {
    if (!proposal || !contentRef.current) return
    const handleScroll = () => {
      const el = contentRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const viewHeight = window.innerHeight
      const totalHeight = el.scrollHeight
      const scrolled = Math.max(0, -rect.top + viewHeight)
      const pct = Math.min(100, Math.round((scrolled / totalHeight) * 100))
      if (pct > maxScroll.current) {
        maxScroll.current = pct
        // Only send at milestones: 25, 50, 75, 100
        if (pct >= 25 && (pct === 25 || pct === 50 || pct === 75 || pct >= 95)) {
          track('scroll_depth', { pct })
        }
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [proposal, track])

  // Track section views (Intersection Observer on h2/h3)
  useEffect(() => {
    if (!proposal || !contentRef.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const section = entry.target.textContent?.trim()
            if (section && !sectionsViewed.current.has(section)) {
              sectionsViewed.current.add(section)
              track('section_view', { section })
            }
          }
        })
      },
      { threshold: 0.5 }
    )
    // Observe headings in the rendered content
    const headings = contentRef.current.querySelectorAll('h2, h3')
    headings.forEach((h) => observer.observe(h))
    return () => observer.disconnect()
  }, [proposal, track])

  // ─── End analytics ──────────────────────────────────────────────────────

  // Universal selection detection: selectionchange (mobile) + mouseup (desktop backup)
  useEffect(() => {
    let debounce
    const handleSelection = () => {
      clearTimeout(debounce)
      debounce = setTimeout(() => {
        if (annotating) return
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || !contentRef.current) {
          if (!annotating) setSelection(null)
          return
        }
        try {
          const range = sel.getRangeAt(0)
          if (!contentRef.current.contains(range.commonAncestorContainer)) return
          const text = sel.toString().trim()
          if (text.length < 3) return
          const rect = range.getBoundingClientRect()
          const containerRect = contentRef.current.getBoundingClientRect()
          setSelection({
            text,
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top - containerRect.top - 8,
          })
        } catch { /* ignore */ }
      }, 200)
    }
    document.addEventListener('selectionchange', handleSelection)
    document.addEventListener('mouseup', handleSelection)
    return () => {
      document.removeEventListener('selectionchange', handleSelection)
      document.removeEventListener('mouseup', handleSelection)
      clearTimeout(debounce)
    }
  }, [annotating])

  const startAnnotation = () => {
    setAnnotating({ text: selection.text })
    setSelection(null)
    setAnnotationText('')
    window.getSelection()?.removeAllRanges()
    setTimeout(() => inputRef.current?.focus(), 100)
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
      track('annotation', { text_length: annotationText.trim().length, highlighted_length: annotating.text.length })
    } catch {
      alert('Erro ao enviar anotação')
    }
    setSubmitting(false)
  }

  const handleDeleteComment = async (commentId) => {
    if (!confirm('Excluir esta anotação?')) return
    try {
      await deleteProposalComment(slug, commentId)
      setProposal(prev => ({
        ...prev,
        comments: (prev.comments || []).filter(c => c.id !== commentId),
      }))
    } catch {
      alert('Erro ao excluir anotação')
    }
  }

  const scrollToHighlight = (highlightedText) => {
    if (!highlightedText || !contentRef.current) return
    const walker = document.createTreeWalker(contentRef.current, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf(highlightedText.slice(0, 40))
      if (idx !== -1) {
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, Math.min(idx + highlightedText.length, node.textContent.length))
        const rect = range.getBoundingClientRect()
        window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 3, behavior: 'smooth' })
        // Flash highlight
        const mark = document.createElement('mark')
        mark.className = 'bg-blue-500/30 rounded transition-all duration-1000'
        range.surroundContents(mark)
        setTimeout(() => {
          const parent = mark.parentNode
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
          parent.removeChild(mark)
        }, 2000)
        return
      }
    }
  }

  const handleDownload = () => {
    track('download_pdf')
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
  <p>Diego - Guy Folkz &middot; Automação & IA para Negócios</p>
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
          <p className="text-zinc-500">Proposta não encontrada</p>
        </div>
      </div>
    )
  }

  const date = new Date(proposal.created_at).toLocaleDateString('pt-BR')
  const comments = proposal.comments || []

  return (
    <div className="min-h-screen bg-zinc-950 py-6 md:py-10 px-4">
      {/* Tutorial overlay */}
      {showTutorial && <TutorialOverlay onDismiss={dismissTutorial} isMobile={isMobile} />}

      <div className={`mx-auto ${comments.length > 0 ? 'max-w-5xl' : 'max-w-3xl'} transition-all`}>
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-full px-4 py-1.5 mb-4">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-blue-400 text-xs font-medium tracking-wide">PROPOSTA COMERCIAL</span>
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

        {/* Hint + Download + Help */}
        <div className="flex items-center justify-between mb-4 px-1 max-w-3xl mx-auto">
          <button
            onClick={() => setShowTutorial(true)}
            className="text-zinc-600 hover:text-zinc-400 text-xs flex items-center gap-1.5 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Como anotar
          </button>
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
        <div className="flex gap-6 items-start">
          {/* Main content */}
          <div className="flex-1 min-w-0 max-w-3xl relative" ref={contentRef}>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 md:p-8">
              <div
                className="proposal-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(proposal.content) }}
              />
            </div>

            {/* Desktop: Floating "Anotar" button near selection */}
            {selection && !isMobile && (
              <button
                onClick={startAnnotation}
                style={{ left: `${Math.max(16, Math.min(selection.x - 40, 300))}px`, top: `${selection.y}px` }}
                className="absolute z-50 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg shadow-blue-500/20 -translate-y-full transition-colors flex items-center gap-1.5 animate-fade-in"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                Anotar
              </button>
            )}
          </div>

          {/* Sidebar: annotations (desktop) */}
          {comments.length > 0 && (
            <div className="hidden lg:block w-72 shrink-0">
              <div className="sticky top-8 space-y-3 max-h-[calc(100vh-4rem)] overflow-y-auto pr-1">
                <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2">
                  Anotações ({comments.length})
                </p>
                {comments.map(c => (
                  <div
                    key={c.id}
                    className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-xs group cursor-pointer hover:border-zinc-700 transition-colors"
                    onClick={() => scrollToHighlight(c.highlighted_text)}
                  >
                    {c.highlighted_text && (
                      <div className="border-l-2 border-blue-500/40 pl-2 mb-2 text-zinc-500 italic line-clamp-2">
                        &ldquo;{c.highlighted_text}&rdquo;
                      </div>
                    )}
                    <p className="text-zinc-300 leading-relaxed">{c.content}</p>
                    <div className="flex items-center justify-between mt-2 text-zinc-600">
                      <span>{c.author_name}</span>
                      <div className="flex items-center gap-2">
                        <span>{timeAgo(c.created_at)}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteComment(c.id) }}
                          className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
                          title="Excluir"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Mobile: Fixed bottom bar when text is selected */}
        {selection && isMobile && (
          <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-gradient-to-t from-zinc-950 via-zinc-950 to-transparent pt-8">
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-3 flex items-center gap-3 shadow-2xl max-w-lg mx-auto">
              <div className="flex-1 min-w-0">
                <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Trecho selecionado</p>
                <p className="text-zinc-300 text-xs truncate mt-0.5">&ldquo;{selection.text}&rdquo;</p>
              </div>
              <button
                onClick={startAnnotation}
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2.5 rounded-xl shrink-0 flex items-center gap-2 shadow-lg shadow-blue-500/20"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                Anotar
              </button>
            </div>
          </div>
        )}

        {/* Mobile annotations (below content) */}
        {comments.length > 0 && (
          <div className="lg:hidden mt-6 space-y-2">
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2">
              Anotações ({comments.length})
            </p>
            {comments.map(c => (
              <div
                key={c.id}
                className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-xs"
                onClick={() => scrollToHighlight(c.highlighted_text)}
              >
                {c.highlighted_text && (
                  <div className="border-l-2 border-blue-500/40 pl-2 mb-2 text-zinc-500 italic line-clamp-2">
                    &ldquo;{c.highlighted_text}&rdquo;
                  </div>
                )}
                <p className="text-zinc-300 leading-relaxed">{c.content}</p>
                <div className="flex items-center justify-between mt-2 text-zinc-600">
                  <span>{c.author_name}</span>
                  <div className="flex items-center gap-2">
                    <span>{timeAgo(c.created_at)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteComment(c.id) }}
                      className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                      title="Excluir"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Annotation form (modal - works on mobile + desktop) */}
        {annotating && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={cancelAnnotation}>
            <div className="bg-zinc-900 border-t sm:border border-zinc-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="border-l-2 border-blue-500 pl-3 mb-4">
                <p className="text-zinc-500 text-xs mb-1">Anotando sobre:</p>
                <p className="text-zinc-300 text-sm italic line-clamp-3">&ldquo;{annotating.text}&rdquo;</p>
              </div>
              <form onSubmit={submitAnnotation}>
                <textarea
                  ref={inputRef}
                  placeholder="Sua dúvida ou observação sobre este trecho..."
                  value={annotationText}
                  onChange={e => setAnnotationText(e.target.value)}
                  rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 mb-3"
                />
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={cancelAnnotation} className="text-zinc-500 hover:text-zinc-300 text-sm px-3 py-2 transition-colors">
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !annotationText.trim()}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm px-5 py-2 rounded-lg transition-colors font-medium"
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
          <p>Diego - Guy Folkz &middot; Automação & IA para Negócios</p>
          <p className="mt-0.5">WhatsApp: +55 51 9344-8124</p>
        </div>
      </div>
    </div>
  )
}
