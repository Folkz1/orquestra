import { useEffect, useState } from 'react'
import { getYouTubeStrategy, getYouTubeWorkspace, saveYouTubeStrategy } from '../api'

const PROJECT_NAME = 'GuyFolkz'

const inputClass =
  'w-full rounded-xl border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-red-500/60 focus:ring-2 focus:ring-red-500/20'
const textareaClass = `${inputClass} min-h-[110px] resize-y`
const selectClass = inputClass

function unwrap(payload) {
  return payload?.data || payload || null
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function linesToText(lines) {
  return Array.isArray(lines) ? lines.join('\n') : ''
}

function textToLines(value) {
  return String(value || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR')
}

function MetricCard({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
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

function SeriesCard({ series, health, onFieldChange, onListChange }) {
  const episodes = Array.isArray(series.episodes) ? series.episodes : []
  const nextEpisode = health?.next_episode?.title || ''

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950/55 p-5">
      <div className="flex flex-col gap-3 border-b border-zinc-800/80 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-lg font-semibold text-zinc-100">{series.name || 'Nova serie'}</div>
          <div className="mt-1 text-sm text-zinc-500">{series.summary || 'Defina a promessa central da serie.'}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400 lg:min-w-[280px]">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-3 py-2">
            <div className="text-zinc-500">Pipeline</div>
            <div className="mt-1 text-sm font-semibold text-zinc-100">{health?.ideas_in_pipeline || 0} ideias</div>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-3 py-2">
            <div className="text-zinc-500">Planejados</div>
            <div className="mt-1 text-sm font-semibold text-zinc-100">{health?.episodes_planned || episodes.length}</div>
          </div>
          <div className="col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-3 py-2">
            <div className="text-zinc-500">Proximo episodio</div>
            <div className="mt-1 text-sm font-semibold text-zinc-100">{nextEpisode || 'Sem episodio definido'}</div>
          </div>
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

        <Field
          label="Papel no funil"
          value={series.content_role}
          onChange={(value) => onFieldChange('content_role', value)}
          rows={1}
          placeholder="topo/meio/fundo"
        />

        <Field label="Cadencia" value={series.cadence} onChange={(value) => onFieldChange('cadence', value)} rows={1} />
        <Field label="Formato" value={series.format} onChange={(value) => onFieldChange('format', value)} rows={1} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Field label="Objetivo" value={series.objective} onChange={(value) => onFieldChange('objective', value)} placeholder="Resultado estrategico da serie" />
        <Field label="Resumo" value={series.summary} onChange={(value) => onFieldChange('summary', value)} placeholder="Descricao curta e clara para o banco" />
        <Field label="Audience" value={series.audience} onChange={(value) => onFieldChange('audience', value)} placeholder="Para quem essa serie existe" />
        <Field label="Promise" value={series.promise} onChange={(value) => onFieldChange('promise', value)} placeholder="Transformacao prometida por episodio" />
        <Field label="CTA Focus" value={series.cta_focus} onChange={(value) => onFieldChange('cta_focus', value)} placeholder="Qual CTA essa serie puxa" />
        <Field
          label="Regra de thumbnail"
          value={series.thumbnail_rule}
          onChange={(value) => onFieldChange('thumbnail_rule', value)}
          placeholder="Regra visual fixa da serie"
        />
      </div>

      <div className="mt-4">
        <Field
          label="Idea Seeds"
          value={linesToText(series.idea_seeds)}
          onChange={(value) => onListChange('idea_seeds', value)}
          placeholder="Uma ideia por linha"
          rows={6}
        />
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/55 p-4">
        <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Episodios cadastrados</div>
        <div className="mt-3 grid gap-2">
          {episodes.length ? (
            episodes.map((episode) => (
              <div key={`${series.slug}-${episode.code}-${episode.title}`} className="flex items-center justify-between rounded-xl border border-zinc-800 px-3 py-2 text-sm">
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
  const [workspace, setWorkspace] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [strategyResponse, workspaceResponse] = await Promise.all([
        getYouTubeStrategy(PROJECT_NAME),
        getYouTubeWorkspace(PROJECT_NAME),
      ])
      const strategyPayload = unwrap(strategyResponse)
      const workspacePayload = unwrap(workspaceResponse)
      setStrategy(strategyPayload?.strategy || null)
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
    updateStrategy((next) => {
      next[key] = value
    })
  }

  function updateNested(section, key, value) {
    updateStrategy((next) => {
      next[section] = next[section] || {}
      next[section][key] = value
    })
  }

  function updateList(key, value) {
    updateStrategy((next) => {
      next[key] = textToLines(value)
    })
  }

  function updateCalendarItem(index, key, value) {
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

  function updateSeriesField(index, key, value) {
    updateStrategy((next) => {
      next.series = Array.isArray(next.series) ? next.series : []
      next.series[index] = {
        ...(next.series[index] || {}),
        [key]: value,
      }
    })
  }

  function updateSeriesList(index, key, value) {
    updateStrategy((next) => {
      next.series = Array.isArray(next.series) ? next.series : []
      next.series[index] = {
        ...(next.series[index] || {}),
        [key]: textToLines(value),
      }
    })
  }

  function addSeries() {
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

  async function handleSave() {
    if (!strategy || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await saveYouTubeStrategy(strategy, PROJECT_NAME)
      const payload = unwrap(response)
      setStrategy(payload?.strategy || strategy)
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-zinc-800 bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.14),_transparent_42%),linear-gradient(135deg,_rgba(24,24,27,0.95),_rgba(9,9,11,0.96))] p-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-red-300/80">YouTube Strategy DB</div>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-50">Editor da estrategia do canal</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-400">
            Esta tela salva direto em <span className="font-mono text-zinc-200">projects.credentials.youtube_strategy</span>.
            A serie semanal <span className="text-zinc-100">React na Pratica</span> ja entrou no calendario junto com A Virada e RADAR IA.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100" onClick={loadData}>
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Inscritos" value={formatNumber(audit.subscribers)} sub={`Stage ${audit.stage || '0-1k'}`} />
        <MetricCard label="Media views" value={formatNumber(audit.avg_views)} sub={`Mediana ${formatNumber(audit.median_views)}`} />
        <MetricCard label="Videos" value={formatNumber(audit.total_videos)} sub={`Fonte ${audit.source || 'snapshot'}`} />
        <MetricCard
          label="Melhor video"
          value={formatNumber(audit.best_video?.views)}
          sub={audit.best_video?.title || 'Sem referencia ainda'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
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
          <InsightList title="Proximas acoes" items={workspace?.next_actions} />
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
            <Field
              label="Operating Rules"
              value={linesToText(strategy.operating_rules)}
              onChange={(value) => updateList('operating_rules', value)}
              placeholder="Uma regra por linha"
              rows={7}
            />
            <Field
              label="Content Pillars"
              value={linesToText(strategy.content_pillars)}
              onChange={(value) => updateList('content_pillars', value)}
              placeholder="Um pilar por linha"
              rows={7}
            />
            <Field
              label="Title Patterns"
              value={linesToText(strategy.preferred_title_patterns)}
              onChange={(value) => updateList('preferred_title_patterns', value)}
              placeholder="Um padrao por linha"
              rows={7}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Calendario editorial"
          sub="Cadencia semanal e slots oficiais das series."
          action={
            <button className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100" onClick={addCalendarItem}>
              Adicionar slot
            </button>
          }
        >
          <div className="grid gap-4 md:grid-cols-3">
            <NumberField
              label="Longos por semana"
              value={strategy.publishing_rhythm?.weekly_long_videos}
              onChange={(value) => updateNested('publishing_rhythm', 'weekly_long_videos', value)}
            />
            <NumberField
              label="Shorts por semana"
              value={strategy.publishing_rhythm?.weekly_shorts}
              onChange={(value) => updateNested('publishing_rhythm', 'weekly_shorts', value)}
            />
            <NumberField
              label="Lives por semana"
              value={strategy.publishing_rhythm?.weekly_lives}
              onChange={(value) => updateNested('publishing_rhythm', 'weekly_lives', value)}
            />
          </div>

          <div className="mt-5 space-y-3">
            {(strategy.publishing_rhythm?.calendar || []).map((item, index) => (
              <div key={`${item.series || 'slot'}-${index}`} className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/55 p-4 lg:grid-cols-4">
                <Field label="Serie" value={item.series} onChange={(value) => updateCalendarItem(index, 'series', value)} rows={1} />
                <Field label="Slot" value={item.slot} onChange={(value) => updateCalendarItem(index, 'slot', value)} rows={1} />
                <Field label="Formato" value={item.format} onChange={(value) => updateCalendarItem(index, 'format', value)} rows={1} />
                <Field label="Objetivo" value={item.goal} onChange={(value) => updateCalendarItem(index, 'goal', value)} rows={1} />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Series do canal"
        sub="Descricao organizada por serie, com objetivo, promessa, CTA e seeds."
        action={
          <button className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100" onClick={addSeries}>
            Nova serie
          </button>
        }
      >
        <div className="space-y-5">
          {(strategy.series || []).map((series, index) => (
            <SeriesCard
              key={`${series.slug || 'series'}-${index}`}
              series={series}
              health={seriesHealth.find((item) => item.name === series.name)}
              onFieldChange={(key, value) => updateSeriesField(index, key, value)}
              onListChange={(key, value) => updateSeriesList(index, key, value)}
            />
          ))}
        </div>
      </SectionCard>
    </div>
  )
}
