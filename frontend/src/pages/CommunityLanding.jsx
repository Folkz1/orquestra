import { useState } from 'react'
import { Link } from 'react-router-dom'
import { createCommunityLead } from '../api'

const MODULES = [
  { title: 'Instalacao guiada do Hermes', desc: 'Passo a passo para rodar localmente ou em VPS com Docker, dominio e painel web.' },
  { title: 'Prompts para Claude Code e Codex', desc: 'Comandos prontos para a IA instalar, configurar e validar o agente junto com voce.' },
  { title: 'Repositorios GitHub prontos', desc: 'Arquivos base, templates e estrutura para voce executar sem comecar do zero.' },
  { title: 'GPT-5.5 com OAuth', desc: 'Configuracao do provider OpenAI Codex, modelo, contexto e boas praticas de uso.' },
  { title: 'Telegram, memoria e skills', desc: 'Como ligar o Hermes em canais reais e transformar conversa em agente persistente.' },
  { title: 'Oferta B2B com Hermes', desc: 'Como empacotar agentes self-hosted para clientes, automacoes e operacoes reais.' },
]

const BENEFITS = [
  'Curso Hermes como produto principal desta turma',
  'Prompts prontos para Claude Code e Codex instalarem com voce',
  'Repositorios e templates para rodar localmente ou em VPS',
  '6 meses de comunidade GuyFolkz incluidos como bonus',
  'Fechamento e suporte inicial direto pelo WhatsApp do Diego',
  'Acesso de teste por 6 horas enquanto a assinatura e fechada',
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
        source: 'hermes_course_manual_lead',
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

      setNotice(res?.message || 'Recebemos teu interesse. Vou te chamar no WhatsApp para fechar o Curso Hermes.')
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
            Entre no Curso Hermes e ganhe <span className="text-[#8bd450]">6 meses de comunidade</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-zinc-400 sm:text-lg">
            Aprenda a instalar o Hermes localmente ou na VPS com prompts prontos para Claude Code/Codex,
            repositorios GitHub e suporte direto para colocar seu agente IA self-hosted no ar.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a href="#assinar" className="rounded-2xl bg-[#8bd450] px-8 py-3 text-sm font-semibold text-black transition-transform hover:scale-105">
              Quero entrar no Curso Hermes
            </a>
            <a
              href="https://guyyfolkz.mbest.site/hermes"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl border border-white/10 px-8 py-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5"
            >
              Ver a pagina Hermes
            </a>
          </div>
        </div>
      </section>

      <section className="border-y border-white/6 bg-white/2 px-4 py-12 sm:px-6">
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-3">
          <div className="text-center">
            <p className="text-3xl font-bold text-[#8bd450]">Curso</p>
            <p className="mt-1 text-sm text-zinc-400">Hermes do zero ate o servidor</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-[#5ea6ff]">R$420</p>
            <p className="mt-1 text-sm text-zinc-400">Bonus em 6 meses de comunidade</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-[#67d7d0]">1:1</p>
            <p className="mt-1 text-sm text-zinc-400">Fechamento manual pelo WhatsApp</p>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">O que voce recebe</p>
          <h2 className="mt-3 text-2xl font-bold sm:text-3xl">Treinamento pratico para colocar Hermes no ar</h2>
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
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Como funciona a primeira turma</h2>
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
            <p className="font-mono text-xs uppercase tracking-widest text-[#8bd450]">Curso Hermes + Comunidade</p>
            <div className="mt-4 flex items-end gap-2">
              <span className="text-4xl font-bold">Turma inicial</span>
            </div>
            <p className="mt-2 text-sm text-zinc-400">
              Deixa teu WhatsApp e eu te chamo para fechar o acesso ao curso, aos prompts, aos repositorios e aos 6 meses de comunidade.
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
                {loading ? 'Enviando interesse...' : 'Quero entrar no Curso Hermes'}
              </button>
            </form>

            <p className="mt-4 text-center text-xs text-zinc-500">
              Sem checkout automatico nesta turma. O fechamento e as credenciais seguem direto no WhatsApp.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/6 px-4 py-8 text-center text-xs text-zinc-500">
        <p>GuyFolkz Academy. Construido com Claude Code + Orquestra.</p>
        <div className="mt-2 flex justify-center gap-4">
          <Link to="/membros" className="hover:text-zinc-300">Area de membros</Link>
          <Link to="/hermes" className="hover:text-zinc-300">Pagina Hermes</Link>
          <a href="https://youtube.com/@guyfolkz" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300">YouTube</a>
        </div>
      </footer>
    </div>
  )
}
