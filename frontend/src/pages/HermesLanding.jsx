import { useState } from 'react'

const INSTALL_PROMPT = `Instala o Hermes Agent v0.10.0 no meu servidor e configura um agente de IA self-hosted.

## Contexto
Hermes Agent é um framework open-source (Nous Research) para rodar agentes de IA locais num servidor VDS/VPS próprio.
O agente tem memória persistente, skills configuráveis e gateway para WhatsApp e Telegram.
Funciona com qualquer provider LLM: OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, ou qualquer endpoint OpenAI-compatível.

## O que vais instalar
- Hermes Agent v0.10.0 via Docker
- Persona personalizada (SOUL.md) — nome, língua, área de especialização
- OpenAI-compatible shim na porta 9120 (necessário para integrar com WhatsApp via Z-API)
- (Opcional) Gateway Telegram via \`hermes gateway run\`

## Antes de começar, pergunta-me (uma de cada vez):

### 1. Servidor
- IP do servidor e utilizador SSH (ex: root@77.237.233.117)

### 2. Persona
- Nome do agente (ex: Joana, Max, SilvIA)
- Área de atuação (ex: jurídica, médica, atendimento, imobiliária)
- Língua principal (pt-PT, pt-BR, en, es...)

### 3. Provider LLM — qual queres usar?
| Provider      | Quando escolher                       | Variável de ambiente |
|---------------|---------------------------------------|----------------------|
| OpenAI        | Já tens conta OpenAI / queres GPT-4o  | OPENAI_API_KEY       |
| Anthropic     | Queres Claude (Sonnet/Opus)           | ANTHROPIC_API_KEY    |
| Google Gemini | Tier gratuito generoso, multimodal    | GEMINI_API_KEY       |
| OpenRouter    | Escolher entre 300+ modelos           | OPENROUTER_API_KEY   |
| Groq          | Velocidade máxima (Llama 3.1 70B)     | GROQ_API_KEY         |
| Ollama local  | 100% local (Llama, Mistral)           | endpoint http://host:11434 |
| Custom        | Qualquer endpoint OpenAI-compat       | URL + API key        |

Pergunta qual o provider e pede a API key correspondente.

### 4. Modelo específico (depende do provider)
Exemplos: OpenAI \`gpt-4o-mini\`, Anthropic \`claude-sonnet-4-5\`, Gemini \`gemini-2.5-flash\`, OpenRouter \`anthropic/claude-sonnet-4.5\`, Groq \`llama-3.1-70b-versatile\`, Ollama \`llama3.1\`.

### 5. Integrações
- Instalar gateway Telegram? (sim/não — se sim, pede TELEGRAM_BOT_TOKEN do @BotFather)
- Instalar shim WhatsApp? (sim/não — se sim, pede a URL do Z-API bridge)

## Referência de comandos

### 1. Criar container Hermes (exemplo OpenAI — ajusta ao provider escolhido)
\`\`\`bash
docker run -d --name hermes \\
  --restart unless-stopped \\
  -e OPENAI_API_KEY=<chave> \\
  -e LLM_PROVIDER=openai \\
  -e LLM_MODEL=gpt-4o-mini \\
  -p 9119:9119 -p 9120:9120 \\
  -v /home/hermes:/home/hermes \\
  ghcr.io/folkz1/hermes:v0.10.0
\`\`\`

Ajustar env var conforme provider:
- OPENAI_API_KEY=sk-... + LLM_PROVIDER=openai
- ANTHROPIC_API_KEY=sk-ant-... + LLM_PROVIDER=anthropic
- GEMINI_API_KEY=AIza... + LLM_PROVIDER=gemini
- OPENROUTER_API_KEY=sk-or-... + LLM_PROVIDER=openrouter
- GROQ_API_KEY=gsk_... + LLM_PROVIDER=groq
- Ollama: LLM_PROVIDER=openai + LLM_BASE_URL=http://host.docker.internal:11434/v1
- Custom: LLM_PROVIDER=openai + LLM_BASE_URL=<url> + OPENAI_API_KEY=<key>

### 2. Verificar instalação
\`\`\`bash
docker exec hermes hermes --version
docker exec hermes hermes doctor
docker exec hermes hermes chat -q "qual o teu nome?" -Q
\`\`\`

### 3. Configurar persona (SOUL.md)
Personaliza o SOUL.md com o nome, língua e área do teu agente.

### 4. Gateway Telegram (opcional)
\`\`\`bash
hermes gateway run --token <TELEGRAM_BOT_TOKEN>
\`\`\`

Recomendo começar com o provider que já tens conta/API key — evita um passo de setup.
Começa por me perguntar o IP e as credenciais SSH.`

