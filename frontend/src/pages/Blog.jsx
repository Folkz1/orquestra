import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiBase, authHeaders } from '../lib/api'

const STATUS_COLORS = {
  published: 'bg-emerald-500/15 text-emerald-400',
  draft: 'bg-zinc-500/15 text-zinc-400',
}

const TYPE_LABELS = {
  short: 'Short',
  long: 'Long',
  'radar-ia': 'RADAR IA',
}

function PostCard({ post, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group w-full text-left bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-600 transition-all"
    >
      {post.cover_image_url && (
        <div className="aspect-video overflow-hidden bg-zinc-800">
          <img
            src={post.cover_image_url}
            alt={post.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[post.status] || 'bg-zinc-700 text-zinc-300'}`}>
            {post.status === 'published' ? 'Publicado' : 'Rascunho'}
          </span>
          {post.video_type && (
            <span className="text-xs text-zinc-500">{TYPE_LABELS[post.video_type] || post.video_type}</span>
          )}
          <span className="text-xs text-zinc-600 ml-auto">{post.reading_time_min} min</span>
        </div>
        <h3 className="font-semibold text-white mb-1 line-clamp-2 group-hover:text-blue-400 transition-colors">
          {post.title}
        </h3>
        {post.subtitle && (
          <p className="text-sm text-zinc-400 line-clamp-2">{post.subtitle}</p>
        )}
        <div className="flex items-center gap-3 mt-3 text-xs text-zinc-500">
          <span>{post.views} views</span>
          {post.tags?.slice(0, 3).map(tag => (
            <span key={tag} className="bg-zinc-800 px-2 py-0.5 rounded">#{tag}</span>
          ))}
        </div>
      </div>
    </button>
  )
}

function MarkdownContent({ content }) {
  // Renderizacao simples de markdown para visualizacao
  const html = content
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold text-white mt-6 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold text-white mt-8 mb-3">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold text-white mt-8 mb-4">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-zinc-300">$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-zinc-800 text-blue-300 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>')
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-blue-500 pl-4 my-4 text-zinc-300 italic">$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-zinc-300 mb-1">• $1</li>')
    .replace(/\n\n/g, '</p><p class="text-zinc-300 mb-4">')
  return (
    <div
      className="prose-custom text-zinc-300 leading-relaxed"
      dangerouslySetInnerHTML={{ __html: `<p class="text-zinc-300 mb-4">${html}</p>` }}
    />
  )
}

function PostDetail({ slug, onBack }) {
  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${apiBase}/api/blog/${slug}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { setPost(d); setLoading(false) })
      .catch(() => setLoading(false))
    // Increment view
    fetch(`${apiBase}/api/blog/${slug}/view`, { method: 'POST', headers: authHeaders() }).catch(() => {})
  }, [slug])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!post) return (
    <div className="text-center text-zinc-400 py-20">Post nao encontrado</div>
  )

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-zinc-400 hover:text-white mb-6 transition-colors">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5M5 12l7 7M5 12l7-7" />
        </svg>
        Voltar
      </button>

      {post.cover_image_url && (
        <img src={post.cover_image_url} alt={post.title} className="w-full rounded-xl mb-8 aspect-video object-cover" />
      )}

      <div className="flex items-center gap-3 mb-4 text-sm text-zinc-400">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[post.status] || ''}`}>
          {post.status === 'published' ? 'Publicado' : 'Rascunho'}
        </span>
        {post.video_type && <span>{TYPE_LABELS[post.video_type]}</span>}
        <span>{post.reading_time_min} min de leitura</span>
        <span>{post.views} views</span>
        {post.published_at && (
          <span>{new Date(post.published_at).toLocaleDateString('pt-BR')}</span>
        )}
      </div>

      <h1 className="text-3xl font-bold text-white mb-3">{post.title}</h1>
      {post.subtitle && <p className="text-xl text-zinc-400 mb-8">{post.subtitle}</p>}

      {post.youtube_video_id && (
        <div className="mb-8 rounded-xl overflow-hidden aspect-video">
          <iframe
            src={`https://www.youtube.com/embed/${post.youtube_video_id}`}
            className="w-full h-full"
            allowFullScreen
            title={post.title}
          />
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
        <MarkdownContent content={post.content_md} />
      </div>

      {post.tags?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {post.tags.map(tag => (
            <span key={tag} className="bg-zinc-800 text-zinc-300 text-sm px-3 py-1 rounded-full">#{tag}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Blog() {
  const navigate = useNavigate()
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSlug, setSelectedSlug] = useState(null)
  const [filter, setFilter] = useState('all')
  const [showNew, setShowNew] = useState(false)
  const [newPost, setNewPost] = useState({ title: '', subtitle: '', content_md: '', youtube_video_id: '', video_type: 'short', tags: '', status: 'published', reading_time_min: 3 })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`${apiBase}/api/blog`, { headers: authHeaders() })
    const data = await res.json()
    setPosts(data.posts || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = filter === 'all' ? posts : posts.filter(p => p.video_type === filter || p.status === filter)

  const handleCreate = async () => {
    setSaving(true)
    const payload = {
      ...newPost,
      tags: newPost.tags.split(',').map(t => t.trim()).filter(Boolean),
      reading_time_min: parseInt(newPost.reading_time_min) || 3,
    }
    await fetch(`${apiBase}/api/blog`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    setShowNew(false)
    setNewPost({ title: '', subtitle: '', content_md: '', youtube_video_id: '', video_type: 'short', tags: '', status: 'published', reading_time_min: 3 })
    load()
  }

  if (selectedSlug) {
    return (
      <div className="p-6">
        <PostDetail slug={selectedSlug} onBack={() => setSelectedSlug(null)} />
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Blog</h1>
          <p className="text-zinc-400 text-sm mt-1">Experimentos e artigos por video GuyFolkz</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + Novo Post
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {['all', 'short', 'long', 'radar-ia', 'draft'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {f === 'all' ? 'Todos' : f === 'draft' ? 'Rascunhos' : TYPE_LABELS[f] || f}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-500 self-center">{filtered.length} posts</span>
      </div>

      {/* Modal novo post */}
      {showNew && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white mb-4">Novo Post</h2>
            <div className="space-y-3">
              <input className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm" placeholder="Titulo" value={newPost.title} onChange={e => setNewPost(p => ({...p, title: e.target.value}))} />
              <input className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm" placeholder="Subtitulo (opcional)" value={newPost.subtitle} onChange={e => setNewPost(p => ({...p, subtitle: e.target.value}))} />
              <input className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm" placeholder="YouTube Video ID (ex: mOWCESTADMw)" value={newPost.youtube_video_id} onChange={e => setNewPost(p => ({...p, youtube_video_id: e.target.value}))} />
              <div className="flex gap-3">
                <select className="flex-1 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm" value={newPost.video_type} onChange={e => setNewPost(p => ({...p, video_type: e.target.value}))}>
                  <option value="short">Short</option>
                  <option value="long">Long</option>
                  <option value="radar-ia">RADAR IA</option>
                </select>
                <select className="flex-1 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm" value={newPost.status} onChange={e => setNewPost(p => ({...p, status: e.target.value}))}>
                  <option value="published">Publicado</option>
                  <option value="draft">Rascunho</option>
                </select>
                <input type="number" className="w-24 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm" placeholder="Min" value={newPost.reading_time_min} onChange={e => setNewPost(p => ({...p, reading_time_min: e.target.value}))} />
              </div>
              <input className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm" placeholder="Tags (separadas por virgula)" value={newPost.tags} onChange={e => setNewPost(p => ({...p, tags: e.target.value}))} />
              <textarea className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm h-48 resize-none font-mono" placeholder="Conteudo em Markdown..." value={newPost.content_md} onChange={e => setNewPost(p => ({...p, content_md: e.target.value}))} />
            </div>
            <div className="flex gap-3 mt-4 justify-end">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-zinc-400 hover:text-white text-sm">Cancelar</button>
              <button onClick={handleCreate} disabled={saving || !newPost.title || !newPost.content_md} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {saving ? 'Salvando...' : 'Criar Post'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-zinc-400 py-20">
          <p className="text-4xl mb-3">✍</p>
          <p>Nenhum post ainda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(post => (
            <PostCard key={post.id} post={post} onClick={() => setSelectedSlug(post.slug)} />
          ))}
        </div>
      )}
    </div>
  )
}
