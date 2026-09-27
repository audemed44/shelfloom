import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Pencil, RefreshCw, Sparkles } from 'lucide-react'
import { api } from '../../api/client'

export interface VolumeSuggestion {
  start: number
  end: number
  chapter_count: number
  total_words: number
  estimated_pages: number
  estimated_chapter_count: number
  in_progress: boolean
}

interface SuggestResponse {
  start_chapter: number | null
  words_per_page: number
  average_chapter_words: number | null
  suggestions: VolumeSuggestion[]
  reason: string | null
}

interface VolumeSuggestionsProps {
  serialId: number
  /** Number the first suggested volume will get (after built volumes/ebooks). */
  firstVolumeNumber: number
  onApply: (splits: { start: number; end: number }[]) => Promise<void>
  onEdit: (splits: { start: number; end: number }[]) => void
}

const input =
  'w-20 bg-black border border-white/25 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-primary'

const DEFAULT_MIN = '500'
const DEFAULT_MAX = '600'

function fmtWords(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/**
 * Suggests book-length volumes (default 500–600 pages) for the chapters no
 * volume has built yet, and lets the user apply or tweak them.
 */
export default function VolumeSuggestions({
  serialId,
  firstVolumeNumber,
  onApply,
  onEdit,
}: VolumeSuggestionsProps) {
  const [minPages, setMinPages] = useState(DEFAULT_MIN)
  const [maxPages, setMaxPages] = useState(DEFAULT_MAX)
  const [data, setData] = useState<SuggestResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (minText: string, maxText: string) => {
      const min = parseInt(minText, 10)
      const max = parseInt(maxText, 10)
      if (!min || !max || min < 50 || max < min) {
        setError(
          'Enter a page range like 500–600 (the second number ≥ the first)'
        )
        return
      }
      setLoading(true)
      setError(null)
      try {
        const res = await api.post<SuggestResponse>(
          `/api/serials/${serialId}/volumes/suggest`,
          { min_pages: min, max_pages: max }
        )
        setData(res ?? null)
      } catch (err) {
        const e = err as { data?: { detail?: string } }
        setError(e.data?.detail ?? 'Could not suggest volumes')
      } finally {
        setLoading(false)
      }
    },
    [serialId]
  )

  // Suggest with the default book length as soon as the panel opens.
  useEffect(() => {
    void load(DEFAULT_MIN, DEFAULT_MAX)
  }, [load])

  const suggestions = data?.suggestions ?? []
  const splits = suggestions.map((s) => ({ start: s.start, end: s.end }))
  const maxShown = Math.max(
    parseInt(maxPages, 10) || 600,
    ...suggestions.map((s) => s.estimated_pages)
  )
  const estimated = suggestions.some((s) => s.estimated_chapter_count > 0)

  return (
    <div className="space-y-4" data-testid="volume-suggestions">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label
            className="mb-1.5 block text-[10px] font-semibold tracking-widest text-white/50"
            htmlFor="suggest-min"
          >
            Book length (pages)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="suggest-min"
              type="number"
              min={50}
              value={minPages}
              onChange={(e) => setMinPages(e.target.value)}
              className={input}
              aria-label="Minimum pages"
            />
            <span className="text-white/40">–</span>
            <input
              id="suggest-max"
              type="number"
              min={50}
              value={maxPages}
              onChange={(e) => setMaxPages(e.target.value)}
              className={input}
              aria-label="Maximum pages"
            />
          </div>
        </div>
        <button
          onClick={() => void load(minPages, maxPages)}
          disabled={loading}
          className="flex items-center gap-2 border border-white/25 px-3 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white hover:text-black disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          Suggest again
        </button>
      </div>

      {error && (
        <p className="border border-red-400/40 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {data && !loading && (
        <p className="text-xs text-white/45">
          {data.start_chapter != null && `From chapter ${data.start_chapter}`}
          {data.average_chapter_words != null &&
            ` · chapters average ${fmtWords(data.average_chapter_words)} words`}
          {` · ${data.words_per_page} words per page`}
        </p>
      )}

      {data && suggestions.length === 0 && !loading && (
        <p className="border border-white/[0.14] px-3 py-4 text-sm text-white/60">
          {data.reason ?? 'No suggestions.'}
        </p>
      )}

      {suggestions.length > 0 && (
        <>
          <ol className="border border-white/[0.14]">
            {suggestions.map((s, i) => (
              <li
                key={`${s.start}-${s.end}`}
                className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-b border-white/[0.08] px-3 py-3 last:border-0 sm:grid-cols-[2.5rem_9rem_1fr_auto]"
                data-testid="volume-suggestion"
              >
                <span className="text-xs font-semibold tabular-nums text-primary-400">
                  {String(firstVolumeNumber + i).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    Ch {s.start}–{s.end}
                  </p>
                  <p className="text-xs text-white/45">
                    {s.chapter_count} chapters · {fmtWords(s.total_words)} words
                  </p>
                </div>
                {/* Length bar, scaled to the upper target */}
                <div className="col-span-3 row-start-2 h-1.5 bg-white/10 sm:col-span-1 sm:row-start-auto">
                  <div
                    className={`h-full ${s.in_progress ? 'bg-white/40' : 'bg-primary'}`}
                    style={{
                      width: `${Math.min(100, (s.estimated_pages / maxShown) * 100)}%`,
                    }}
                  />
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold tabular-nums text-white">
                    ~{s.estimated_pages} pages
                  </p>
                  {s.in_progress ? (
                    <p className="text-[10px] font-semibold tracking-widest text-white/50">
                      In progress
                    </p>
                  ) : s.estimated_chapter_count > 0 ? (
                    <p className="text-[10px] font-semibold tracking-widest text-accent">
                      {s.estimated_chapter_count} estimated
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          {estimated && (
            <p className="text-xs text-white/45">
              “Estimated” chapters aren&rsquo;t fetched yet, so they count as an
              average-length chapter. Fetch them for exact sizes.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={async () => {
                setApplying(true)
                try {
                  await onApply(splits)
                } finally {
                  setApplying(false)
                }
              }}
              disabled={applying}
              className="flex items-center gap-2 bg-primary px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
              data-testid="apply-suggestions"
            >
              {applying ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Check size={12} />
              )}
              Use these {suggestions.length} volume
              {suggestions.length === 1 ? '' : 's'}
            </button>
            <button
              onClick={() => onEdit(splits)}
              className="flex items-center gap-2 border border-white/25 px-4 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white hover:text-black"
              data-testid="edit-suggestions"
            >
              <Pencil size={12} />
              Edit first
            </button>
            <span className="flex items-center gap-1.5 text-xs text-white/40">
              <Sparkles size={12} />
              Replaces volumes you haven&rsquo;t built yet
            </span>
          </div>
        </>
      )}
    </div>
  )
}
