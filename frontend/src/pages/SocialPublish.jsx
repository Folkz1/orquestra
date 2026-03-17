import { useState, useEffect, useCallback } from 'react'
import {
  getSocialPlatforms,
  getSocialAccounts,
  startSocialOAuth,
  disconnectSocialAccount,
  publishToSocial,
  publishUploadToSocial,
} from '../api'

const PLATFORM_ICONS = {
  instagram: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
    </svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.48V13.1a8.28 8.28 0 005.58 2.15V11.8a4.85 4.85 0 01-3.15-1.15V6.69h3.15z"/>
    </svg>
  ),
  youtube: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  ),
}

const PLATFORM_COLORS = {
  instagram: '#E4405F',
  tiktok: '#000000',
  youtube: '#FF0000',
}

const PLATFORM_BG = {
  instagram: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
  tiktok: '#25F4EE',
  youtube: '#FF0000',
}

export default function SocialPublish() {
  const [platforms, setPlatforms] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [publishResults, setPublishResults] = useState(null)

  // Publish form
  const [videoUrl, setVideoUrl] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState([])
  const [videoFile, setVideoFile] = useState(null)
  const [uploadMode, setUploadMode] = useState('url') // url | file

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [platRes, accRes] = await Promise.all([
        getSocialPlatforms(),
        getSocialAccounts(),
      ])
      setPlatforms(platRes.platforms || [])
      setAccounts(accRes.accounts || [])
    } catch (err) {
      console.error('Failed to load social data:', err)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()

    // Check URL params for OAuth callback
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected')) {
      const platform = params.get('connected')
      const account = params.get('account')
      // Clean URL
      window.history.replaceState({}, '', '/social')
    }
  }, [loadData])

  const handleConnect = async (platform) => {
    try {
      const res = await startSocialOAuth(platform)
      if (res.authorization_url) {
        window.location.href = res.authorization_url
      }
    } catch (err) {
      alert(`Erro ao conectar ${platform}: ${err.message}`)
    }
  }

  const handleDisconnect = async (platform) => {
    if (!confirm(`Desconectar ${platform}?`)) return
    try {
      await disconnectSocialAccount(platform)
      await loadData()
    } catch (err) {
      alert(`Erro: ${err.message}`)
    }
  }

  const handlePublish = async () => {
    if (selectedPlatforms.length === 0) {
      alert('Selecione pelo menos uma plataforma')
      return
    }

    setPublishing(true)
    setPublishResults(null)

    try {
      let res
      if (uploadMode === 'file' && videoFile) {
        const formData = new FormData()
        formData.append('video', videoFile)
        formData.append('platforms', selectedPlatforms.join(','))
        formData.append('title', title)
        formData.append('description', description)
        formData.append('tags', tags)
        res = await publishUploadToSocial(formData)
      } else {
        res = await publishToSocial({
          platforms: selectedPlatforms,
          video_url: videoUrl,
          title,
          description,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        })
      }
      setPublishResults(res.results || [])
    } catch (err) {
      setPublishResults([{ platform: 'all', status: 'error', error: err.message }])
    }
    setPublishing(false)
  }

  const togglePlatform = (pid) => {
    setSelectedPlatforms(prev =>
      prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]
    )
  }

  if (loading) {
    return (
      <div style={{ padding: 32, color: '#94a3b8', textAlign: 'center' }}>
        Carregando...
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
        Social Publishing
      </h1>
      <p style={{ color: '#64748b', fontSize: 14, marginBottom: 32 }}>
        Publique seus shorts em todas as plataformas de uma vez
      </p>

      {/* Connected Accounts */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginBottom: 16 }}>
          Contas Conectadas
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {accounts.map(acc => (
            <div
              key={acc.platform}
              style={{
                background: '#1e293b',
                borderRadius: 12,
                padding: 16,
                border: acc.is_connected ? '1px solid #334155' : '1px dashed #334155',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{
                  color: PLATFORM_COLORS[acc.platform] || '#fff',
                  display: 'flex',
                  alignItems: 'center',
                }}>
                  {PLATFORM_ICONS[acc.platform]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9', textTransform: 'capitalize' }}>
                    {acc.platform}
                  </div>
                  {acc.is_connected && (
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>
                      @{acc.username || acc.account_id}
                    </div>
                  )}
                </div>
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: acc.is_connected ? '#22c55e' : '#475569',
                }} />
              </div>

              {acc.is_connected ? (
                <button
                  onClick={() => handleDisconnect(acc.platform)}
                  style={{
                    width: '100%',
                    padding: '8px 0',
                    background: 'transparent',
                    border: '1px solid #475569',
                    borderRadius: 8,
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Desconectar
                </button>
              ) : acc.platform === 'youtube' ? (
                <button
                  onClick={() => window.location.href = '/youtube'}
                  style={{
                    width: '100%',
                    padding: '8px 0',
                    background: '#1d4ed8',
                    border: 'none',
                    borderRadius: 8,
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Conectar via YouTube
                </button>
              ) : (
                <button
                  onClick={() => handleConnect(acc.platform)}
                  style={{
                    width: '100%',
                    padding: '8px 0',
                    background: '#1d4ed8',
                    border: 'none',
                    borderRadius: 8,
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Conectar
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Publish Form */}
      <div style={{
        background: '#1e293b',
        borderRadius: 12,
        padding: 24,
        border: '1px solid #334155',
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginBottom: 20 }}>
          Publicar Video
        </h2>

        {/* Platform Selection */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
            Plataformas
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {platforms.filter(p => p.id !== 'youtube').map(p => {
              const connected = accounts.find(a => a.platform === p.id)?.is_connected
              const selected = selectedPlatforms.includes(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => connected && togglePlatform(p.id)}
                  disabled={!connected}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: selected ? `2px solid ${PLATFORM_COLORS[p.id]}` : '1px solid #475569',
                    background: selected ? `${PLATFORM_COLORS[p.id]}15` : 'transparent',
                    color: connected ? '#f1f5f9' : '#475569',
                    cursor: connected ? 'pointer' : 'not-allowed',
                    fontSize: 13,
                    fontWeight: selected ? 600 : 400,
                    opacity: connected ? 1 : 0.5,
                  }}
                >
                  <span style={{ color: PLATFORM_COLORS[p.id] }}>{PLATFORM_ICONS[p.id]}</span>
                  {p.name}
                  {!connected && <span style={{ fontSize: 11 }}>(desconectado)</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Upload Mode Toggle */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
            Origem do video
          </label>
          <div style={{ display: 'flex', gap: 4, background: '#0f172a', borderRadius: 8, padding: 2, width: 'fit-content' }}>
            {[['url', 'URL'], ['file', 'Arquivo']].map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setUploadMode(mode)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: uploadMode === mode ? '#334155' : 'transparent',
                  color: uploadMode === mode ? '#f1f5f9' : '#64748b',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Video Source */}
        {uploadMode === 'url' ? (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
              URL do video (deve ser acessivel publicamente)
            </label>
            <input
              type="url"
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              placeholder="https://storage.exemplo.com/video-vertical.mp4"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 8,
                color: '#f1f5f9',
                fontSize: 14,
                boxSizing: 'border-box',
              }}
            />
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
              Arquivo de video (MP4, 9:16)
            </label>
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              onChange={e => setVideoFile(e.target.files[0])}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 8,
                color: '#f1f5f9',
                fontSize: 14,
                boxSizing: 'border-box',
              }}
            />
            {videoFile && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                {videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)} MB)
              </div>
            )}
          </div>
        )}

        {/* Title */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
            Titulo
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Titulo do video"
            style={{
              width: '100%',
              padding: '10px 12px',
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#f1f5f9',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Description */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
            Descricao / Caption
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Descricao que aparece nas plataformas..."
            rows={3}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#f1f5f9',
              fontSize: 14,
              resize: 'vertical',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Tags */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
            Tags / Hashtags (separadas por virgula)
          </label>
          <input
            type="text"
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="ia, automacao, claudecode, n8n"
            style={{
              width: '100%',
              padding: '10px 12px',
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#f1f5f9',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Publish Button */}
        <button
          onClick={handlePublish}
          disabled={publishing || selectedPlatforms.length === 0}
          style={{
            width: '100%',
            padding: '12px 0',
            background: publishing ? '#334155' : '#2563eb',
            border: 'none',
            borderRadius: 10,
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            cursor: publishing ? 'not-allowed' : 'pointer',
          }}
        >
          {publishing
            ? 'Publicando...'
            : `Publicar em ${selectedPlatforms.length} plataforma${selectedPlatforms.length !== 1 ? 's' : ''}`
          }
        </button>

        {/* Results */}
        {publishResults && (
          <div style={{ marginTop: 16 }}>
            {publishResults.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  background: r.status === 'error' ? '#7f1d1d20' : '#14532d20',
                  borderRadius: 8,
                  marginBottom: 8,
                  border: `1px solid ${r.status === 'error' ? '#7f1d1d' : '#14532d'}`,
                }}
              >
                <span style={{ color: PLATFORM_COLORS[r.platform] || '#fff' }}>
                  {PLATFORM_ICONS[r.platform]}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: r.status === 'error' ? '#fca5a5' : '#86efac',
                    textTransform: 'capitalize',
                  }}>
                    {r.platform}: {r.status}
                  </div>
                  {r.error && (
                    <div style={{ fontSize: 12, color: '#f87171', marginTop: 2 }}>{r.error}</div>
                  )}
                  {r.platform_url && (
                    <a
                      href={r.platform_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: '#60a5fa', marginTop: 2, display: 'block' }}
                    >
                      {r.platform_url}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