const MIGRATE_PROMPT = `Migra o meu agente OpenClaw para o Hermes Agent usando a migração oficial.

## Contexto
O \`hermes claw migrate\` é o comando oficial de migração OpenClaw → Hermes.
Transfere: SOUL.md (personalidade), playbooks, knowledge base e configurações.
O Hermes é o sucessor do OpenClaw — mesma filosofia, mais recursos, escolha livre de provider LLM (OpenAI, Anthropic, Gemini, OpenRouter, Groq, Ollama local, ou custom).

## O que vais fazer
1. SSH ao servidor onde o OpenClaw está rodando
2. Instalar Hermes Agent se não instalado (Docker) — com o provider LLM escolhido
3. \`hermes claw migrate --dry-run\` — preview sem executar nada
4. \`hermes claw migrate --yes\` — migração real
5. Verificar que o agente responde com a personalidade correcta
6. Instalar shim OpenAI-compat (porta 9120) para bridge WhatsApp
7. Actualizar docker-compose do bridge para apontar para Hermes
8. Testar o bot no WhatsApp ao vivo

## Antes de começar, pergunta-me (uma de cada vez):

### 1. Servidor
- IP do servidor e utilizador SSH (ex: root@77.237.233.117)

### 2. Container OpenClaw
- O OpenClaw está em container Docker? Se sim, nome do container

### 3. Bridge WhatsApp
- Tens bridge WhatsApp (Z-API bridge ou similar)? Qual a URL actual do LLM endpoint?

### 4. Provider LLM para o Hermes — qual queres usar?
| Provider      | Quando escolher                       | Variável de ambiente |
|---------------|---------------------------------------|----------------------|
| OpenAI        | Já tens conta OpenAI / queres GPT-4o  | OPENAI_API_KEY       |
| Anthropic     | Queres Claude (Sonnet/Opus)           | ANTHROPIC_API_KEY    |
| Google Gemini | Tier gratuito generoso, multimodal    | GEMINI_API_KEY       |
| OpenRouter    | Escolher entre 300+ modelos           | OPENROUTER_API_KEY   |
| Groq          | Velocidade máxima (Llama 3.1 70B)     | GROQ_API_KEY         |
| Ollama local  | 100% local (Llama, Mistral)           | endpoint http://host:11434 |
| Custom        | Qualquer endpoint OpenAI-compat       | URL + API key        |

Pergunta qual o provider e pede a API key.

### 5. Modelo específico (depende do provider)
Exemplos: OpenAI \`gpt-4o-mini\`, Anthropic \`claude-sonnet-4-5\`, Gemini \`gemini-2.5-flash\`, OpenRouter \`anthropic/claude-sonnet-4.5\`, Groq \`llama-3.1-70b-versatile\`, Ollama \`llama3.1\`.

### 6. Transição
- Manter OpenClaw activo durante a transição ou desligá-lo imediatamente?

## Referência de comandos

### Instalação Hermes (exemplo OpenAI — ajusta env var ao provider escolhido)
\`\`\`bash
docker run -d --name hermes --restart unless-stopped \\
  -e OPENAI_API_KEY=<chave> \\
  -e LLM_PROVIDER=openai \\
  -e LLM_MODEL=gpt-4o-mini \\
  -p 9119:9119 -p 9120:9120 \\
  -v /home/hermes:/home/hermes \\
  ghcr.io/folkz1/hermes:v0.10.0
\`\`\`

Ajustar env var conforme provider:
- OPENAI_API_KEY + LLM_PROVIDER=openai
- ANTHROPIC_API_KEY + LLM_PROVIDER=anthropic
- GEMINI_API_KEY + LLM_PROVIDER=gemini
- OPENROUTER_API_KEY + LLM_PROVIDER=openrouter
- GROQ_API_KEY + LLM_PROVIDER=groq
- Ollama: LLM_PROVIDER=openai + LLM_BASE_URL=http://host.docker.internal:11434/v1
- Custom: LLM_PROVIDER=openai + LLM_BASE_URL=<url> + OPENAI_API_KEY=<key>

### Migração
\`\`\`bash
hermes claw migrate --dry-run   # preview
hermes claw migrate --yes        # executar
\`\`\`

### Verificação
\`\`\`bash
hermes chat -q "quem és tu?" -Q   # deve responder com a persona migrada
hermes skills list
\`\`\`

### Actualizar bridge WhatsApp
\`\`\`bash
# No docker-compose do bridge, mudar:
# OPENCLAW_URL=http://openclaw:18789  →  OPENCLAW_URL=http://172.18.0.1:9120
docker compose up -d
\`\`\`

### Testar shim
\`\`\`bash
curl -X POST http://<IP>:9120/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"hermes","messages":[{"role":"user","content":"teste"}]}'
\`\`\`

Recomendo começar com o provider que já tens conta/API key.
Começa por me perguntar o IP e as credenciais SSH.`

