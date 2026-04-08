import { useState, useEffect, useCallback, useRef } from 'react'

const API = import.meta.env.VITE_API_URL || ''

// ─── Community Auth (separate from Orquestra admin) ──────────────────────────

function getCommunityToken() {
  return localStorage.getItem('community_token') || ''
}

function setCommunityToken(token) {
  localStorage.setItem('community_token', token)
}

function clearCommunityToken() {
  localStorage.removeItem('community_token')
}

function communityHeaders() {
  const token = getCommunityToken()
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

async function communityRequest(path, options = {}) {
  const headers = { ...communityHeaders(), ...options.headers }
  if (options.body instanceof FormData) {
    delete headers['Content-Type']
  }
  const res = await fetch(`${API}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    try { err.data = await res.json() } catch {}
    throw err
  }
  if (res.status === 204) return null
  return res.json()
}

// ─── Constants ───────────────────────────────────────────────────────────────

const POST_TYPES = {
  discussion: { label: 'Discussao', color: '#5ea6ff', bg: 'rgba(94,166,255,0.12)' },
  resource: { label: 'Recurso', color: '#8bd450', bg: 'rgba(139,212,80,0.12)' },
  announcement: { label: 'Anuncio', color: '#f5c842', bg: 'rgba(245,200,66,0.12)' },
  question: { label: 'Pergunta', color: '#c084fc', bg: 'rgba(192,132,252,0.12)' },
}

const RESOURCE_TYPES = {
  template: { label: 'Template', color: '#5ea6ff' },
  playbook: { label: 'Playbook', color: '#8bd450' },
  tool: { label: 'Ferramenta', color: '#f5c842' },
  video: { label: 'Video', color: '#FF3333' },
}

const COURSES = [
  {
    id: 'claude-code',
    title: 'Stack Claude Code',
    description: 'Domine o setup completo: CLAUDE.md, skills, hooks, agentes autonomos e orchestrator.',
    lessons: [
      { id: 1, title: 'Setup inicial do CLAUDE.md', done: true },
      { id: 2, title: 'Skills e comandos customizados', done: true },
      { id: 3, title: 'Hooks e automacoes', done: false },
      { id: 4, title: 'Agent Team e delegacao', done: false },
      { id: 5, title: 'Memory e sessoes', done: false },
    ],
  },
  {
    id: 'harness',
    title: 'Harness Design',
    description: 'Pipeline autonomo com gates, sprint contracts, REFINE/PIVOT e execucao continua.',
    lessons: [
      { id: 1, title: 'Conceito de Harness', done: false },
      { id: 2, title: 'Gate system e validacao', done: false },
      { id: 3, title: 'Sprint Contract e escopo', done: false },
      { id: 4, title: 'REFINE vs PIVOT', done: false },
    ],
  },
  {
    id: 'agent-lab',
    title: 'Agent Lab',
    description: 'Crie agentes WhatsApp, bots de vendas e assistentes com Vercel AI SDK.',
    lessons: [
      { id: 1, title: 'Arquitetura de agentes', done: false },
      { id: 2, title: 'Evolution API + WhatsApp', done: false },
      { id: 3, title: 'Vercel AI SDK streaming', done: false },
      { id: 4, title: 'Tools e function calling', done: false },
      { id: 5, title: 'Deploy e monitoramento', done: false },
    ],
  },
  {
    id: 'remotion',
    title: 'Remotion Pipeline',
    description: 'Producao de video programatico: componentes React, render farm, shorts automaticos.',
    lessons: [
      { id: 1, title: 'Setup do Remotion', done: false },
      { id: 2, title: 'Componentes de video', done: false },
      { id: 3, title: 'Timeline e animacoes', done: false },
      { id: 4, title: 'Render farm distribuido', done: false },
    ],
  },
]

const MOCK_FEED = [
  {
    id: 1, post_type: 'announcement', author_name: 'Diego', author_role: 'admin',
    content_md: 'Bem-vindos a comunidade GuyFolkz! Aqui compartilho tudo que uso no dia a dia para gerar receita com IA e automacao. Comecem pelo modulo Stack Claude Code.',
    created_at: new Date(Date.now() - 3600000).toISOString(), likes_count: 24, comments_count: 8, liked_by_me: false,
  },
  {
    id: 2, post_type: 'resource', author_name: 'Diego', author_role: 'admin',
    content_md: 'Novo template de CLAUDE.md disponivel na aba Recursos. Esse e o mesmo que uso em todos os meus projetos. Baixa e adapta pro teu contexto.',
    created_at: new Date(Date.now() - 86400000).toISOString(), likes_count: 18, comments_count: 5, liked_by_me: false,
  },
  {
    id: 3, post_type: 'discussion', author_name: 'Thales', author_role: 'member',
    content_md: 'Acabei de configurar meu primeiro orchestrator seguindo o modulo 2. A sensacao de ver o agente rodando sozinho e surreal. Alguem mais ja testou com mais de 3 projetos simultaneos?',
    created_at: new Date(Date.now() - 172800000).toISOString(), likes_count: 11, comments_count: 3, liked_by_me: false,
  },
  {
    id: 4, post_type: 'question', author_name: 'Marcos', author_role: 'member',
    content_md: 'Estou com duvida sobre o heartbeat daemon. Ele roda em background no Windows tambem ou precisa de WSL? Meu setup e Windows 11 + PowerShell.',
    created_at: new Date(Date.now() - 259200000).toISOString(), likes_count: 5, comments_count: 2, liked_by_me: false,
  },
]

const MOCK_MEMBERS = [
  { enrollment_id: 1, name: 'Diego', role: 'admin', enrolled_at: '2025-01-15', post_count: 142, color: '#FF3333' },
  { enrollment_id: 2, name: 'Thales', role: 'member', enrolled_at: '2025-02-10', post_count: 28, color: '#5ea6ff' },
  { enrollment_id: 3, name: 'Marcos', role: 'member', enrolled_at: '2025-02-18', post_count: 15, color: '#8bd450' },
  { enrollment_id: 4, name: 'Rafael', role: 'member', enrolled_at: '2025-03-01', post_count: 9, color: '#c084fc' },
  { enrollment_id: 5, name: 'Lucas', role: 'member', enrolled_at: '2025-03-05', post_count: 7, color: '#f5c842' },
  { enrollment_id: 6, name: 'Ana', role: 'member', enrolled_at: '2025-03-10', post_count: 4, color: '#67d7d0' },
  { enrollment_id: 7, name: 'Pedro', role: 'member', enrolled_at: '2025-03-12', post_count: 3, color: '#ff6b6b' },
  { enrollment_id: 8, name: 'Carla', role: 'member', enrolled_at: '2025-03-15', post_count: 2, color: '#ffa94d' },
]

const MOCK_RESOURCES = [
  { id: 1, title: 'Template CLAUDE.md Pro', description: 'O mesmo CLAUDE.md usado em 8+ projetos ativos gerando R$15k+ MRR.', resource_type: 'template', downloads_count: 87 },
  { id: 2, title: 'Playbook Motor 100K', description: 'Priorizacao por impacto financeiro, scoring de backlog e execucao autonoma.', resource_type: 'playbook', downloads_count: 54 },
  { id: 3, title: 'Script Heartbeat Daemon', description: 'Daemon que monitora agentes, envia alertas e dispara acoes automaticas.', resource_type: 'tool', downloads_count: 41 },
  { id: 4, title: 'React Series Completa', description: 'Todos os 4 videos da serie React sobre Claude Code, do zero ao avancado.', resource_type: 'video', downloads_count: 112 },
  { id: 5, title: 'Skills Pack Jarbas', description: 'Pack com 15 skills prontas: delegar, proposta, deploy, validar e mais.', resource_type: 'template', downloads_count: 63 },
  { id: 6, title: 'Pipeline de Video Remotion', description: 'Setup completo para gerar shorts e long-form programaticamente.', resource_type: 'tool', downloads_count: 29 },
]

const MOCK_LEADERBOARD = [
  { name: 'Diego', posts: 142, likes: 340 },
  { name: 'Thales', posts: 28, likes: 67 },
  { name: 'Marcos', posts: 15, likes: 31 },
  { name: 'Rafael', posts: 9, likes: 18 },
  { name: 'Lucas', posts: 7, likes: 12 },
]

// ─── Utility ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}m`
}

function InitialAvatar({ name, color, size = 40 }) {
  const initial = (name || '?')[0].toUpperCase()
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: color || '#FF3333',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.4, fontWeight: 700, color: '#fff',
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  )
}

function RoleBadge({ role }) {
  if (role === 'admin') {
    return (
      <span style={{
        background: 'rgba(245,200,66,0.15)', color: '#f5c842',
        fontSize: 10, fontWeight: 600, padding: '2px 8px',
        borderRadius: 9999, textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        Admin
      </span>
    )
  }
  return (
    <span style={{
      background: 'rgba(255,255,255,0.06)', color: '#a1a1aa',
      fontSize: 10, fontWeight: 500, padding: '2px 8px',
      borderRadius: 9999,
    }}>
      Membro
    </span>
  )
}

function PostTypeBadge({ type }) {
  const cfg = POST_TYPES[type] || POST_TYPES.discussion
  return (
    <span style={{
      background: cfg.bg, color: cfg.color,
      fontSize: 10, fontWeight: 600, padding: '2px 8px',
      borderRadius: 9999,
    }}>
      {cfg.label}
    </span>
  )
}

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
      <div style={{
        width: 24, height: 24, border: '2px solid #FF3333',
        borderTopColor: 'transparent', borderRadius: '50%',
        animation: 'community-spin 0.8s linear infinite',
      }} />
    </div>
  )
}

// ─── Login Form ──────────────────────────────────────────────────────────────

function LoginForm({ onAuth }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState('email')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSendCode(e) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await communityRequest('/api/community/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      })
      setStep('code')
    } catch (err) {
      setError(err?.data?.detail || 'Erro ao enviar codigo. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify(e) {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await communityRequest('/api/community/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      })
      if (res.token) {
        setCommunityToken(res.token)
        onAuth(res)
      } else {
        setError('Codigo invalido.')
      }
    } catch (err) {
      setError(err?.data?.detail || 'Codigo invalido ou expirado.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16, padding: 24, maxWidth: 400, margin: '0 auto',
    }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
        Entrar na comunidade
      </h3>
      <p style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 16 }}>
        {step === 'email' ? 'Digite seu email para receber o codigo de acesso.' : 'Digite o codigo enviado para seu email.'}
      </p>

      {step === 'email' ? (
        <form onSubmit={handleSendCode}>
          <input
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={{
              width: '100%', background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
              padding: '10px 14px', fontSize: 14, color: '#fff',
              outline: 'none', boxSizing: 'border-box', marginBottom: 10,
            }}
          />
          {error && <p style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{error}</p>}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', background: '#FF3333', color: '#fff',
              border: 'none', borderRadius: 10, padding: '10px 0',
              fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s',
            }}
          >
            {loading ? 'Enviando...' : 'Enviar codigo'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify}>
          <input
            type="text"
            placeholder="000000"
            value={code}
            onChange={e => setCode(e.target.value)}
            required
            maxLength={6}
            style={{
              width: '100%', background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
              padding: '10px 14px', fontSize: 20, color: '#fff', letterSpacing: '0.3em',
              outline: 'none', boxSizing: 'border-box', marginBottom: 10, textAlign: 'center',
            }}
          />
          {error && <p style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{error}</p>}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', background: '#FF3333', color: '#fff',
              border: 'none', borderRadius: 10, padding: '10px 0',
              fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s',
            }}
          >
            {loading ? 'Verificando...' : 'Verificar'}
          </button>
          <button
            type="button"
            onClick={() => { setStep('email'); setCode(''); setError('') }}
            style={{
              width: '100%', background: 'transparent', color: '#a1a1aa',
              border: 'none', padding: '8px 0', fontSize: 12, cursor: 'pointer', marginTop: 4,
            }}
          >
            Trocar email
          </button>
        </form>
      )}
    </div>
  )
}

