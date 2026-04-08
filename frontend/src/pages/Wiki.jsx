import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { getWikiGraph } from '../api'

const TYPE_COLORS = {
  contacts:   '#22c55e',  // lime   — pessoas
  projects:   '#3b82f6',  // blue   — projetos
  recordings: '#f59e0b',  // amber  — calls/gravacoes
}

const TYPE_LABELS = {
  contacts:   'Contatos',
  projects:   'Projetos',
  recordings: 'Gravações',
}

const TYPE_RADIUS = {
  contacts:   8,
  projects:   10,
  recordings: 6,
}

export default function Wiki() {
  const svgRef        = useRef(null)
  const containerRef  = useRef(null)
  const simRef        = useRef(null)
  const [graph, setGraph]       = useState(null)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [filter, setFilter]     = useState('all')  // all | contacts | projects | recordings

  // Fetch dados do backend
  useEffect(() => {
    getWikiGraph()
      .then(data => {
        if (data.error) { setError(data.error); return }
        setGraph(data)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  // Renderizar grafo D3 ao receber dados ou mudar filtro
  useEffect(() => {
    if (!graph || !svgRef.current || !containerRef.current) return

    const filteredNodes = filter === 'all'
      ? graph.nodes
      : graph.nodes.filter(n => n.type === filter)

    const filteredIds = new Set(filteredNodes.map(n => n.id))
    const filteredEdges = graph.edges.filter(
      e => filteredIds.has(e.source) && filteredIds.has(e.target)
    )

    renderForceGraph(svgRef.current, containerRef.current, filteredNodes, filteredEdges, setSelected)

    return () => {
      if (simRef.current) simRef.current.stop()
    }
  }, [graph, filter])

  // Contar conexões do node selecionado
  const selectedEdges = selected && graph
    ? graph.edges.filter(e => e.source === selected.id || e.target === selected.id)
    : []

  const getConnectedNode = (edge) => {
    if (!graph) return null
    const otherId = edge.source === selected.id ? edge.target : edge.source
    return graph.nodes.find(n => n.id === otherId)
  }

  const stats = graph ? {
    contacts:   graph.nodes.filter(n => n.type === 'contacts').length,
    projects:   graph.nodes.filter(n => n.type === 'projects').length,
    recordings: graph.nodes.filter(n => n.type === 'recordings').length,
    edges:      graph.edges.length,
  } : null

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-semibold text-lg">Wiki — Grafo de Conhecimento</h1>
          {stats && (
            <p className="text-white/40 text-xs mt-0.5">
              {stats.contacts} contatos · {stats.projects} projetos · {stats.recordings} gravações · {stats.edges} conexões
            </p>
          )}
        </div>

        {/* Filtros */}
        <div className="flex gap-1.5">
          {['all', 'contacts', 'projects', 'recordings'].map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setSelected(null) }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-lime-500/20 text-lime-400 border border-lime-500/30'
                  : 'text-white/40 border border-white/10 hover:text-white/60'
              }`}
            >
              {f === 'all' ? 'Todos' : TYPE_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Área principal */}
      <div className="flex flex-1 gap-3 min-h-0">
        {/* Grafo */}
        <div
          ref={containerRef}
          className="relative flex-1 rounded-xl border border-white/8 bg-black/30 overflow-hidden"
        >
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-white/40 text-sm">Carregando grafo...</div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-amber-400 text-sm">{error}</p>
              <p className="text-white/30 text-xs">Execute primeiro: POST /api/wiki/rebuild</p>
            </div>
          )}
          <svg ref={svgRef} className="w-full h-full" />

          {/* Legenda */}
          {!loading && !error && (
            <div className="absolute bottom-4 left-4 flex gap-3">
              {Object.entries(TYPE_COLORS).map(([type, color]) => (
                <span key={type} className="flex items-center gap-1.5 text-xs text-white/50">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                  {TYPE_LABELS[type]}
                </span>
              ))}
            </div>
          )}

          {/* Instrução de uso */}
          {!loading && !error && !selected && (
            <div className="absolute top-3 right-3 text-xs text-white/20">
              Scroll para zoom · Drag para mover · Click para detalhes
            </div>
          )}
        </div>

        {/* Painel lateral — node selecionado */}
        {selected && (
          <div className="w-72 flex flex-col gap-3 rounded-xl border border-white/8 bg-black/30 p-4 overflow-y-auto">
            {/* Header do node */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span
                  className="inline-block px-2 py-0.5 rounded text-xs font-medium mb-2"
                  style={{
                    background: TYPE_COLORS[selected.type] + '20',
                    color: TYPE_COLORS[selected.type],
                    border: `1px solid ${TYPE_COLORS[selected.type]}30`,
                  }}
                >
                  {TYPE_LABELS[selected.type] || selected.type}
                </span>
                <h2 className="text-white font-medium text-sm leading-snug">{selected.label}</h2>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-white/30 hover:text-white/60 text-lg leading-none flex-shrink-0 mt-1"
              >
                ×
              </button>
            </div>

            {/* Stat de conexões */}
            <div className="rounded-lg bg-white/4 px-3 py-2 text-xs text-white/50">
              <span className="text-white/80 font-medium text-base">{selectedEdges.length}</span>
              {' '}conexões diretas
            </div>

            {/* Lista de conexões */}
            {selectedEdges.length > 0 && (
              <div>
                <p className="text-xs text-white/30 uppercase tracking-wider mb-2">Conectado a</p>
                <div className="space-y-1">
                  {selectedEdges.map((edge, i) => {
                    const other = getConnectedNode(edge)
                    if (!other) return null
                    return (
                      <button
                        key={i}
                        onClick={() => setSelected(other)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 text-left transition-colors group"
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: TYPE_COLORS[other.type] }}
                        />
                        <span className="text-xs text-white/60 group-hover:text-white/90 truncate">
                          {other.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── D3 Force Graph ───────────────────────────────────────────────────────────
function renderForceGraph(svgEl, containerEl, nodes, edges, onSelect) {
  // Limpar renderização anterior
  d3.select(svgEl).selectAll('*').remove()

  const width  = containerEl.clientWidth  || 800
  const height = containerEl.clientHeight || 600

  const svg = d3.select(svgEl)
    .attr('width', width)
    .attr('height', height)

  // Grupo principal com zoom
  const g = svg.append('g')

  svg.call(
    d3.zoom()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => g.attr('transform', event.transform))
  )

  // Copiar nodes/edges para D3 (simulation muta os objetos)
  const simNodes = nodes.map(n => ({ ...n }))
  const nodeById = new Map(simNodes.map(n => [n.id, n]))

  // Filtrar edges cujos nodes existem
  const simEdges = edges
    .filter(e => nodeById.has(e.source) && nodeById.has(e.target))
    .map(e => ({ source: e.source, target: e.target }))

  // Simulation
  const simulation = d3.forceSimulation(simNodes)
    .force('link', d3.forceLink(simEdges)
      .id(d => d.id)
      .distance(60)
      .strength(0.4)
    )
    .force('charge', d3.forceManyBody().strength(-120))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => (TYPE_RADIUS[d.type] || 7) + 4))

  // Edges (linhas)
  const link = g.append('g')
    .selectAll('line')
    .data(simEdges)
    .join('line')
    .attr('stroke', 'rgba(255,255,255,0.08)')
    .attr('stroke-width', 1)

  // Nodes (círculos)
  const node = g.append('g')
    .selectAll('circle')
    .data(simNodes)
    .join('circle')
    .attr('r', d => TYPE_RADIUS[d.type] || 7)
    .attr('fill', d => TYPE_COLORS[d.type] || '#888')
    .attr('fill-opacity', 0.85)
    .attr('stroke', d => TYPE_COLORS[d.type] || '#888')
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.4)
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      event.stopPropagation()
      onSelect(d)
      // Highlight: escurecer os outros
      node.attr('fill-opacity', n => n.id === d.id ? 1 : 0.2)
      link.attr('stroke', e =>
        e.source.id === d.id || e.target.id === d.id
          ? 'rgba(255,255,255,0.35)'
          : 'rgba(255,255,255,0.04)'
      )
    })
    .call(
      d3.drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart()
          d.fx = d.x; d.fy = d.y
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0)
          d.fx = null; d.fy = null
        })
    )

  // Labels (só para projetos e nodes com poucas conexões)
  const label = g.append('g')
    .selectAll('text')
    .data(simNodes.filter(n => n.type === 'projects'))
    .join('text')
    .text(d => d.label.length > 20 ? d.label.slice(0, 18) + '…' : d.label)
    .attr('font-size', 9)
    .attr('fill', 'rgba(255,255,255,0.55)')
    .attr('text-anchor', 'middle')
    .attr('dy', d => -(TYPE_RADIUS[d.type] || 7) - 4)
    .style('pointer-events', 'none')

  // Deselect ao clicar no fundo
  svg.on('click', () => {
    onSelect(null)
    node.attr('fill-opacity', 0.85)
    link.attr('stroke', 'rgba(255,255,255,0.08)')
  })

  // Tick
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y)

    node
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)

    label
      .attr('x', d => d.x)
      .attr('y', d => d.y)
  })
}
