import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || ''

function markdownToHtml(md) {
  if (!md) return ''
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="text-emerald-400 underline">$1</a>')
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-emerald-500/50 pl-4 py-2 my-3 bg-emerald-500/5 rounded-r">$1</blockquote>')
    .replace(/^\| (.+) \|$/gm, (match) => {
      const cells = match.split('|').filter(c => c.trim())
      if (cells.some(c => /^-+$/.test(c.trim()))) return ''
      return '<tr>' + cells.map(c => `<td class="border border-zinc-700 px-3 py-2">${c.trim()}</td>`).join('') + '</tr>'
    })
    .replace(/(<tr>[\s\S]*?<\/tr>[\s]*)+/g, '<table class="w-full border-collapse my-4 text-sm">$&</table>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 my-1">$1</li>')
    .replace(/(<li[\s\S]*?<\/li>[\s]*)+/g, '<ul class="list-disc pl-4 my-2">$&</ul>')
    .replace(/^---$/gm, '<hr class="border-zinc-700 my-6">')
    .replace(/\n\n/g, '</p><p class="my-2">')
}

// ── Skills/Hooks/Features data for showcase ──
const SKILLS_FREE = [
  { cmd: '/backlog', desc: 'Gerencia tarefas com prioridades', icon: '📋' },
  { cmd: '/impacto', desc: 'Análise de risco antes de mudar código', icon: '🔍' },
  { cmd: '/ci', desc: 'Pipeline CI local (lint, types, testes)', icon: '🧪' },
  { cmd: '/status', desc: 'Snapshot completo do projeto', icon: '📊' },
]

const SKILLS_PRO = [
  { cmd: '/whatsapp', desc: 'Ler, enviar e buscar mensagens', icon: '💬' },
  { cmd: '/proposta', desc: 'Gerar propostas comerciais B2B', icon: '📄' },
  { cmd: '/daily', desc: 'Briefing matinal completo', icon: '☀️' },
  { cmd: '/orquestrar', desc: 'Workflow: impacto → implementa → review', icon: '🔄' },
  { cmd: '/pesquisar', desc: 'Pesquisa deep multi-perspectiva', icon: '🔎' },
  { cmd: '/youtube', desc: 'Tendências e produção de conteúdo', icon: '🎬' },
  { cmd: '/easypanel', desc: 'Deploy automatizado', icon: '🚀' },
  { cmd: '/deploy', desc: 'CI/CD completo', icon: '📦' },
]

const HOOKS = [
  { name: 'Session Start', event: 'Ao abrir', desc: 'Carrega contexto: branch, backlog, último briefing' },
  { name: 'Session Summary', event: 'Ao fechar', desc: 'Salva resumo da sessão automaticamente' },
  { name: 'Detect Credentials', event: 'Antes de salvar', desc: 'Escaneia por API keys e secrets vazados' },
  { name: 'Sync Decisions', event: 'Após editar', desc: 'Registra decisões importantes' },
  { name: 'Failure Log', event: 'Após erro', desc: 'Loga erros para análise futura' },
  { name: 'Pre-Compact', event: 'Antes de compactar', desc: 'Salva contexto antes do limite' },
]

const ARCH_COMPONENTS = [
  { name: 'CLAUDE.md', desc: 'Cérebro — identidade, regras, convenções', cls: 'border-emerald-500/20 bg-emerald-500/5' },
  { name: 'Skills', desc: '12 comandos que automatizam tudo', cls: 'border-blue-500/20 bg-blue-500/5' },
  { name: 'Hooks', desc: '6 automações invisíveis por evento', cls: 'border-purple-500/20 bg-purple-500/5' },
  { name: 'Memória', desc: 'Persistência entre sessões', cls: 'border-amber-500/20 bg-amber-500/5' },
  { name: 'Orchestrator', desc: 'Pipeline multi-agente autônomo', cls: 'border-rose-500/20 bg-rose-500/5' },
  { name: 'Backlog', desc: 'Tarefas priorizadas por receita', cls: 'border-cyan-500/20 bg-cyan-500/5' },
]

