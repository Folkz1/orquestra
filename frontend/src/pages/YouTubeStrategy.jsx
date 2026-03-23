import { useEffect, useState } from 'react'
import { getYouTubeStrategy, getYouTubeWorkspace, saveYouTubeStrategy } from '../api'

const PROJECT_NAME = 'GuyFolkz'

const inputClass =
  'w-full rounded-xl border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-red-500/60 focus:ring-2 focus:ring-red-500/20'
const textareaClass = `${inputClass} min-h-[110px] resize-y`
const selectClass = inputClass
const ghostButtonClass =
  'rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40'

function unwrap(payload) {
  return payload?.data || payload || null
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function cleanText(value) {
  return String(value || '').trim()
}

function uniqueLines(values) {
  const lines = Array.isArray(values) ? values : String(values || '').split('\n')
  const seen = new Set()
  const output = []
  for (const raw of lines) {
    const line = cleanText(raw)
    const key = line.toLowerCase()
    if (!line || seen.has(key)) continue
    seen.add(key)
    output.push(line)
  }
  return output
}

function linesToText(lines) {
  return Array.isArray(lines) ? lines.join('\n') : ''
}

function textToLines(value) {
  return uniqueLines(String(value || '').split('\n'))
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR')
}

function slugify(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function moveItem(items, index, direction) {
  const next = [...items]
  const target = index + direction
  if (target < 0 || target >= next.length) return next
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

function normalizeStrategyData(strategy) {
  if (!strategy) return strategy

  const next = cloneValue(strategy)

  for (const key of ['goal', 'positioning', 'north_star', 'big_idea', 'brand_narrative', 'editorial_formula']) {
    next[key] = cleanText(next[key])
  }

  next.content_pillars = uniqueLines(next.content_pillars)
  next.preferred_title_patterns = uniqueLines(next.preferred_title_patterns)
  next.operating_rules = uniqueLines(next.operating_rules)
  next.source_materials = uniqueLines(next.source_materials)

  next.style = next.style || {}
  for (const key of ['tone', 'visual', 'editing', 'pacing']) {
    next.style[key] = cleanText(next.style[key])
  }

  next.cta_templates = next.cta_templates || {}
  for (const key of Object.keys(next.cta_templates)) {
    next.cta_templates[key] = cleanText(next.cta_templates[key])
  }

  next.publishing_rhythm = next.publishing_rhythm || {}
  next.publishing_rhythm.weekly_long_videos = Number(next.publishing_rhythm.weekly_long_videos || 0)
  next.publishing_rhythm.weekly_shorts = Number(next.publishing_rhythm.weekly_shorts || 0)
  next.publishing_rhythm.weekly_lives = Number(next.publishing_rhythm.weekly_lives || 0)
  next.publishing_rhythm.calendar = (Array.isArray(next.publishing_rhythm.calendar) ? next.publishing_rhythm.calendar : [])
    .map((item) => ({
      series: cleanText(item?.series),
      slot: cleanText(item?.slot),
      format: cleanText(item?.format),
      goal: cleanText(item?.goal),
    }))
    .filter((item) => item.series || item.slot || item.format || item.goal)

  next.series = (Array.isArray(next.series) ? next.series : [])
    .map((series) => {
      const normalized = { ...series }
      normalized.name = cleanText(normalized.name)
      normalized.slug = cleanText(normalized.slug) || slugify(normalized.name)
      normalized.status = cleanText(normalized.status) || 'ativa'
      normalized.objective = cleanText(normalized.objective)
      normalized.content_role = cleanText(normalized.content_role)
      normalized.cadence = cleanText(normalized.cadence)
      normalized.format = cleanText(normalized.format)
      normalized.thumbnail_rule = cleanText(normalized.thumbnail_rule)
      normalized.summary = cleanText(normalized.summary)
      normalized.audience = cleanText(normalized.audience)
      normalized.promise = cleanText(normalized.promise)
      normalized.cta_focus = cleanText(normalized.cta_focus)
      normalized.idea_seeds = uniqueLines(normalized.idea_seeds)
      normalized.episodes = (Array.isArray(normalized.episodes) ? normalized.episodes : [])
        .map((episode) => ({
          ...episode,
          code: cleanText(episode?.code),
          title: cleanText(episode?.title),
          status: cleanText(episode?.status),
        }))
        .filter((episode) => episode.code || episode.title)
      return normalized
    })
    .filter((series) => series.name || series.slug)

  return next
}

function buildLocalHygiene(strategy, workspace) {
  const activeSeries = (strategy?.series || []).filter((series) => series.status !== 'arquivada')
  const calendar = strategy?.publishing_rhythm?.calendar || []
  const scheduledSeries = new Set(calendar.map((item) => cleanText(item.series).toLowerCase()).filter(Boolean))

  const missingPromise = activeSeries.filter((series) => !cleanText(series.promise))
  const missingCta = activeSeries.filter((series) => !cleanText(series.cta_focus))
  const missingAudience = activeSeries.filter((series) => !cleanText(series.audience))
  const unscheduled = activeSeries.filter((series) => !scheduledSeries.has(cleanText(series.name).toLowerCase()))

  const issues = []
  if (missingPromise.length) issues.push(`Series sem promise: ${missingPromise.map((series) => series.name).join(', ')}.`)
  if (missingCta.length) issues.push(`Series sem CTA focus: ${missingCta.map((series) => series.name).join(', ')}.`)
  if (missingAudience.length) issues.push(`Series sem audience: ${missingAudience.map((series) => series.name).join(', ')}.`)
  if (unscheduled.length) issues.push(`Series ativas fora do calendario: ${unscheduled.map((series) => series.name).join(', ')}.`)

  const thumbReady = workspace?.pipeline?.thumb_ready || 0
  const readyToRecord = workspace?.pipeline?.ready_to_record || 0
  if (!thumbReady) issues.push('Nao ha thumbnail pronta no pipeline agora.')
  if (!readyToRecord) issues.push('Nao ha video pronto para gravar agora.')

  return {
    activeSeriesCount: activeSeries.length,
    scheduledSlots: calendar.length,
    weeklyLongVideos: strategy?.publishing_rhythm?.weekly_long_videos || 0,
    thumbReady,
    readyToRecord,
    issues,
  }
}

function StatusPill({ dirty }) {
  return (
    <div
      className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${
        dirty
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
      }`}
    >
      {dirty ? 'Alteracoes nao salvas' : 'Sincronizado'}
    </div>
  )
}

function MetricCard({ label, value, sub, tone = 'zinc' }) {
  const toneClass =
    tone === 'red'
      ? 'border-red-500/20 bg-red-500/8'
      : tone === 'green'
      ? 'border-green-500/20 bg-green-500/8'
      : tone === 'amber'
      ? 'border-amber-500/20 bg-amber-500/8'
      : 'border-zinc-800 bg-zinc-900/70'

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-zinc-100">{value}</div>
      {sub ? <div className="mt-1 text-xs text-zinc-500">{sub}</div> : null}
    </div>
  )
}

function SectionCard({ title, sub, children, action }) {
  return (
    <div className="card border border-zinc-800/80 bg-zinc-900/55">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-300">{title}</h2>
          {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, rows = 4 }) {
  const isTextarea = rows > 1
  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      {isTextarea ? (
        <textarea
          className={textareaClass}
          rows={rows}
          value={value || ''}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className={inputClass}
          value={value || ''}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  )
}

function NumberField({ label, value, onChange }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        className={inputClass}
        type="number"
        min="0"
        value={value ?? 0}
        onChange={(event) => onChange(Number(event.target.value || 0))}
      />
    </label>
  )
}

function InsightList({ title, items, tone = 'zinc' }) {
  const toneMap = {
    zinc: 'border-zinc-800 bg-zinc-900/55 text-zinc-300',
    green: 'border-green-500/20 bg-green-500/8 text-green-300',
    amber: 'border-amber-500/20 bg-amber-500/8 text-amber-200',
    red: 'border-red-500/20 bg-red-500/8 text-red-200',
  }

  return (
    <div className={`rounded-2xl border p-4 ${toneMap[tone] || toneMap.zinc}`}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{title}</div>
      <div className="mt-3 space-y-2">
        {(items || []).length ? (
          items.map((item, index) => (
            <div key={`${title}-${index}`} className="rounded-xl border border-white/5 bg-black/10 px-3 py-2 text-sm">
              {item}
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-2 text-sm text-zinc-500">
            Sem dados ainda.
          </div>
        )}
      </div>
    </div>
  )
}

function CalendarItemCard({ item, index, total, onChange, onMove, onRemove }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/55 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Slot #{index + 1}</div>
        <div className="flex items-center gap-2">
          <button className={ghostButtonClass} onClick={() => onMove(-1)} disabled={index === 0}>
            Subir
          </button>
          <button className={ghostButtonClass} onClick={() => onMove(1)} disabled={index === total - 1}>
            Descer
          </button>
          <button className={`${ghostButtonClass} border-red-500/20 text-red-300 hover:border-red-400/50 hover:text-red-200`} onClick={onRemove}>
            Remover
          </button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-4">
        <Field label="Serie" value={item.series} onChange={(value) => onChange('series', value)} rows={1} />
        <Field label="Slot" value={item.slot} onChange={(value) => onChange('slot', value)} rows={1} />
        <Field label="Formato" value={item.format} onChange={(value) => onChange('format', value)} rows={1} />
        <Field label="Objetivo" value={item.goal} onChange={(value) => onChange('goal', value)} rows={1} />
      </div>
    </div>
  )
}

function SeriesCard({
  series,
  health,
  index,
  total,
  onFieldChange,
  onListChange,
  onMove,
  onToggleArchive,
}) {
  const episodes = Array.isArray(series.episodes) ? series.episodes : []
  const nextEpisode = health?.next_episode?.title || ''
  const archived = series.status === 'arquivada'

  return (
    <div className={`rounded-3xl border p-5 ${archived ? 'border-zinc-800/70 bg-zinc-950/35 opacity-80' : 'border-zinc-800 bg-zinc-950/55'}`}>
      <div className="flex flex-col gap-3 border-b border-zinc-800/80 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-lg font-semibold text-zinc-100">{series.name || 'Nova serie'}</div>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] ${archived ? 'border-zinc-700 text-zinc-500' : 'border-emerald-500/25 text-emerald-300'}`}>
              {series.status || 'ativa'}
            </span>
          </div>
          <div className="mt-1 text-sm text-zinc-500">{series.summary || 'Defina a promessa central da serie.'}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={ghostButtonClass} onClick={() => onMove(-1)} disabled={index === 0}>
            Subir
          </button>
          <button className={ghostButtonClass} onClick={() => onMove(1)} disabled={index === total - 1}>
            Descer
          </button>
          <button className={archived ? ghostButtonClass : `${ghostButtonClass} border-amber-500/20 text-amber-200 hover:border-amber-400/50 hover:text-amber-100`} onClick={onToggleArchive}>
            {archived ? 'Reativar' : 'Arquivar'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-zinc-400 lg:grid-cols-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-3 py-2">
          <div className="text-zinc-500">Pipeline</div>
          <div className="mt-1 text-sm font-semibold text-zinc-100">{health?.ideas_in_pipeline || 0} ideias</div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-3 py-2">
          <div className="text-zinc-500">Planejados</div>
          <div className="mt-1 text-sm font-semibold text-zinc-100">{health?.episodes_planned || episodes.length}</div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-3 py-2">
          <div className="text-zinc-500">Proximo episodio</div>
          <div className="mt-1 text-sm font-semibold text-zinc-100">{nextEpisode || 'Sem episodio definido'}</div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Field label="Nome" value={series.name} onChange={(value) => onFieldChange('name', value)} rows={1} />
        <Field label="Slug" value={series.slug} onChange={(value) => onFieldChange('slug', value)} rows={1} />

        <label className="block">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Status</div>
          <select className={selectClass} value={series.status || 'ativa'} onChange={(event) => onFieldChange('status', event.target.value)}>
            <option value="ativa">Ativa</option>
            <option value="pausada">Pausada</option>
            <option value="arquivada">Arquivada</option>
          </select>
        </label>

        <Field label="Papel no funil" value={series.content_role} onChange={(value) => onFieldChange('content_role', value)} rows={1} placeholder="topo/meio/fundo" />
        <Field label="Cadencia" value={series.cadence} onChange={(value) => onFieldChange('cadence', value)} rows={1} />
        <Field label="Formato" value={series.format} onChange={(value) => onFieldChange('format', value)} rows={1} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Field label="Objetivo" value={series.objective} onChange={(value) => onFieldChange('objective', value)} placeholder="Resultado estrategico da serie" />
        <Field label="Resumo" value={series.summary} onChange={(value) => onFieldChange('summary', value)} placeholder="Descricao curta e clara para o banco" />
        <Field label="Audience" value={series.audience} onChange={(value) => onFieldChange('audience', value)} placeholder="Para quem essa serie existe" />
        <Field label="Promise" value={series.promise} onChange={(value) => onFieldChange('promise', value)} placeholder="Transformacao prometida por episodio" />
        <Field label="CTA Focus" value={series.cta_focus} onChange={(value) => onFieldChange('cta_focus', value)} placeholder="Qual CTA essa serie puxa" />
        <Field label="Regra de thumbnail" value={series.thumbnail_rule} onChange={(value) => onFieldChange('thumbnail_rule', value)} placeholder="Regra visual fixa da serie" />
      </div>

      <div className="mt-4">
        <Field label="Idea Seeds" value={linesToText(series.idea_seeds)} onChange={(value) => onListChange('idea_seeds', value)} placeholder="Uma ideia por linha" rows={6} />
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/55 p-4">
        <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Episodios cadastrados</div>
        <div className="mt-3 grid gap-2">
          {episodes.length ? (
            episodes.map((episode) => (
              <div key={`${series.slug}-${episode.code}-${episode.title}`} className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 px-3 py-2 text-sm">
                <span className="text-zinc-200">{episode.title}</span>
                <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  {episode.status}
                </span>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-2 text-sm text-zinc-500">
              Nenhum episodio cadastrado.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function YouTubeStrategy() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [strategy, setStrategy] = useState(null)
  const [originalStrategy, setOriginalStrategy] = useState(null)
  const [workspace, setWorkspace] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  const isDirty = strategy && originalStrategy ? JSON.stringify(strategy) !== JSON.stringify(originalStrategy) : false
  const hygiene = buildLocalHygiene(strategy, workspace)

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  async function loadData() {
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const [strategyResponse, workspaceResponse] = await Promise.all([
        getYouTubeStrategy(PROJECT_NAME),
        getYouTubeWorkspace(PROJECT_NAME),
      ])
      const strategyPayload = unwrap(strategyResponse)
      const workspacePayload = unwrap(workspaceResponse)
      const normalized = normalizeStrategyData(strategyPayload?.strategy || null)
      setStrategy(normalized)
      setOriginalStrategy(cloneValue(normalized))
      setWorkspace(workspacePayload || null)
    } catch (err) {
      setError(err.message || 'Falha ao carregar a estrategia.')
    } finally {
      setLoading(false)
    }
  }

  function updateStrategy(mutator) {
    setStrategy((current) => {
      if (!current) return current
      const next = cloneValue(current)
      mutator(next)
      return next
    })
  }

  function updateTopLevel(key, value) {
    setNotice('')
    updateStrategy((next) => {
      next[key] = value
    })
  }

  function updateNested(section, key, value) {
    setNotice('')
    updateStrategy((next) => {
      next[section] = next[section] || {}
      next[section][key] = value
    })
  }

  function updateList(key, value) {
    setNotice('')
    updateStrategy((next) => {
      next[key] = textToLines(value)
    })
  }

  function updateCalendarItem(index, key, value) {
    setNotice('')
    updateStrategy((next) => {
      next.publishing_rhythm = next.publishing_rhythm || {}
      next.publishing_rhythm.calendar = Array.isArray(next.publishing_rhythm.calendar) ? next.publishing_rhythm.calendar : []
      next.publishing_rhythm.calendar[index] = {
        ...(next.publishing_rhythm.calendar[index] || {}),
        [key]: value,
      }
    })
  }

  function addCalendarItem() {
    setNotice('')
    updateStrategy((next) => {
      next.publishing_rhythm = next.publishing_rhythm || {}
      next.publishing_rhythm.calendar = Array.isArray(next.publishing_rhythm.calendar) ? next.publishing_rhythm.calendar : []
      next.publishing_rhythm.calendar.push({
        series: '',
        slot: '',
        format: 'longo',
        goal: '',
      })
    })
  }

  function moveCalendarItem(index, direction) {
    setNotice('')
    updateStrategy((next) => {
      next.publishing_rhythm = next.publishing_rhythm || {}
      next.publishing_rhythm.calendar = moveItem(next.publishing_rhythm.calendar || [], index, direction)
    })
  }

  function removeCalendarItem(index) {
    setNotice('')
    updateStrategy((next) => {
      next.publishing_rhythm = next.publishing_rhythm || {}
      next.publishing_rhythm.calendar = (next.publishing_rhythm.calendar || []).filter((_, itemIndex) => itemIndex !== index)
    })
  }

  function updateSeriesField(index, key, value) {
    setNotice('')
    updateStrategy((next) => {
      next.series = Array.isArray(next.series) ? next.series : []
      const current = next.series[index] || {}
      next.series[index] = {
        ...current,
        [key]: value,
      }
      if (key === 'name' && (!cleanText(current.slug) || cleanText(current.slug) === slugify(current.name))) {
        next.series[index].slug = slugify(value)
      }
    })
  }

  function updateSeriesList(index, key, value) {
    setNotice('')
    updateStrategy((next) => {
      next.series = Array.isArray(next.series) ? next.series : []
      next.series[index] = {
        ...(next.series[index] || {}),
        [key]: textToLines(value),
      }
    })
  }

  function addSeries() {
    setNotice('')
    updateStrategy((next) => {
      next.series = Array.isArray(next.series) ? next.series : []
      next.series.push({
        slug: `nova-serie-${next.series.length + 1}`,
        name: 'Nova serie',
        status: 'ativa',
        objective: '',
        content_role: 'topo/meio',
        cadence: '1 episodio por semana',
        format: 'video longo 8-15min',
        thumbnail_rule: '',
        summary: '',
        audience: '',
        promise: '',
        cta_focus: '',
        idea_seeds: [],
        episodes: [],
      })
    })
  }

  function moveSeries(index, direction) {
    setNotice('')
    updateStrategy((next) => {
      next.series = moveItem(next.series || [], index, direction)
    })
  }

  function toggleSeriesArchive(index) {
    setNotice('')
    updateStrategy((next) => {
      next.series = Array.isArray(next.series) ? next.series : []
      const current = next.series[index] || {}
      next.series[index] = {
        ...current,
        status: current.status === 'arquivada' ? 'ativa' : 'arquivada',
      }
    })
  }

  function handleNormalize() {
    if (!strategy) return
    setNotice('')
    setStrategy((current) => normalizeStrategyData(current))
    setNotice('Texto e listas normalizados localmente. Salve para persistir.')
  }

  function handleReset() {
    if (!originalStrategy) return
    setStrategy(cloneValue(originalStrategy))
    setNotice('Alteracoes descartadas.')
    setError('')
  }

  async function handleSave() {
    if (!strategy || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const normalized = normalizeStrategyData(strategy)
      const response = await saveYouTubeStrategy(normalized, PROJECT_NAME)
      const payload = unwrap(response)
      const savedStrategy = normalizeStrategyData(payload?.strategy || normalized)
      setStrategy(savedStrategy)
      setOriginalStrategy(cloneValue(savedStrategy))
      const workspaceResponse = await getYouTubeWorkspace(PROJECT_NAME)
      setWorkspace(unwrap(workspaceResponse) || null)
      setNotice('Estrategia salva no banco com sucesso.')
    } catch (err) {
      setError(err.message || 'Falha ao salvar a estrategia.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-zinc-500">Carregando estrategia do YouTube...</div>
  }

  if (!strategy) {
    return <div className="text-sm text-red-400">{error || 'Nao foi possivel carregar a estrategia.'}</div>
  }

  const audit = workspace?.channel_audit || {}
  const seriesHealth = Array.isArray(workspace?.series_health) ? workspace.series_health : []
  const hygieneIssues = workspace?.strategy_hygiene?.issues?.length ? workspace.strategy_hygiene.issues : hygiene.issues

  return (
    <div className="space-y-6 pb-28">
      <div className="flex flex-col gap-4 rounded-3xl border border-zinc-800 bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.14),_transparent_42%),linear-gradient(135deg,_rgba(24,24,27,0.95),_rgba(9,9,11,0.96))] p-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-red-300/80">YouTube Strategy DB</div>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-50">Editor da estrategia do canal</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-400">
            Esta tela salva direto em <span className="font-mono text-zinc-200">projects.credentials.youtube_strategy</span>.
            Agora ela tambem sinaliza higiene editorial, estado sujo e lacunas reais da operacao.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill dirty={isDirty} />
          <button className={ghostButtonClass} onClick={handleNormalize}>
            Normalizar
          </button>
          <button className={ghostButtonClass} onClick={handleReset} disabled={!isDirty}>
            Descartar
          </button>
          <button className={ghostButtonClass} onClick={loadData}>
            Recarregar
          </button>
          <button
            className="rounded-full bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Salvando...' : 'Salvar estrategia'}
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
      {notice ? <div className="rounded-2xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-300">{notice}</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Inscritos" value={formatNumber(audit.subscribers)} sub={`Stage ${audit.stage || '0-1k'}`} />
        <MetricCard label="Media views" value={formatNumber(audit.avg_views)} sub={`Mediana ${formatNumber(audit.median_views)}`} />
        <MetricCard label="Series ativas" value={String(hygiene.activeSeriesCount)} sub={`${hygiene.scheduledSlots} slots no calendario`} tone="green" />
        <MetricCard label="Thumb pronta" value={String(hygiene.thumbReady)} sub="Pipeline pronto para edicao" tone="amber" />
        <MetricCard label="Pronto gravar" value={String(hygiene.readyToRecord)} sub="Pautas prontas para camera" tone="green" />
        <MetricCard label="Melhor video" value={formatNumber(audit.best_video?.views)} sub={audit.best_video?.title || 'Sem referencia ainda'} tone="red" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="Motor do canal" sub="Descricao central do canal e da estrategia.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Goal" value={strategy.goal} onChange={(value) => updateTopLevel('goal', value)} rows={1} />
            <Field label="North Star" value={strategy.north_star} onChange={(value) => updateTopLevel('north_star', value)} rows={1} />
            <Field label="Positioning" value={strategy.positioning} onChange={(value) => updateTopLevel('positioning', value)} />
            <Field label="Editorial Formula" value={strategy.editorial_formula} onChange={(value) => updateTopLevel('editorial_formula', value)} />
            <Field label="Big Idea" value={strategy.big_idea} onChange={(value) => updateTopLevel('big_idea', value)} />
            <Field label="Brand Narrative" value={strategy.brand_narrative} onChange={(value) => updateTopLevel('brand_narrative', value)} />
          </div>
        </SectionCard>

        <div className="grid gap-4">
          <InsightList title="Padroes fortes" items={audit.top_patterns} tone="green" />
          <InsightList title="Gaps e oportunidades" items={audit.opportunity_gaps} tone="amber" />
          <InsightList title="Higiene editorial" items={hygieneIssues} tone={hygieneIssues?.length ? 'red' : 'green'} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard title="Playbook operacional" sub="Campos claros para manter o banco organizado.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Tone" value={strategy.style?.tone} onChange={(value) => updateNested('style', 'tone', value)} />
            <Field label="Visual" value={strategy.style?.visual} onChange={(value) => updateNested('style', 'visual', value)} />
            <Field label="Editing" value={strategy.style?.editing} onChange={(value) => updateNested('style', 'editing', value)} />
            <Field label="Pacing" value={strategy.style?.pacing} onChange={(value) => updateNested('style', 'pacing', value)} />
            <Field label="CTA Cold" value={strategy.cta_templates?.cold} onChange={(value) => updateNested('cta_templates', 'cold', value)} />
            <Field label="CTA Warm" value={strategy.cta_templates?.warm} onChange={(value) => updateNested('cta_templates', 'warm', value)} />
            <Field label="CTA Hot" value={strategy.cta_templates?.hot} onChange={(value) => updateNested('cta_templates', 'hot', value)} />
            <Field label="Operating Rules" value={linesToText(strategy.operating_rules)} onChange={(value) => updateList('operating_rules', value)} placeholder="Uma regra por linha" rows={7} />
            <Field label="Content Pillars" value={linesToText(strategy.content_pillars)} onChange={(value) => updateList('content_pillars', value)} placeholder="Um pilar por linha" rows={7} />
            <Field label="Title Patterns" value={linesToText(strategy.preferred_title_patterns)} onChange={(value) => updateList('preferred_title_patterns', value)} placeholder="Um padrao por linha" rows={7} />
            <Field label="Source Materials" value={linesToText(strategy.source_materials)} onChange={(value) => updateList('source_materials', value)} placeholder="Um arquivo ou referencia por linha" rows={7} />
          </div>
        </SectionCard>

        <SectionCard
          title="Cadencia e proximas acoes"
          sub="Leitura executiva da estrategia atual e do pipeline."
          action={
            <button className={ghostButtonClass} onClick={addCalendarItem}>
              Adicionar slot
            </button>
          }
        >
          <div className="grid gap-4 md:grid-cols-3">
            <NumberField label="Longos por semana" value={strategy.publishing_rhythm?.weekly_long_videos} onChange={(value) => updateNested('publishing_rhythm', 'weekly_long_videos', value)} />
            <NumberField label="Shorts por semana" value={strategy.publishing_rhythm?.weekly_shorts} onChange={(value) => updateNested('publishing_rhythm', 'weekly_shorts', value)} />
            <NumberField label="Lives por semana" value={strategy.publishing_rhythm?.weekly_lives} onChange={(value) => updateNested('publishing_rhythm', 'weekly_lives', value)} />
          </div>

          <div className="mt-5 grid gap-4">
            {(strategy.publishing_rhythm?.calendar || []).map((item, index, items) => (
              <CalendarItemCard
                key={`${item.series || 'slot'}-${index}`}
                item={item}
                index={index}
                total={items.length}
                onChange={(key, value) => updateCalendarItem(index, key, value)}
                onMove={(direction) => moveCalendarItem(index, direction)}
                onRemove={() => removeCalendarItem(index)}
              />
            ))}
          </div>

          <div className="mt-5">
            <InsightList title="Proximas acoes" items={workspace?.next_actions} />
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Series do canal"
        sub="Descricao organizada por serie, com objetivo, promessa, CTA e seeds."
        action={
          <button className={ghostButtonClass} onClick={addSeries}>
            Nova serie
          </button>
        }
      >
        <div className="space-y-5">
          {(strategy.series || []).map((series, index, items) => (
            <SeriesCard
              key={`${series.slug || 'series'}-${index}`}
              series={series}
              health={seriesHealth.find((item) => item.name === series.name)}
              index={index}
              total={items.length}
              onFieldChange={(key, value) => updateSeriesField(index, key, value)}
              onListChange={(key, value) => updateSeriesList(index, key, value)}
              onMove={(direction) => moveSeries(index, direction)}
              onToggleArchive={() => toggleSeriesArchive(index)}
            />
          ))}
        </div>
      </SectionCard>

      {isDirty ? (
        <div className="fixed bottom-4 right-4 left-4 z-20 rounded-3xl border border-amber-500/20 bg-zinc-950/95 p-4 shadow-2xl shadow-black/30 backdrop-blur md:left-auto md:w-[560px]">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-zinc-100">Ha alteracoes locais na estrategia.</div>
              <div className="mt-1 text-xs text-zinc-500">Salve para persistir no banco e refletir no workspace editorial.</div>
            </div>
            <div className="flex items-center gap-2">
              <button className={ghostButtonClass} onClick={handleReset}>
                Descartar
              </button>
              <button
                className="rounded-full bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Salvando...' : 'Salvar agora'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