// ─── Auth Gate (inline prompt for interactions) ──────────────────────────────

function AuthGate({ children, isLoggedIn }) {
  if (isLoggedIn) return children
  return (
    <div style={{
      textAlign: 'center', padding: '12px 16px',
      background: 'rgba(255,51,51,0.06)', border: '1px solid rgba(255,51,51,0.15)',
      borderRadius: 10, fontSize: 13, color: '#a1a1aa',
    }}>
      Faca login pra interagir
    </div>
  )
}

// ─── Create Post ─────────────────────────────────────────────────────────────

function CreatePostBox({ onPost, isLoggedIn }) {
  const [content, setContent] = useState('')
  const [type, setType] = useState('discussion')
  const [posting, setPosting] = useState(false)

  async function handlePost(e) {
    e.preventDefault()
    if (!content.trim()) return
    setPosting(true)
    try {
      await communityRequest('/api/community/post', {
        method: 'POST',
        body: JSON.stringify({ content_md: content.trim(), post_type: type }),
      })
      setContent('')
      setType('discussion')
      onPost()
    } catch {}
    setPosting(false)
  }

  if (!isLoggedIn) {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14, padding: 20, marginBottom: 16, textAlign: 'center',
      }}>
        <p style={{ fontSize: 13, color: '#71717a' }}>Faca login para publicar na comunidade</p>
      </div>
    )
  }

  return (
    <form onSubmit={handlePost} style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 14, padding: 16, marginBottom: 16,
    }}>
      <textarea
        placeholder="Compartilhe algo com a comunidade..."
        value={content}
        onChange={e => setContent(e.target.value)}
        rows={3}
        style={{
          width: '100%', background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
          padding: '10px 14px', fontSize: 14, color: '#fff', resize: 'vertical',
          outline: 'none', boxSizing: 'border-box', minHeight: 70,
          fontFamily: 'inherit',
        }}
      />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
        flexWrap: 'wrap',
      }}>
        {Object.entries(POST_TYPES).map(([key, cfg]) => (
          <button
            key={key}
            type="button"
            onClick={() => setType(key)}
            style={{
              background: type === key ? cfg.bg : 'rgba(255,255,255,0.04)',
              color: type === key ? cfg.color : '#71717a',
              border: type === key ? `1px solid ${cfg.color}30` : '1px solid rgba(255,255,255,0.06)',
              borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {cfg.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          type="submit"
          disabled={posting || !content.trim()}
          style={{
            background: '#FF3333', color: '#fff', border: 'none',
            borderRadius: 8, padding: '6px 18px', fontSize: 13, fontWeight: 600,
            cursor: posting ? 'wait' : 'pointer',
            opacity: posting || !content.trim() ? 0.5 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {posting ? 'Publicando...' : 'Publicar'}
        </button>
      </div>
    </form>
  )
}

// ─── Post Card ───────────────────────────────────────────────────────────────

function PostCard({ post, isLoggedIn, onLike, onRefresh }) {
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [liked, setLiked] = useState(post.liked_by_me)
  const [likeCount, setLikeCount] = useState(post.likes_count)

  async function toggleComments() {
    if (showComments) {
      setShowComments(false)
      return
    }
    setShowComments(true)
    setLoadingComments(true)
    try {
      const res = await communityRequest(`/api/community/post/${post.id}/comments`)
      setComments(res.comments || res || [])
    } catch {
      setComments([])
    }
    setLoadingComments(false)
  }

  async function handleLike() {
    if (!isLoggedIn) return
    try {
      await communityRequest(`/api/community/post/${post.id}/like`, { method: 'POST' })
      setLiked(!liked)
      setLikeCount(prev => liked ? prev - 1 : prev + 1)
    } catch {}
  }

  async function handleComment(e) {
    e.preventDefault()
    if (!commentText.trim()) return
    setSubmittingComment(true)
    try {
      await communityRequest(`/api/community/post/${post.id}/comment`, {
        method: 'POST',
        body: JSON.stringify({ content_md: commentText.trim() }),
      })
      setCommentText('')
      // Reload comments
      const res = await communityRequest(`/api/community/post/${post.id}/comments`)
      setComments(res.comments || res || [])
    } catch {}
    setSubmittingComment(false)
  }

  const memberColor = post.author_role === 'admin' ? '#FF3333' : '#5ea6ff'

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 14, padding: 16, marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <InitialAvatar name={post.author_name} color={memberColor} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{post.author_name}</span>
            <RoleBadge role={post.author_role} />
            <PostTypeBadge type={post.post_type} />
          </div>
          <span style={{ fontSize: 11, color: '#71717a' }}>{timeAgo(post.created_at)}</span>
        </div>
      </div>

      {/* Content */}
      <p style={{
        fontSize: 14, color: '#d4d4d8', lineHeight: 1.6,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
      }}>
        {post.content_md}
      </p>

      {/* Actions */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, marginTop: 12,
        paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        <button
          onClick={handleLike}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'none', border: 'none', cursor: isLoggedIn ? 'pointer' : 'default',
            color: liked ? '#FF3333' : '#71717a', fontSize: 13, padding: 0,
            transition: 'color 0.15s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={liked ? '#FF3333' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          {likeCount}
        </button>
        <button
          onClick={toggleComments}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'none', border: 'none', cursor: 'pointer',
            color: showComments ? '#5ea6ff' : '#71717a', fontSize: 13, padding: 0,
            transition: 'color 0.15s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {post.comments_count}
        </button>
      </div>

      {/* Comments section */}
      {showComments && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {loadingComments ? (
            <div style={{ textAlign: 'center', padding: 12 }}>
              <span style={{ fontSize: 12, color: '#71717a' }}>Carregando...</span>
            </div>
          ) : comments.length === 0 ? (
            <p style={{ fontSize: 12, color: '#71717a', textAlign: 'center', padding: 8 }}>
              Nenhum comentario ainda.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              {comments.map((c, i) => (
                <div key={c.id || i} style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                  padding: '8px 10px', background: 'rgba(255,255,255,0.02)',
                  borderRadius: 10,
                }}>
                  <InitialAvatar name={c.author_name} color={c.author_role === 'admin' ? '#FF3333' : '#5ea6ff'} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{c.author_name}</span>
                      <span style={{ fontSize: 10, color: '#71717a' }}>{timeAgo(c.created_at)}</span>
                    </div>
                    <p style={{ fontSize: 13, color: '#d4d4d8', margin: '2px 0 0', lineHeight: 1.5 }}>
                      {c.content_md}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {isLoggedIn ? (
            <form onSubmit={handleComment} style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Escreva um comentario..."
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
                  padding: '8px 12px', fontSize: 13, color: '#fff', outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={submittingComment || !commentText.trim()}
                style={{
                  background: '#FF3333', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600,
                  cursor: submittingComment ? 'wait' : 'pointer',
                  opacity: submittingComment || !commentText.trim() ? 0.5 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                Enviar
              </button>
            </form>
          ) : (
            <p style={{ fontSize: 12, color: '#71717a', textAlign: 'center' }}>
              Faca login para comentar
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Feed Tab ────────────────────────────────────────────────────────────────

function FeedTab({ isLoggedIn }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  const loadFeed = useCallback(async () => {
    setLoading(true)
    try {
      const res = await communityRequest('/api/community/feed?limit=20&offset=0')
      setPosts(res.posts || res || [])
    } catch {
      // Fallback to mock data when API not available
      setPosts(MOCK_FEED)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadFeed() }, [loadFeed])

  return (
    <div>
      <CreatePostBox onPost={loadFeed} isLoggedIn={isLoggedIn} />
      {loading ? <Spinner /> : posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#71717a' }}>
          <p style={{ fontSize: 28, marginBottom: 8 }}>+</p>
          <p style={{ fontSize: 14 }}>Nenhum post ainda. Seja o primeiro!</p>
        </div>
      ) : (
        posts.map(post => (
          <PostCard
            key={post.id}
            post={post}
            isLoggedIn={isLoggedIn}
            onRefresh={loadFeed}
          />
        ))
      )}
    </div>
  )
}

// ─── Cursos Tab ──────────────────────────────────────────────────────────────

function CursosTab() {
  const [selectedCourse, setSelectedCourse] = useState(null)

  if (selectedCourse) {
    const course = COURSES.find(c => c.id === selectedCourse)
    if (!course) return null
    const done = course.lessons.filter(l => l.done).length
    const total = course.lessons.length
    const pct = Math.round((done / total) * 100)

    return (
      <div>
        <button
          onClick={() => setSelectedCourse(null)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', color: '#a1a1aa',
            fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 16,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M5 12l7 7M5 12l7-7" />
          </svg>
          Voltar aos cursos
        </button>

        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{course.title}</h2>
        <p style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 16 }}>{course.description}</p>

        {/* Progress */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#a1a1aa', marginBottom: 6 }}>
            <span>{done}/{total} aulas</span>
            <span>{pct}%</span>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: '#FF3333', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>

        {/* Lessons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {course.lessons.map(lesson => (
            <div
              key={lesson.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10, padding: '12px 16px', cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
            >
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                border: lesson.done ? 'none' : '2px solid rgba(255,255,255,0.2)',
                background: lesson.done ? '#8bd450' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {lesson.done && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </div>
              <span style={{
                fontSize: 14, color: lesson.done ? '#a1a1aa' : '#fff',
                textDecoration: lesson.done ? 'line-through' : 'none',
              }}>
                {lesson.id}. {lesson.title}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: 12,
    }}>
      {COURSES.map(course => {
        const done = course.lessons.filter(l => l.done).length
        const total = course.lessons.length
        const pct = Math.round((done / total) * 100)
        return (
          <button
            key={course.id}
            onClick={() => setSelectedCourse(course.id)}
            style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 14, padding: 20, textAlign: 'left',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
              e.currentTarget.style.borderColor = 'rgba(255,51,51,0.3)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>
              {course.title}
            </h3>
            <p style={{ fontSize: 13, color: '#a1a1aa', margin: '0 0 14px', lineHeight: 1.5 }}>
              {course.description}
            </p>
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#71717a', marginBottom: 4 }}>
                <span>{done}/{total} aulas</span>
                <span>{pct}%</span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: '#FF3333', borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Membros Tab ─────────────────────────────────────────────────────────────

function MembrosTab() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await communityRequest('/api/community/members')
        setMembers(res.members || res || [])
      } catch {
        setMembers(MOCK_MEMBERS)
      }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <Spinner />

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: 12,
    }}>
      {members.map(member => (
        <div
          key={member.enrollment_id || member.id}
          style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, padding: 20, textAlign: 'center',
          }}
        >
          <InitialAvatar name={member.name} color={member.color || (member.role === 'admin' ? '#FF3333' : '#5ea6ff')} size={48} />
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginTop: 10, marginBottom: 4 }}>
            {member.name}
          </h3>
          <RoleBadge role={member.role} />
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>{member.post_count ?? member.posts}</p>
              <p style={{ fontSize: 10, color: '#71717a', margin: 0 }}>posts</p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>
                {new Date(member.enrolled_at || member.joined).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })}
              </p>
              <p style={{ fontSize: 10, color: '#71717a', margin: 0 }}>entrou</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Recursos Tab ────────────────────────────────────────────────────────────

function RecursosTab({ isLoggedIn }) {
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await communityRequest('/api/community/resources')
        setResources(res.resources || res || [])
      } catch {
        setResources(MOCK_RESOURCES)
      }
      setLoading(false)
    }
    load()
  }, [])

  async function handleDownload(resource) {
    if (!isLoggedIn) return
    try {
      await communityRequest(`/api/community/resource/${resource.id}/download`, { method: 'POST' })
      // Update count locally
      setResources(prev => prev.map(r =>
        r.id === resource.id ? { ...r, downloads: (r.downloads || 0) + 1 } : r
      ))
    } catch {}
  }

  if (loading) return <Spinner />

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: 12,
    }}>
      {resources.map(resource => {
        const typeCfg = RESOURCE_TYPES[resource.resource_type || resource.type] || RESOURCE_TYPES.template
        return (
          <div
            key={resource.id}
            style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 14, padding: 20,
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                background: `${typeCfg.color}18`, color: typeCfg.color,
                fontSize: 10, fontWeight: 600, padding: '2px 8px',
                borderRadius: 9999, textTransform: 'uppercase',
              }}>
                {typeCfg.label}
              </span>
              <span style={{ fontSize: 11, color: '#71717a', marginLeft: 'auto' }}>
                {resource.downloads_count ?? resource.downloads} downloads
              </span>
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#fff', margin: '0 0 6px' }}>
              {resource.title}
            </h3>
            <p style={{ fontSize: 13, color: '#a1a1aa', margin: '0 0 14px', lineHeight: 1.5, flex: 1 }}>
              {resource.description}
            </p>
            {isLoggedIn ? (
              <button
                onClick={() => handleDownload(resource)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, padding: '8px 0', fontSize: 13, fontWeight: 500,
                  color: '#fff', cursor: 'pointer', transition: 'all 0.15s',
                  width: '100%',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,51,51,0.15)'
                  e.currentTarget.style.borderColor = 'rgba(255,51,51,0.3)'
                  e.currentTarget.style.color = '#FF3333'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
                  e.currentTarget.style.color = '#fff'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Baixar
              </button>
            ) : (
              <p style={{ fontSize: 12, color: '#71717a', textAlign: 'center', margin: 0 }}>
                Faca login para baixar
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ user, isLoggedIn, onLogin, onLogout }) {
  if (!isLoggedIn) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <LoginForm onAuth={onLogin} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Profile card */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14, padding: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <InitialAvatar name={user?.name || user?.email} color={user?.role === 'admin' ? '#FF3333' : '#5ea6ff'} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#fff', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name || user?.email?.split('@')[0] || 'Membro'}
            </p>
            <p style={{ fontSize: 11, color: '#71717a', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email || ''}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span style={{
            background: user?.tier === 'pro' ? 'rgba(255,51,51,0.15)' : 'rgba(255,255,255,0.06)',
            color: user?.tier === 'pro' ? '#FF3333' : '#a1a1aa',
            fontSize: 10, fontWeight: 600, padding: '3px 10px',
            borderRadius: 9999, textTransform: 'uppercase',
          }}>
            {user?.tier || 'free'}
          </span>
          <span style={{ fontSize: 11, color: '#71717a' }}>
            desde {user?.member_since ? new Date(user.member_since).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '-'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>{user?.posts || 0}</p>
            <p style={{ fontSize: 10, color: '#71717a', margin: 0 }}>posts</p>
          </div>
          <div>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>{user?.likes_received || 0}</p>
            <p style={{ fontSize: 10, color: '#71717a', margin: 0 }}>likes</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          style={{
            width: '100%', marginTop: 12, background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
            padding: '6px 0', fontSize: 12, color: '#71717a', cursor: 'pointer',
          }}
        >
          Sair
        </button>
      </div>

      {/* Leaderboard */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14, padding: 16,
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#a1a1aa', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Top 5
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {MOCK_LEADERBOARD.map((m, i) => (
            <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%',
                background: i === 0 ? '#f5c842' : i === 1 ? '#a1a1aa' : i === 2 ? '#cd7f32' : 'rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: i < 3 ? '#000' : '#71717a',
                flexShrink: 0,
              }}>
                {i + 1}
              </span>
              <span style={{ fontSize: 13, color: '#fff', flex: 1 }}>{m.name}</span>
              <span style={{ fontSize: 11, color: '#71717a' }}>{m.posts} posts</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'feed', label: 'Feed' },
  { id: 'cursos', label: 'Cursos' },
  { id: 'membros', label: 'Membros' },
  { id: 'recursos', label: 'Recursos' },
]

export default function Community() {
  const [activeTab, setActiveTab] = useState('feed')
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!getCommunityToken())
  const [user, setUser] = useState(null)
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)

  // Load user profile on mount if token exists
  useEffect(() => {
    if (!getCommunityToken()) return
    communityRequest('/api/community/me')
      .then(res => {
        setUser(res)
        setIsLoggedIn(true)
      })
      .catch(() => {
        // Token expired or invalid
        clearCommunityToken()
        setIsLoggedIn(false)
      })
  }, [])

  function handleAuth(res) {
    setUser(res.user || res)
    setIsLoggedIn(true)
  }

  function handleLogout() {
    clearCommunityToken()
    setIsLoggedIn(false)
    setUser(null)
  }

  function renderTab() {
    switch (activeTab) {
      case 'feed': return <FeedTab isLoggedIn={isLoggedIn} />
      case 'cursos': return <CursosTab />
      case 'membros': return <MembrosTab />
      case 'recursos': return <RecursosTab isLoggedIn={isLoggedIn} />
      default: return <FeedTab isLoggedIn={isLoggedIn} />
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#090b10', color: '#e4e4e7',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Keyframe for spinner */}
      <style>{`
        @keyframes community-spin { to { transform: rotate(360deg) } }
      `}</style>

      {/* Header */}
      <header style={{
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #FF3333, #cc0000)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color: '#fff',
          }}>
            G
          </div>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>GuyFolkz</h1>
            <p style={{ fontSize: 11, color: '#71717a', margin: 0 }}>Comunidade</p>
          </div>
        </div>

        {/* Mobile sidebar toggle */}
        <button
          onClick={() => setShowMobileSidebar(!showMobileSidebar)}
          style={{
            display: 'none', background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
            padding: '6px 10px', color: '#a1a1aa', cursor: 'pointer',
            fontSize: 12,
          }}
          className="community-mobile-toggle"
        >
          {isLoggedIn ? (user?.name || user?.email?.split('@')[0] || 'Perfil') : 'Login'}
        </button>
      </header>

      {/* Tab bar */}
      <nav style={{
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '0 16px',
        display: 'flex', gap: 0, overflowX: 'auto',
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 20px',
              fontSize: 14, fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? '#FF3333' : '#71717a',
              background: 'none', border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #FF3333' : '2px solid transparent',
              cursor: 'pointer', transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Mobile sidebar overlay */}
      {showMobileSidebar && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            zIndex: 50, display: 'flex', justifyContent: 'flex-end',
          }}
          onClick={() => setShowMobileSidebar(false)}
        >
          <div
            style={{
              width: 320, maxWidth: '85vw', background: '#090b10',
              borderLeft: '1px solid rgba(255,255,255,0.08)',
              padding: 16, overflowY: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            <Sidebar
              user={user}
              isLoggedIn={isLoggedIn}
              onLogin={handleAuth}
              onLogout={handleLogout}
            />
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{
        display: 'flex', maxWidth: 1200, margin: '0 auto',
        padding: 16, gap: 20,
      }}>
        {/* Content area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {renderTab()}
        </div>

        {/* Desktop sidebar */}
        <div style={{ width: 280, flexShrink: 0 }} className="community-sidebar-desktop">
          <Sidebar
            user={user}
            isLoggedIn={isLoggedIn}
            onLogin={handleAuth}
            onLogout={handleLogout}
          />
        </div>
      </div>

      {/* Responsive styles */}
      <style>{`
        .community-sidebar-desktop {
          display: block;
        }
        .community-mobile-toggle {
          display: none !important;
        }
        @media (max-width: 768px) {
          .community-sidebar-desktop {
            display: none !important;
          }
          .community-mobile-toggle {
            display: block !important;
          }
        }
      `}</style>
    </div>
  )
}