// ── MEGA PROMPTS ──
const MEGA_PROMPT_FREE = `Você é meu novo CTO virtual. Configure este projeto agora.

MEU NOME: [seu nome]
MEU NEGÓCIO: [descreva em 1 linha]
NOME DO ASSISTENTE: [ex: Jarbas, Atlas, Nova]

PASSO 1 — Baixar templates reais:
Execute: git clone https://github.com/Folkz1/playbook-cto-virtual.git /tmp/cto-setup

PASSO 2 — Instalar no projeto:
- Crie as pastas .claude/skills/ e .claude/hooks/ se não existirem
- Copie /tmp/cto-setup/templates/CLAUDE.md para ./CLAUDE.md
- Copie cada pasta de /tmp/cto-setup/templates/skills/* para ./.claude/skills/
- Copie cada arquivo de /tmp/cto-setup/templates/hooks/* para ./.claude/hooks/
- Copie /tmp/cto-setup/templates/settings.json para ./.claude/settings.json
- IMPORTANTE: Se Windows, converta hooks para LF: sed -i 's/\\r$//' .claude/hooks/*.sh
- Delete /tmp/cto-setup quando terminar

PASSO 3 — Personalizar:
No CLAUDE.md, substitua {{NOME_ASSISTENTE}}, {{SEU_NOME}} e {{SEU_NEGOCIO}} pelos meus dados acima.

PASSO 4 — Backlog real:
Analise o projeto inteiro (git log, código, TODOs no código, estrutura) e crie BACKLOG.md com 5+ tarefas REAIS priorizadas em ALTA/MÉDIA/BAIXA.

PASSO 5 — Memória:
Crie .claude/memory/MEMORY.md como índice de memórias do projeto.

PASSO 6 — Confirmar:
Rode /status e me mostre o resultado. Me diga quantos arquivos foram criados.`

const MEGA_PROMPT_PRO = `Você é meu novo CTO virtual. Configure a Orquestra COMPLETA (versão PRO).

MEU NOME: [seu nome]
MEU NEGÓCIO: [descreva seu negócio]
MEU WHATSAPP: [número com DDD, ex: 5511999999999]
NOME DO ASSISTENTE: [nome do CTO virtual]

MÓDULOS QUE QUERO ATIVAR (apague os que não quer):
- WhatsApp (precisa: Evolution API instalada)
- Propostas comerciais
- Orchestrator multi-agente
- YouTube analytics
- EasyPanel deploy (precisa: VPS com EasyPanel)
- Daily briefing

MINHAS CREDENCIAIS (preencha só os módulos que ativou):
- Evolution API URL: [url ou "não tenho"]
- Evolution API Key: [key ou "não tenho"]
- Evolution Instância: [nome ou "não tenho"]
- EasyPanel IP: [ip ou "não tenho"]
- EasyPanel API Key: [key ou "não tenho"]

PASSO 1 — Baixar templates:
Execute: git clone https://github.com/Folkz1/playbook-cto-virtual.git /tmp/cto-setup

PASSO 2 — Instalar base FREE:
- Crie as pastas .claude/skills/ e .claude/hooks/
- Copie /tmp/cto-setup/templates/CLAUDE.md para ./CLAUDE.md
- Copie /tmp/cto-setup/templates/skills/* para ./.claude/skills/
- Copie /tmp/cto-setup/templates/hooks/* para ./.claude/hooks/
- Copie /tmp/cto-setup/templates/settings.json para ./.claude/settings.json

PASSO 3 — Instalar PRO (skills + hooks + orchestrator):
- Copie /tmp/cto-setup/pro/skills/* para ./.claude/skills/ (sobrescreve e adiciona)
- Copie /tmp/cto-setup/pro/hooks/* para ./.claude/hooks/
- Copie /tmp/cto-setup/pro/orchestrator-template.mjs para ./orchestrator.mjs
- Se Windows: execute sed -i 's/\\r$//' .claude/hooks/*.sh
- Atualize .claude/settings.json com TODOS os hooks (FREE + PRO) nos eventos corretos

PASSO 4 — Configurar credenciais:
- Se eu informei credenciais da Evolution API: crie .env com EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE
- Se eu informei credenciais do EasyPanel: adicione EASYPANEL_IP, EASYPANEL_API_KEY no .env
- Se eu disse "não tenho" em algum: IGNORE o módulo, não configure. Me diga que posso ativar depois.
- NUNCA commitar o .env — adicione ao .gitignore

PASSO 5 — Personalizar:
- CLAUDE.md: substituir {{NOME_ASSISTENTE}}, {{SEU_NOME}}, {{SEU_NEGOCIO}}
- Adicionar seção "Projetos Ativos" com tabela dos projetos reais
- Adicionar seção "Agent Team": Leader Opus, Teammates Sonnet, max 3
- Listar apenas os módulos que eu ativei

PASSO 6 — Backlog + Memória:
- Analise o projeto inteiro (git log, código, TODOs) e crie BACKLOG.md real
- Crie .claude/memory/MEMORY.md como índice

PASSO 7 — Limpar e confirmar:
- Delete /tmp/cto-setup
- Rode /status e me mostre o resultado
- Liste os módulos ativados vs desativados
- Explique em 3 linhas como usar no dia a dia`


