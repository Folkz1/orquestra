import { useState } from 'react'

export default function Login({ onLogin }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!token.trim()) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/contacts', {
        headers: { Authorization: `Bearer ${token.trim()}` },
      })
      if (res.ok) {
        localStorage.setItem('orquestra_token', token.trim())
        onLogin()
      } else {
        setError('Token invalido')
      }
    } catch {
      setError('Backend indisponivel')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-primary text-center mb-2">Orquestra</h1>
        <p className="text-sm text-zinc-500 text-center mb-8">Central de inteligencia</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              placeholder="Token de acesso"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="input text-center"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="btn-primary w-full"
          >
            {loading ? 'Verificando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
