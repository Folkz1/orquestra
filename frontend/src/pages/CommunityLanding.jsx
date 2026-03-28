import { useState } from 'react'
import { Link } from 'react-router-dom'
import { createCheckoutSession } from '../api'

const MODULES = [
  { title: 'Stack Claude Code (Harness)', desc: 'Setup completo: skills, hooks, harness deterministico, deploy pipeline.', free: false },
  { title: 'Agent Lab', desc: 'ChatLab + 17 tools + test scenarios automatizados pra validar agentes.', free: false },
  { title: 'Remotion Pipeline', desc: 'Producao de video com codigo: React, render farm, upload automatico.', free: false },
  { title: 'Automacao WhatsApp B2B', desc: 'Evolution API, fluxos, debounce, agentes com tools reais.', free: false },
  { title: 'Dashboard + Orquestra', desc: 'React + FastAPI + graficos + central de inteligencia pessoal.', free: false },
  { title: 'De Freelancer a Motor 100K', desc: 'Priorizacao por receita, clientes, recorrencia, escala.', free: false },
]

const BENEFITS = [
  'Acesso a todos os modulos e playbooks',
  'Templates prontos: Agent Lab + Remotion + Skills',
  'Comunidade exclusiva com feed e recursos',
  'Contato direto com Diego',
  'Acesso antecipado a ferramentas novas',
  'Tudo que Diego descobrir e validar na pratica',
]

export default function CommunityLanding() {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCheckout(e) {
    e.preventDefault()
    if (!phone.trim()) { setError('Informe seu WhatsApp'); return }
    setLoading(true)
    setError('')
    try {
      const res = await createCheckoutSession({ phone: phone.trim(), name: name.trim(), email: email.trim() })
      if (res.checkout_url) {
        window.location.href = res.checkout_url
      } else {
        setError('Stripe nao configurado ainda. Em breve!')
      }
    } catch (err) {
      setError(err?.data?.detail || 'Erro ao criar checkout. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#090b10] text-zinc-100">
      {/* Hero */}
      <section className="relative overflow-hidden px-4 py-16 sm:px-6 sm:py-24">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(139,212,80,0.08),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(94,166,255,0.06),transparent_50%)]" />
        <div className="relative mx-auto max-w-4xl text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-[#8bd450]">GuyFolkz Academy</p>
          <h1 className="mt-4 text-3xl font-bold leading-tight sm:text-5xl">
            Construa seu <span className="text-[#8bd450]">CTO Virtual</span> que administra sua empresa inteira
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-zinc-400 sm:text-lg">
            Aprenda a montar agentes autonomos com Claude Code que gerenciam seus projetos, clientes, conteudo e vendas. Tudo que eu uso no dia a dia, aberto pra voce replicar.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a href="#assinar" className="rounded-2xl bg-[#8bd450] px-8 py-3 text-sm font-semibold text-black transition-transform hover:scale-105">
              Assinar por R$70/mes
            </a>
            <Link to="/playbook" className="rounded-2xl border border-white/10 px-8 py-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5">
              Ver conteudo gratuito
            </Link>
          </div>
        </div>
      </section>

      {/* Proof */}
      <section className="border-y border-white/6 bg-white/2 px-4 py-12 sm:px-6">
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-3">
          <div className="text-center">
            <p className="text-3xl font-bold text-[#8bd450]">8+</p>
            <p className="mt-1 text-sm text-zinc-400">Projetos ativos gerenciados por IA</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-[#5ea6ff]">R$15k+</p>
            <p className="mt-1 text-sm text-zinc-400">MRR gerado com automacao B2B</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-[#67d7d0]">100%</p>
            <p className="mt-1 text-sm text-zinc-400">Construido com Claude Code</p>
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">O que voce vai aprender</p>
          <h2 className="mt-3 text-2xl font-bold sm:text-3xl">6 modulos, do zero ao Motor 100K</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m, i) => (
              <div key={i} className="rounded-2xl border border-white/8 bg-white/3 p-5 transition-colors hover:bg-white/5">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#8bd450]/10 text-xs font-bold text-[#8bd450]">{i + 1}</span>
                  <span className="rounded-full bg-[#8bd450]/10 px-2 py-0.5 text-[10px] font-medium text-[#8bd450]">PRO</span>
                </div>
                <h3 className="mt-3 text-sm font-semibold">{m.title}</h3>
                <p className="mt-1 text-xs text-zinc-400">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="border-y border-white/6 bg-white/2 px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">O que voce recebe</h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {BENEFITS.map((b, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl border border-white/6 bg-white/3 px-4 py-3">
                <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-[#8bd450]" />
                <span className="text-sm">{b}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing / CTA */}
      <section id="assinar" className="px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-md">
          <div className="rounded-3xl border border-[#8bd450]/20 bg-[#10141b] p-8">
            <p className="font-mono text-xs uppercase tracking-widest text-[#8bd450]">Comunidade GuyFolkz</p>
            <div className="mt-4 flex items-end gap-2">
              <span className="text-4xl font-bold">R$70</span>
              <span className="mb-1 text-sm text-zinc-400">/mes</span>
            </div>
            <p className="mt-2 text-sm text-zinc-400">Cancele quando quiser. Sem fidelidade.</p>

            <form onSubmit={handleCheckout} className="mt-6 space-y-3">
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
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[#8bd450] py-3 text-sm font-semibold text-black transition-all hover:bg-[#9be060] disabled:opacity-50"
              >
                {loading ? 'Redirecionando...' : 'Assinar agora'}
              </button>
            </form>

            <p className="mt-4 text-center text-xs text-zinc-500">
              Pagamento seguro via Stripe. Voce sera redirecionado.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
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