const ARCH_STEPS = [
  { icon: '📱', label: 'WhatsApp / Telegram', desc: 'Utilizador envia mensagem' },
  { icon: '🔗', label: 'Z-API Bridge', desc: 'Rate limit + trigger + Gemini multimodal' },
  { icon: '🧠', label: 'Hermes Shim', desc: 'Traduz OpenAI → Hermes CLI (porta 9120)' },
  { icon: '🤖', label: 'Hermes Agent', desc: 'SOUL + skills + memória + RAG' },
]

const DEMO_LINKS = [
  { icon: '💻', label: 'CLI Web', url: 'https://hermes-testdrive.advocaciadeguerrilha.com', desc: 'Terminal no browser' },
  { icon: '📊', label: 'Dashboard UI', url: 'https://hermes-ui.advocaciadeguerrilha.com', desc: 'Sessões em tempo real' },
  { icon: '✈️', label: 'Telegram Bot', url: 'https://t.me/Hermesstestebot', desc: 'Chat com o agente' },
]

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }
  return (
    <button
      onClick={handleCopy}
      className={`px-6 py-3 rounded-xl font-bold text-sm transition-all duration-200 ${
        copied
          ? 'bg-emerald-500 text-black scale-95'
          : 'bg-emerald-500 hover:bg-emerald-400 text-black hover:scale-105 hover:shadow-[0_0_30px_rgba(52,211,153,0.3)]'
      }`}
    >
      {copied ? '✓ Copiado! Cole no Claude Code' : label}
    </button>
  )
}

