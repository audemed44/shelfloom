import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import type {
  OpenRouterModel,
  RecommendationSettings as Settings,
  RecommendationSettingsResponse,
} from '../../types/api'

const input =
  'w-full border border-white/25 bg-black px-3 py-2 text-sm text-white focus:border-primary focus:outline-none'

function errorText(err: unknown, fallback: string) {
  return (err as { data?: { detail?: string } }).data?.detail ?? fallback
}

function price(n: number) {
  return `$${n < 1 ? n.toFixed(2).replace(/0$/, '') : n.toFixed(2)}`
}

function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-start gap-3 text-left disabled:opacity-50"
    >
      <span
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-white/10'
        }`}
      >
        <span
          className={`mt-[3px] block size-3.5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </span>
      <span>
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="mt-0.5 block text-xs text-white/50">{hint}</span>
      </span>
    </button>
  )
}

/** Settings: the model behind recommendations and what it may use. */
export default function RecommendationSettings() {
  const [data, setData] = useState<RecommendationSettingsResponse | null>(null)
  const [models, setModels] = useState<OpenRouterModel[] | null>(null)
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api
      .get<RecommendationSettingsResponse>('/api/recommendations/settings')
      .then((d) => {
        if (!d?.settings) return
        setData(d)
        setModel(d.settings.model)
      })
      .catch(() => setError('Could not load the recommendation settings'))
    api
      .get<{ models: OpenRouterModel[] }>('/api/recommendations/models')
      .then((d) => setModels(Array.isArray(d?.models) ? d.models : []))
      .catch(() => setModels([]))
  }, [])

  const save = async (patch: Partial<Settings>) => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const d = await api.put<RecommendationSettingsResponse>(
        '/api/recommendations/settings',
        patch
      )
      if (d) {
        setData(d)
        setModel(d.settings.model)
        setSaved(true)
      }
    } catch (err) {
      setError(errorText(err, 'Could not save'))
    } finally {
      setBusy(false)
    }
  }

  const chosen = useMemo(
    () => models?.find((m) => m.id === model.trim()) ?? null,
    [models, model]
  )

  if (!data) {
    return error ? (
      <p className="text-sm text-red-400">{error}</p>
    ) : (
      <Loader2 size={14} className="animate-spin text-white/40" />
    )
  }
  const s = data.settings
  const modelChanged = model.trim() !== s.model

  return (
    <div className="space-y-6" data-testid="recommendation-settings">
      {!data.enabled && (
        <p className="border border-white/[0.14] bg-white/[0.03] px-3 py-2 text-xs text-white/60">
          Recommendations are off until an OpenRouter key is set:{' '}
          <code className="text-white">OPENROUTER_API_KEY</code>.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (modelChanged) save({ model: model.trim() })
        }}
      >
        <label
          htmlFor="rec-model"
          className="mb-2 block text-[10px] font-semibold tracking-widest text-white/50"
        >
          MODEL
        </label>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            id="rec-model"
            value={model}
            onChange={(e) => {
              setModel(e.target.value)
              setSaved(false)
            }}
            list="rec-models"
            placeholder={data.default_model}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className={input}
          />
          <button
            type="submit"
            disabled={busy || !modelChanged || !model.trim()}
            className="border border-white/25 px-3 text-xs font-semibold text-white/80 hover:bg-white hover:text-black disabled:opacity-40"
          >
            Save
          </button>
        </div>
        <datalist id="rec-models">
          {(models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </datalist>
        <p className="mt-2 text-xs text-white/50" data-testid="rec-model-info">
          {chosen ? (
            <>
              {chosen.name} · {price(chosen.input_price)} in /{' '}
              {price(chosen.output_price)} out per million tokens
              {!chosen.tools && ' · no tool use, so no web search'}.
            </>
          ) : models && models.length > 0 && model.trim() ? (
            'Not a model OpenRouter lists.'
          ) : (
            'Any model ID from openrouter.ai/models.'
          )}{' '}
          A refresh sends about 10k tokens per list.
          {model.trim() !== data.default_model && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => save({ model: data.default_model })}
                className="font-semibold text-primary-400 hover:text-white"
              >
                Use the default ({data.default_model})
              </button>
            </>
          )}
        </p>
      </form>

      <div className="space-y-4">
        <Switch
          label="Search the web for Discover"
          hint="The model can look up Royal Road, Reddit, Goodreads, Scribble Hub and Novel Updates (about $0.007 a search, up to 6 a refresh)."
          checked={s.web_search}
          disabled={busy}
          onChange={(v) => save({ web_search: v })}
        />
        <Switch
          label="Share reviews and highlights"
          hint="Off: only titles, authors, genres, tags, ratings and reading time are sent."
          checked={s.share_notes}
          disabled={busy}
          onChange={(v) => save({ share_notes: v })}
        />
        <Switch
          label="Refresh weekly"
          hint="Refresh both lists in the background once a week."
          checked={s.weekly}
          disabled={busy}
          onChange={(v) => save({ weekly: v })}
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {saved && !error && <p className="text-xs text-emerald-400">Saved.</p>}
    </div>
  )
}