// ── Showcase Landing ─────────────────────────
function ShowcaseLanding({ modules, onSelectModule, onInstall }) {
  const [copied, setCopied] = useState(null)
  const [showPro, setShowPro] = useState(false)
  const freeModules = modules.filter(m => m.tier === 'free')
  const proModules = modules.filter(m => m.tier === 'pro')

  const copyPrompt = (type) => {
    const prompt = type === 'pro' ? MEGA_PROMPT_PRO : MEGA_PROMPT_FREE
    navigator.clipboard.writeText(prompt)
    setCopied(type)
    setTimeout(() => setCopied(null), 3000)
  }

  return (
    <div className="min-h-screen bg-[#090b10]">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
          <div className="absolute top-20 right-1/4 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl" />
        </div>
        <div className="max-w-5xl mx-auto px-6 pt-12 pb-8 relative">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm mb-6">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Framework Open Source
            </div>
            <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 leading-tight tracking-tight">
              Orquestra<br />
              <span className="bg-gradient-to-r from-emerald-400 to-blue-400 bg-clip-text text-transparent">CTO Virtual</span>
            </h1>
            <p className="text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto mb-8">
              Um framework que transforma o Claude Code no seu CTO pessoal.
              <br className="hidden md:block" />
              <strong className="text-zinc-200">Um prompt. Tudo configurado. Comece a usar.</strong>
            </p>

            {/* Install buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-4">
              <button
                onClick={() => copyPrompt('free')}
                className="group px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(52,211,153,0.3)] text-lg"
              >
                {copied === 'free' ? 'Copiado! Cole no Claude Code' : 'Copiar Prompt FREE'}
              </button>
              <button
                onClick={() => copyPrompt('pro')}
                className="group px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold rounded-xl transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(245,158,11,0.3)] text-lg"
              >
                {copied === 'pro' ? 'Copiado! Cole no Claude Code' : 'Copiar Prompt PRO'}
              </button>
            </div>
            <p className="text-zinc-600 text-sm">Cole no Claude Code dentro do seu projeto. Ele baixa os templates e configura tudo sozinho.</p>
            <a href="https://github.com/Folkz1/playbook-cto-virtual" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-4 text-zinc-500 hover:text-white text-sm transition-colors">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              Ver templates no GitHub
            </a>
          </div>
        </div>
      </div>

      {/* Architecture */}
      <div className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold text-white mb-2 text-center">O que é instalado</h2>
        <p className="text-zinc-500 text-center mb-8">6 componentes que trabalham juntos</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {ARCH_COMPONENTS.map((c, i) => (
            <div key={i} className={`p-4 rounded-xl border ${c.cls}`}>
              <h3 className="text-white font-semibold text-sm">{c.name}</h3>
              <p className="text-zinc-500 text-xs mt-1">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How it works - 3 steps */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold text-white mb-8 text-center">Como funciona</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { n: '1', title: 'Copie o prompt', desc: 'Escolha FREE (4 skills) ou PRO (12 skills + orchestrator). Clique no botão acima.' },
            { n: '2', title: 'Cole no Claude Code', desc: 'Abra o Claude Code no seu projeto e cole. Preencha seu nome e negócio. Ele cria tudo.' },
            { n: '3', title: 'Use os skills', desc: 'Digite /status, /backlog, /impacto. O CTO Virtual já conhece seu projeto.' },
          ].map((s, i) => (
            <div key={i} className="text-center p-6 rounded-xl bg-zinc-900/50 border border-zinc-800">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-lg flex items-center justify-center mx-auto mb-3">{s.n}</div>
              <h3 className="text-white font-semibold mb-2">{s.title}</h3>
              <p className="text-zinc-500 text-sm">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Skills showcase */}
      <div className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold text-white mb-2">Skills Disponíveis</h2>
        <p className="text-zinc-500 mb-6">Comandos que você digita no Claude Code</p>

        {/* FREE skills */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-xs font-bold">FREE</span>
            <span className="text-zinc-500 text-sm">Incluído no prompt gratuito</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SKILLS_FREE.map((s, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 border border-zinc-800 hover:border-emerald-500/30 transition-colors">
                <span className="text-xl">{s.icon}</span>
                <div>
                  <code className="text-emerald-400 text-sm font-bold">{s.cmd}</code>
                  <p className="text-zinc-500 text-xs">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* PRO skills */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs font-bold">PRO</span>
            <span className="text-zinc-500 text-sm">Incluído no prompt PRO</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SKILLS_PRO.map((s, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/30 border border-zinc-800 hover:border-amber-500/30 transition-colors">
                <span className="text-xl">{s.icon}</span>
                <div>
                  <code className="text-amber-400 text-sm font-bold">{s.cmd}</code>
                  <p className="text-zinc-500 text-xs">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hooks */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold text-white mb-2">Hooks — Automação Invisível</h2>
        <p className="text-zinc-500 mb-6">Rodam sozinhos, sem você fazer nada</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {HOOKS.map((h, i) => (
            <div key={i} className="p-3 rounded-xl bg-zinc-900/30 border border-zinc-800">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-purple-400 text-xs font-mono bg-purple-500/10 px-1.5 py-0.5 rounded">{h.event}</span>
              </div>
              <h4 className="text-white text-sm font-medium">{h.name}</h4>
              <p className="text-zinc-600 text-xs mt-0.5">{h.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Orchestrator Pipeline */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold text-white mb-2">Pipeline Multi-Agente</h2>
        <p className="text-zinc-500 mb-6">Incluído no PRO — automatiza implementação com code review</p>
        <div className="flex flex-col md:flex-row items-center gap-3 md:gap-0 justify-center">
          {[
            { name: 'Seed Gate', model: 'Haiku', desc: 'Valida a tarefa', cls: 'border-zinc-500/30 bg-zinc-500/10' },
            { name: 'Worker', model: 'Sonnet', desc: 'Implementa', cls: 'border-blue-500/30 bg-blue-500/10' },
            { name: 'Reviewer', model: 'Sonnet', desc: 'Code review', cls: 'border-purple-500/30 bg-purple-500/10' },
            { name: 'Aprovado', model: '', desc: 'Commit automático', cls: 'border-emerald-500/30 bg-emerald-500/10' },
          ].map((stage, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className={`p-4 rounded-xl border ${stage.cls} text-center min-w-[120px]`}>
                <div className="text-white font-semibold text-sm">{stage.name}</div>
                {stage.model && <div className="text-zinc-500 text-xs">{stage.model}</div>}
                <div className="text-zinc-400 text-xs mt-1">{stage.desc}</div>
              </div>
              {i < 3 && <span className="text-zinc-600 text-lg hidden md:block">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Modules - Learn more */}
      <div id="modulos" className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold text-white mb-2">Documentação por Módulo</h2>
        <p className="text-zinc-500 mb-6">Aprenda como cada parte funciona em detalhe</p>

        <div className="grid gap-3">
          {modules.map(m => (
            <button
              key={m.slug}
              onClick={() => onSelectModule(m.slug)}
              className={`w-full text-left flex items-center gap-4 p-4 rounded-xl border transition-all hover:scale-[1.005] ${
                m.tier === 'pro'
                  ? 'bg-zinc-900/30 border-zinc-800 hover:border-amber-500/30'
                  : 'bg-zinc-900/50 border-zinc-800 hover:border-emerald-500/30'
              }`}
            >
              <div className="text-2xl">{m.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-white font-medium text-sm">{m.title}</h3>
                  {m.tier === 'pro' && <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">PRO</span>}
                </div>
                <p className="text-zinc-600 text-xs mt-0.5">{m.description}</p>
              </div>
              <div className="text-zinc-500 text-xs whitespace-nowrap">{m.step_count} aulas</div>
              <span className="text-zinc-700">→</span>
            </button>
          ))}
        </div>
      </div>

      {/* Install CTA */}
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="rounded-2xl bg-gradient-to-r from-emerald-900/30 via-blue-900/20 to-purple-900/30 border border-emerald-500/20 p-8 text-center">
          <h3 className="text-2xl font-bold text-white mb-2">Instale agora no seu projeto</h3>
          <p className="text-zinc-400 mb-6">Um prompt. 5 minutos. CTO Virtual configurado.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => copyPrompt('free')}
              className="px-8 py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl transition-all hover:scale-105"
            >
              {copied === 'free' ? 'Copiado!' : 'FREE — 4 Skills + 3 Hooks'}
            </button>
            <button
              onClick={() => copyPrompt('pro')}
              className="px-8 py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold rounded-xl transition-all hover:scale-105"
            >
              {copied === 'pro' ? 'Copiado!' : 'PRO — 12 Skills + Orchestrator'}
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-800 py-8 text-center text-zinc-600 text-sm">
        <p>Orquestra CTO Virtual — Por Diego | <span className="text-emerald-500">GuyFolkz</span></p>
        <p className="mt-1">Automação & IA para Negócios</p>
      </footer>
    </div>
  )
}


// ── Module View ─────────────────────────────
function ModuleView({ module, onSelectStep, onBack, phone }) {
  const completedCount = module.steps.filter(s => s.is_completed).length

  return (
    <div className="min-h-screen bg-[#090b10]">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <button onClick={onBack} className="text-zinc-500 hover:text-white text-sm mb-6 flex items-center gap-1">
          ← Voltar
        </button>
        <div className="flex items-start gap-4 mb-8">
          <div className="text-4xl">{module.icon}</div>
          <div>
            <h1 className="text-2xl font-bold text-white">{module.title}</h1>
            <p className="text-zinc-500 mt-1">{module.description}</p>
            {phone && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden max-w-xs">
                  <div className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${module.steps.length ? (completedCount / module.steps.length) * 100 : 0}%` }} />
                </div>
                <span className="text-xs text-zinc-600">{completedCount}/{module.steps.length}</span>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-3">
          {module.steps.map((step, i) => (
            <button key={step.id} onClick={() => onSelectStep(i)}
              className="w-full text-left flex items-center gap-4 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step.is_completed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
              }`}>
                {step.is_completed ? '✓' : i + 1}
              </div>
              <div className="flex-1">
                <div className="text-white text-sm font-medium">{step.title}</div>
                <div className="flex gap-3 mt-1 text-xs text-zinc-600">
                  <span>{step.step_type === 'theory' ? '📖 Teoria' : '🛠️ Prática'}</span>
                  {step.duration_min && <span>{step.duration_min} min</span>}
                </div>
              </div>
              {step.code_snippet && <span className="text-emerald-500/50 text-xs">tem prompt</span>}
              <span className="text-zinc-700">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}


// ── Step View ─────────────────────────────────
function StepView({ module, step, stepIndex, totalSteps, onNext, onPrev, onComplete, onBack, phone }) {
  const [promptCopied, setPromptCopied] = useState(false)

  const handleComplete = async () => {
    if (!phone || step.is_completed) return
    try {
      await fetch(`${API}/api/playbook/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, step_id: step.id })
      })
      onComplete(step.id)
    } catch (err) { console.error(err) }
  }

  const copySnippet = () => {
    navigator.clipboard.writeText(step.code_snippet)
    setPromptCopied(true)
    setTimeout(() => setPromptCopied(false), 3000)
  }

  return (
    <div className="min-h-screen bg-[#090b10]">
      {/* Top bar */}
      <div className="sticky top-0 z-40 bg-[#090b10]/90 backdrop-blur border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <button onClick={onBack} className="text-zinc-500 hover:text-white text-sm">← {module.title}</button>
          <div className="flex items-center gap-2">
            <span className="text-zinc-600 text-sm">{stepIndex + 1}/{totalSteps}</span>
            <div className="flex gap-1">
              {Array.from({ length: totalSteps }, (_, i) => (
                <div key={i} className={`w-6 h-1.5 rounded-full transition-all ${
                  i === stepIndex ? 'bg-emerald-400' : i < stepIndex ? 'bg-emerald-400/30' : 'bg-zinc-800'
                }`} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Badge */}
        <div className="flex items-center gap-3 mb-4">
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            step.step_type === 'theory' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
          }`}>
            {step.step_type === 'theory' ? '📖 Teoria' : '🛠️ Prática'}
          </span>
          {step.duration_min && <span className="text-zinc-600 text-xs">{step.duration_min} min</span>}
        </div>

        {/* Content */}
        <div className="prose-playbook text-zinc-300 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(step.content) }} />

        {/* Prompt to copy */}
        {step.code_snippet && (
          <div className="mt-8 rounded-xl border-2 border-emerald-500/30 bg-emerald-500/5 p-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-emerald-400 font-bold">Prompt para colar no Claude Code:</h4>
              <button onClick={copySnippet}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  promptCopied
                    ? 'bg-emerald-500 text-black'
                    : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                }`}>
                {promptCopied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
            <pre className="bg-zinc-950 rounded-lg p-4 text-sm text-zinc-300 font-mono whitespace-pre-wrap overflow-x-auto max-h-96 overflow-y-auto">
              {step.code_snippet}
            </pre>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-12 pt-6 border-t border-zinc-800">
          <button onClick={onPrev} disabled={stepIndex === 0}
            className="px-4 py-2 text-sm text-zinc-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
            ← Anterior
          </button>
          <div className="flex gap-3">
            {!step.is_completed && phone && (
              <button onClick={handleComplete}
                className="px-5 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 text-sm">
                Marcar concluída
              </button>
            )}
            {step.is_completed && <span className="text-emerald-400 text-sm">✓ Concluída</span>}
          </div>
          <button onClick={onNext} disabled={stepIndex === totalSteps - 1}
            className="px-4 py-2 text-sm bg-emerald-500 text-black rounded-lg font-medium hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed">
            Próxima →
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Main Component ───────────────────────────
export default function PlaybookPlatform() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [modules, setModules] = useState([])
  const [currentModule, setCurrentModule] = useState(null)
  const [currentStepIndex, setCurrentStepIndex] = useState(-1)
  const [phone] = useState(() => localStorage.getItem('playbook_phone') || '')
  const [loading, setLoading] = useState(true)

  const activeSlug = searchParams.get('m')
  const activeStep = parseInt(searchParams.get('s') || '-1')

  useEffect(() => {
    fetch(`${API}/api/playbook/modules`)
      .then(r => r.json()).then(setModules).catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeSlug) { setCurrentModule(null); return }
    fetch(`${API}/api/playbook/modules/${activeSlug}${phone ? `?phone=${phone}` : ''}`)
      .then(r => r.json()).then(data => {
        setCurrentModule(data)
        if (activeStep >= 0) setCurrentStepIndex(activeStep)
      }).catch(() => {})
  }, [activeSlug, phone])

  const navigateToModule = useCallback((slug) => {
    setSearchParams({ m: slug }); setCurrentStepIndex(-1)
  }, [setSearchParams])

  const navigateToStep = useCallback((index) => {
    setCurrentStepIndex(index); setSearchParams({ m: activeSlug, s: String(index) })
  }, [activeSlug, setSearchParams])

  const navigateHome = useCallback(() => {
    setSearchParams({}); setCurrentModule(null); setCurrentStepIndex(-1)
  }, [setSearchParams])

  const handleComplete = (stepId) => {
    if (!currentModule) return
    setCurrentModule(prev => ({ ...prev, steps: prev.steps.map(s => s.id === stepId ? { ...s, is_completed: true } : s) }))
  }

  if (loading) return <div className="min-h-screen bg-[#090b10] flex items-center justify-center"><div className="text-zinc-500">Carregando...</div></div>

  if (currentModule && currentStepIndex >= 0 && currentModule.steps[currentStepIndex]) {
    return <StepView module={currentModule} step={currentModule.steps[currentStepIndex]}
      stepIndex={currentStepIndex} totalSteps={currentModule.steps.length}
      onNext={() => navigateToStep(currentStepIndex + 1)} onPrev={() => navigateToStep(currentStepIndex - 1)}
      onComplete={handleComplete} onBack={() => { setCurrentStepIndex(-1); setSearchParams({ m: activeSlug }) }}
      phone={phone} />
  }

  if (currentModule) {
    return <ModuleView module={currentModule} onSelectStep={navigateToStep} onBack={navigateHome} phone={phone} />
  }

  return <ShowcaseLanding modules={modules} onSelectModule={navigateToModule} />
}