export default function HermesLanding() {
  const [tab, setTab] = useState('install')

  return (
    <div className="min-h-screen bg-[#090b10] text-white font-sans">
      {/* Background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/8 rounded-full blur-3xl" />
        <div className="absolute top-40 right-1/4 w-72 h-72 bg-blue-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-1/3 w-80 h-80 bg-emerald-500/6 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm mb-6">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Hermes Agent v0.10.0 — Open Source
          </div>

          <h1 className="text-5xl md:text-6xl font-bold mb-4 tracking-tight leading-none">
            <span className="text-white">Hermes</span>
            <br />
            <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-emerald-400 bg-clip-text text-transparent">
              IA Self-Hosted
            </span>
          </h1>

          <p className="text-lg text-zinc-400 max-w-xl mx-auto mb-3">
            Agente de IA no teu servidor. Com memória, skills, WhatsApp e Telegram.
            <br />
            <strong className="text-zinc-200">Escolhe o teu LLM: OpenAI, Anthropic, Gemini, Groq, Ollama local ou custom.</strong>
          </p>

          <p className="text-sm text-zinc-600">
            Criado por{' '}
            <a href="https://wa.me/555193299031" target="_blank" rel="noopener noreferrer"
              className="text-zinc-400 hover:text-white transition-colors">
              Diego · GuyFolkz
            </a>
          </p>
        </div>

        {/* Architecture */}
        <div className="mb-12 p-6 rounded-2xl border border-zinc-800 bg-zinc-900/40">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-widest mb-5 text-center">
            Como Funciona
          </h2>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
            {ARCH_STEPS.map((step, i) => (
              <div key={i} className="flex flex-col sm:flex-row items-center gap-2">
                <div className="text-center px-4 py-3 rounded-xl border border-zinc-700/50 bg-zinc-800/40 min-w-[130px]">
                  <div className="text-2xl mb-1">{step.icon}</div>
                  <div className="text-xs font-semibold text-white">{step.label}</div>
                  <div className="text-xs text-zinc-500 mt-0.5 leading-tight">{step.desc}</div>
                </div>
                {i < ARCH_STEPS.length - 1 && (
                  <div className="text-zinc-600 text-lg sm:rotate-0 rotate-90">→</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-8">
          <div className="flex gap-2 p-1 bg-zinc-900/60 rounded-xl border border-zinc-800 w-fit mx-auto">
            <button
              onClick={() => setTab('install')}
              className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                tab === 'install'
                  ? 'bg-purple-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.3)]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              🆕 Instalar do Zero
            </button>
            <button
              onClick={() => setTab('migrate')}
              className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                tab === 'migrate'
                  ? 'bg-blue-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.3)]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              🔄 Migrar do OpenClaw
            </button>
          </div>
        </div>

        {/* Tab content */}
        {tab === 'install' && (
          <div className="space-y-6 mb-12">
            <div className="p-6 rounded-2xl border border-purple-500/20 bg-purple-500/5">
              <div className="flex items-start gap-4 mb-4">
                <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400 text-xl">🚀</div>
                <div>
                  <h3 className="font-bold text-white mb-1">Instalar Hermes do Zero</h3>
                  <p className="text-sm text-zinc-400">
                    Cola o prompt abaixo no Claude Code dentro de qualquer directório.
                    O Claude pergunta o IP do servidor, instala via Docker, configura a persona e testa tudo.
                  </p>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {['Docker instalado no servidor', 'API key do provider à escolha (OpenAI, Anthropic, Gemini, Groq…) ou Ollama local', 'Acesso SSH ao servidor'].map(r => (
                  <div key={r} className="flex items-center gap-2 text-sm text-zinc-400">
                    <span className="text-emerald-400">✓</span> {r}
                  </div>
                ))}
              </div>

              <CopyButton text={INSTALL_PROMPT} label="Copiar Prompt — Instalar Hermes" />
            </div>

            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
              <p className="text-xs text-zinc-500 mb-3 font-semibold uppercase tracking-wider">Preview do Prompt</p>
              <pre className="text-xs text-zinc-400 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                {INSTALL_PROMPT.slice(0, 600)}...
              </pre>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {['Hermes instalado via Docker', 'Persona configurada (SOUL.md)', 'Gateway Telegram activo'].map((s, i) => (
                <div key={i} className="p-3 rounded-xl border border-zinc-800 text-center">
                  <div className="text-emerald-400 font-bold text-lg mb-1">{i + 1}</div>
                  <div className="text-xs text-zinc-400">{s}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'migrate' && (
          <div className="space-y-6 mb-12">
            <div className="p-6 rounded-2xl border border-blue-500/20 bg-blue-500/5">
              <div className="flex items-start gap-4 mb-4">
                <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 text-xl">🔄</div>
                <div>
                  <h3 className="font-bold text-white mb-1">Migrar do OpenClaw para Hermes</h3>
                  <p className="text-sm text-zinc-400">
                    O comando <code className="text-blue-300 bg-zinc-800 px-1 rounded">hermes claw migrate</code> transfere
                    automaticamente: persona (SOUL.md), playbooks, knowledge base e configurações.
                    O Claude guia todo o processo no teu servidor.
                  </p>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {['OpenClaw rodando no servidor', 'Hermes instalado (ou Claude instala)', 'API key do provider à escolha (ou Ollama local)'].map(r => (
                  <div key={r} className="flex items-center gap-2 text-sm text-zinc-400">
                    <span className="text-blue-400">✓</span> {r}
                  </div>
                ))}
              </div>

              <CopyButton text={MIGRATE_PROMPT} label="Copiar Prompt — Migrar do OpenClaw" />
            </div>

            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
              <p className="text-xs text-zinc-500 mb-3 font-semibold uppercase tracking-wider">Preview do Prompt</p>
              <pre className="text-xs text-zinc-400 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                {MIGRATE_PROMPT.slice(0, 600)}...
              </pre>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {['SOUL + playbooks migrados', 'WhatsApp actualizado', 'Agente testado e activo'].map((s, i) => (
                <div key={i} className="p-3 rounded-xl border border-zinc-800 text-center">
                  <div className="text-blue-400 font-bold text-lg mb-1">{i + 1}</div>
                  <div className="text-xs text-zinc-400">{s}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Demo links */}
        <div className="mb-12">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-widest mb-4 text-center">
            Demos ao Vivo (case Eduardo — Advocacia de Guerrilha)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {DEMO_LINKS.map(({ icon, label, url, desc }) => (
              <a key={label} href={url} target="_blank" rel="noopener noreferrer"
                className="group p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-800/40 transition-all hover:scale-[1.02]">
                <div className="text-2xl mb-2">{icon}</div>
                <div className="font-semibold text-white text-sm mb-0.5">{label}</div>
                <div className="text-xs text-zinc-500">{desc}</div>
              </a>
            ))}
          </div>
        </div>

        {/* Video placeholder */}
        <div className="mb-12 p-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 text-center">
          <div className="text-4xl mb-3">🎬</div>
          <h2 className="font-bold text-white mb-2">Ver em Acção</h2>
          <p className="text-sm text-zinc-500 mb-4">
            Vídeo completo em breve no canal GuyFolkz — instalação, migração, WhatsApp multimodal e Telegram ao vivo.
          </p>
          <a href="https://youtube.com/@GuyFolkz" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition-all hover:scale-105">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>
            Subscrever GuyFolkz
          </a>
        </div>

        {/* Community upsell */}
        <div className="mb-8 relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/8 via-orange-500/5 to-transparent p-8">
          <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-semibold mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Comunidade GuyFolkz
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">
              Isto é só o que partilhamos em público.
            </h2>
            <p className="text-zinc-400 mb-6 max-w-xl">
              Na comunidade tens acesso a <strong className="text-zinc-200">playbooks completos</strong>,
              os prompts que usamos com clientes reais, skills avançadas de RAG, automações B2B,
              e uma biblioteca de casos como este do Eduardo — entregues a cada semana.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { icon: '🧠', label: 'Prompts testados em produção' },
                { icon: '⚙️', label: 'Skills RAG + multimodal' },
                { icon: '📦', label: 'Playbooks B2B completos' },
                { icon: '🎬', label: 'Cases reais semana a semana' },
              ].map(({ icon, label }) => (
                <div key={label} className="p-3 rounded-xl border border-zinc-700/50 bg-zinc-800/30 text-center">
                  <div className="text-xl mb-1">{icon}</div>
                  <div className="text-xs text-zinc-400 leading-tight">{label}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <a href="https://guyyfolkz.mbest.site/comunidade" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold transition-all hover:scale-105 hover:shadow-[0_0_30px_rgba(245,158,11,0.3)]">
                Entrar na Comunidade →
              </a>
              <a href="https://guyyfolkz.mbest.site/playbook" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white font-semibold transition-all">
                Ver Playbooks Grátis
              </a>
            </div>
          </div>
        </div>

        {/* CTA implementação */}
        <div className="text-center p-8 rounded-2xl border border-zinc-800 bg-zinc-900/30">
          <p className="text-zinc-400 text-sm mb-2">Quer implementar no teu negócio?</p>
          <p className="text-white font-semibold mb-4">
            Já fizemos isso em produção. Podemos ajudar-te a montar mais rápido.
          </p>
          <a href="https://wa.me/555193299031" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold transition-all hover:scale-105 hover:shadow-[0_0_30px_rgba(52,211,153,0.3)]">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            Falar com Diego no WhatsApp
          </a>
        </div>
      </div>
    </div>
  )
}
