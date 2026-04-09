import { useState } from 'react'
import { Link } from 'react-router-dom'
import { createCommunityLead } from '../api'

const MODULES = [
  { title: 'Stack Claude Code (Harness)', desc: 'Setup completo: skills, hooks, harness deterministico e pipeline pronta.' },
  { title: 'Agent Lab', desc: 'ChatLab, tools reais e cenarios de teste para validar agentes de verdade.' },
  { title: 'Remotion Pipeline', desc: 'Producao de video com codigo, render farm e upload automatizado.' },
  { title: 'Automacao WhatsApp B2B', desc: 'Evolution API, fluxos, debounce e operacao comercial com IA.' },
  { title: 'Dashboard + Orquestra', desc: 'React + FastAPI + inteligencia operacional para o negocio inteiro.' },
  { title: 'De Freelancer a Motor 100K', desc: 'Prioridade por receita, recorrencia e execucao sem gargalo.' },
]

const BENEFITS = [
  'Acesso imediato por 6 horas para explorar o conteudo',
  'Playbooks e modulos completos da Academy',
  'Aulas e recursos para acelerar tua implementacao',
  'Contato direto com Diego no WhatsApp para fechar a assinatura',
  'Credenciais e liberacao final enviadas manualmente no WhatsApp',
  'Tudo que esta funcionando na pratica, sem teoria vazia',
]

function normalizePhone(value) {
  return (value || '').replace(/\D/g, '')
}

export default function CommunityLanding() {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function handleLeadCapture(e) {
    e.preventDefault()
    const normalizedPhone = normalizePhone(phone)
    if (!normalizedPhone) {
      setError('Informe seu WhatsApp')
      return
    }
    if (normalizedPhone.length < 12) {
      setError('Informe um WhatsApp valido com DDI')
      return
    }

    setLoading(true)
    setError('')
    setNotice('')

    try {
      localStorage.setItem('community_phone', normalizedPhone)
      localStorage.setItem('community_checkout_context', JSON.stringify({
        phone: normalizedPhone,
        name: name.trim(),
        email: email.trim(),
        started_at: Date.now(),
        source: 'community_manual_trial',
      }))

      const res = await createCommunityLead({
        phone: normalizedPhone,
        name: name.trim(),
        email: email.trim(),
      })

      if (res?.redirect_url) {
        window.location.assign(res.redirect_url)
        return
      }

      setNotice(res?.message || 'Recebemos teu contato. Vou te chamar no WhatsApp para concluir.')
    } catch (err) {
      const detail = err?.data?.detail
      if (typeof detail === 'string') {
        setError(detail)
      } else {
        setError(detail?.message || 'Nao foi possivel liberar teu acesso agora. Tente novamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#090b10] text-zinc-100">
      <section className="relative overflow-hidden px-4 py-16 sm:px-6 sm:py-24">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(139,212,80,0.08),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(94,166,255,0.06),transparent_50%)]" />
        <div className="relative mx-auto max-w-4xl text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-[#8bd450]">GuyFolkz Academy</p>
          <h1 className="mt-4 text-3xl font-bold leading-tight sm:text-5xl">
            Entre agora na comunidade com <span className="text-[#8bd450]">6 horas de acesso</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-zinc-400 sm:text-lg">
            Libero teu acesso ao conteudo imediatamente e te chamo no WhatsApp para fechar a assinatura manualmente.
            Depois disso, as credenciais e a continuidade do acesso seguem direto pelo WhatsApp.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a href="#assinar" className="rounded-2xl bg-[#8bd450] px-8 py-3 text-sm font-semibold text-black transition-transform hover:scale-105">
              Liberar acesso agora
            </a>
            <Link to="/playbook" className="rounded-2xl border border-white/10 px-8 py-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5">
              Ver conteudo gratuito
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-white/6 bg-white/2 px-4 py-12 sm:px-6">
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-3">
          <div className="text-center">
            <p className="text-3xl font-bold text-[#8bd450]">6h</p>
            <p className="mt-1 text-sm text-zinc-400">Acesso imediato ao conteudo</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-[#5ea6ff]">R$70</p>
            <p className="mt-1 text-sm text-zinc-400">Assinatura mensal fechada no WhatsApp</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-[#67d7d0]">1:1</p>
            <p className="mt-1 text-sm text-zinc-400">Fechamento e credenciais enviados manualmente</p>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">O que voce vai encontrar</p>
          <h2 className="mt-3 text-2xl font-bold sm:text-3xl">Conteudo para gerar resultado rapido</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((module, index) => (
              <div key={module.title} className="rounded-2xl border border-white/8 bg-white/3 p-5 transition-colors hover:bg-white/5">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#8bd450]/10 text-xs font-bold text-[#8bd450]">{index + 1}</span>
                  <span className="rounded-full bg-[#8bd450]/10 px-2 py-0.5 text-[10px] font-medium text-[#8bd450]">PRO</span>
                </div>
                <h3 className="mt-3 text-sm font-semibold">{module.title}</h3>
                <p className="mt-1 text-xs text-zinc-400">{module.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-white/6 bg-white/2 px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Como funciona hoje</h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <div key={benefit} className="flex items-start gap-3 rounded-xl border border-white/6 bg-white/3 px-4 py-3">
                <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-[#8bd450]" />
                <span className="text-sm">{benefit}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="assinar" className="px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-md">
          <div className="rounded-3xl border border-[#8bd450]/20 bg-[#10141b] p-8">
            <p className="font-mono text-xs uppercase tracking-widest text-[#8bd450]">Comunidade GuyFolkz</p>
            <div className="mt-4 flex items-end gap-2">
              <span className="text-4xl font-bold">R$70</span>
              <span className="mb-1 text-sm text-zinc-400">/mes</span>
            </div>
            <p className="mt-2 text-sm text-zinc-400">
              Acesso imediato por 6 horas. Eu mesmo continuo o fechamento com voce no WhatsApp.
            </p>

            <form onSubmit={handleLeadCapture} className="mt-6 space-y-3">
              <input
                type="text"
                placeholder="Seu WhatsApp (ex: 5511999998888)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-[#8bd450]/40 focus:ring-1 focus:ring-[#8bd450]/20"
                required
              />
              <input
                type="text"
                placeholder="Seu nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-[#8bd450]/40 focus:ring-1 focus:ring-[#8bd450]/20"
              />
              <input
                type="email"
                placeholder="Seu melhor email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-[#8bd450]/40 focus:ring-1 focus:ring-[#8bd450]/20"
              />
              {notice && <p className="text-xs text-[#8bd450]">{notice}</p>}
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[#8bd450] py-3 text-sm font-semibold text-black transition-all hover:bg-[#9be060] disabled:opacity-50"
              >
                {loading ? 'Liberando acesso...' : 'Quero meu acesso de 6 horas'}
              </button>
            </form>

            <p className="mt-4 text-center text-xs text-zinc-500">
              Sem checkout automatico. O fechamento e as credenciais seguem direto no WhatsApp.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/6 px-4 py-8 text-center text-xs text-zinc-500">
        <p>GuyFolkz Academy. Construido com Claude Code + Orquestra.</p>
        <div className="mt-2 flex justify-center gap-4">
          <Link to="/membros" className="hover:text-zinc-300">Area de membros</Link>
          <Link to="/playbook" className="hover:text-zinc-300">Conteudo gratuito</Link>
          <a href="https://youtube.com/@guyfolkz" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300">YouTube</a>
        </div>
      </footer>
    </div>
  )
}
