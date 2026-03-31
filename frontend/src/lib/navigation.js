export const desktopNavSections = [
  {
    id: 'central',
    label: 'Central',
    items: [
      { to: '/', label: 'Home', description: 'KPIs executivos e radar do dia' },
      { to: '/chat', label: 'Chat', description: 'WhatsApp realtime com contexto do cliente' },
      { to: '/briefs', label: 'Briefings', description: 'Resumo diario e contexto acionavel' },
    ],
  },
  {
    id: 'comercial',
    label: 'Comercial',
    items: [
      { to: '/clientes', label: 'Clientes', description: 'Contatos, pipeline e propostas' },
      { to: '/tarefas', label: 'Tarefas', description: 'Execucao e prioridades por projeto' },
      { to: '/projetos', label: 'Projetos', description: 'CRUD e credenciais consolidadas' },
    ],
  },
  {
    id: 'inteligencia',
    label: 'Inteligencia',
    items: [
      { to: '/recordings', label: 'Gravacoes', description: 'Historico de reunioes e transcricoes' },
      { to: '/memory', label: 'Memoria', description: 'Busca semantica e contexto acumulado' },
      { to: '/youtube', label: 'YouTube', description: 'Pipeline editorial e analytics' },
      { to: '/social', label: 'Social', description: 'Publicar em Instagram, TikTok e YouTube' },
      { to: '/blog', label: 'Blog', description: 'Experimentos e artigos por video' },
      { to: '/community', label: 'Comunidade', description: 'Feed, cursos e recursos exclusivos' },
    ],
  },
  {
    id: 'operacao',
    label: 'Operacao',
    items: [
      { to: '/assinaturas', label: 'Assinaturas', description: 'MRR e pagamentos recorrentes de clientes' },
      { to: '/mensagens-agendadas', label: 'Agendamentos', description: 'Mensagens futuras e retries' },
      { to: '/client-portal', label: 'Portal Cliente', description: 'Links de acompanhamento externo' },
      { to: '/settings', label: 'Config', description: 'Ajustes, automacoes e integracoes' },
    ],
  },
]

export const nativeMobileTabs = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/chat', label: 'Chat', icon: 'chat' },
  { to: '/clientes', label: 'Clientes', icon: 'users' },
  { to: '/tarefas', label: 'Tarefas', icon: 'tasks' },
  { to: '/jarbas', label: 'Jarbas', icon: 'bot' },
]

const flatItems = [
  ...desktopNavSections.flatMap((section) => section.items),
  { to: '/gravador', label: 'Gravador', description: 'Captura rapida de audio e reunioes' },
  ...nativeMobileTabs,
]

export function getNavMeta(pathname) {
  const direct = flatItems.find((item) => item.to === pathname)
  if (direct) return direct

  if (pathname.startsWith('/clientes')) return flatItems.find((item) => item.to === '/clientes')
  if (pathname.startsWith('/chat') || pathname.startsWith('/mensagens')) return flatItems.find((item) => item.to === '/chat')
  if (pathname.startsWith('/projetos')) return flatItems.find((item) => item.to === '/projetos')
  if (pathname.startsWith('/youtube')) return flatItems.find((item) => item.to === '/youtube')
  if (pathname.startsWith('/social')) return flatItems.find((item) => item.to === '/social')
  if (pathname.startsWith('/blog')) return flatItems.find((item) => item.to === '/blog')
  if (pathname.startsWith('/community')) return flatItems.find((item) => item.to === '/community')
  if (pathname.startsWith('/tarefas')) return flatItems.find((item) => item.to === '/tarefas')
  if (pathname.startsWith('/gravador')) return flatItems.find((item) => item.to === '/gravador')
  if (pathname.startsWith('/assinaturas')) return flatItems.find((item) => item.to === '/assinaturas')
  if (pathname.startsWith('/jarbas')) return flatItems.find((item) => item.to === '/jarbas')

  return flatItems.find((item) => item.to === '/') || { label: 'Orquestra', description: '' }
}
