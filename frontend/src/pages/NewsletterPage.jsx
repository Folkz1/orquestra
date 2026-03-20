import { useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://orquestra-backend.jz9bd8.easypanel.host'

export default function NewsletterPage() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [status, setStatus] = useState(null) // null | 'loading' | 'ok' | 'error'
  const [message, setMessage] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch(`${API}/api/newsletter/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: name || null, source: 'website' }),
      })
      const data = await res.json()
      setStatus('ok')
      setMessage(data.message || 'Inscrito!')
    } catch (err) {
      setStatus('error')
      setMessage('Erro ao inscrever. Tenta de novo.')
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #111827 50%, #0a0a0f 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <span style={{
          fontSize: 16, fontWeight: 700, color: '#00ff88',
          letterSpacing: 4, textTransform: 'uppercase',
        }}>
          GuyFolkz
        </span>
      </div>

      {/* Card principal */}
      <div style={{
        maxWidth: 520,
        width: '100%',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 20,
        padding: '48px 40px',
        backdropFilter: 'blur(20px)',
      }}>
        <h1 style={{
          fontSize: 36, fontWeight: 900, color: '#ffffff',
          lineHeight: 1.2, marginBottom: 12,
        }}>
          Radar IA
        </h1>
        <p style={{
          fontSize: 18, color: '#8899aa', lineHeight: 1.6, marginBottom: 32,
        }}>
          As notícias mais importantes de IA da semana, resumidas e com opinião.
          Direto no teu email, toda sexta.
        </p>

        {/* Badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.2)',
          borderRadius: 50, padding: '6px 16px', marginBottom: 28,
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#00ff88', boxShadow: '0 0 8px #00ff88',
          }} />
          <span style={{ fontSize: 13, color: '#00ff88', fontWeight: 600 }}>
            Grátis — sem spam
          </span>
        </div>

        {status === 'ok' ? (
          <div style={{
            background: 'rgba(0,255,136,0.1)',
            border: '1px solid rgba(0,255,136,0.3)',
            borderRadius: 12, padding: '24px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#10003;</div>
            <p style={{ fontSize: 18, color: '#00ff88', fontWeight: 700 }}>{message}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="text"
              placeholder="Seu nome (opcional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 12, padding: '14px 18px',
                color: '#ffffff', fontSize: 16,
                outline: 'none',
              }}
            />
            <input
              type="email"
              placeholder="Seu melhor email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 12, padding: '14px 18px',
                color: '#ffffff', fontSize: 16,
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              style={{
                background: '#00ff88',
                color: '#0a0a0f',
                border: 'none',
                borderRadius: 12,
                padding: '16px',
                fontSize: 17,
                fontWeight: 800,
                cursor: status === 'loading' ? 'wait' : 'pointer',
                marginTop: 4,
                transition: 'transform 0.1s',
              }}
              onMouseOver={(e) => e.target.style.transform = 'scale(1.02)'}
              onMouseOut={(e) => e.target.style.transform = 'scale(1)'}
            >
              {status === 'loading' ? 'Inscrevendo...' : 'Quero receber o Radar IA'}
            </button>
            {status === 'error' && (
              <p style={{ color: '#ff4455', fontSize: 14, textAlign: 'center' }}>{message}</p>
            )}
          </form>
        )}
      </div>

      {/* Footer */}
      <div style={{ marginTop: 32, textAlign: 'center' }}>
        <a
          href="https://youtube.com/@guyfolkz"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#556677', fontSize: 14, textDecoration: 'none' }}
        >
          youtube.com/@guyfolkz
        </a>
      </div>
    </div>
  )
}
