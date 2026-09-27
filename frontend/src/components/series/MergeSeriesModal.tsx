import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, GitMerge, Loader2, Search, X } from 'lucide-react'
import { api } from '../../api/client'
import type { SeriesWithCount } from '../../types/api'

interface MergeSeriesModalProps {
  source: { id: number; name: string }
  sourceBookCount: number
  allSeries: SeriesWithCount[]
  onClose: () => void
  onMerged: (targetId: number) => void
}

interface MergeResponse {
  series: { id: number; name: string }
  moved_books: number
  already_in_target: number
}

/** Move every book in one series into another, then delete the first. */
export default function MergeSeriesModal({
  source,
  sourceBookCount,
  allSeries,
  onClose,
  onMerged,
}: MergeSeriesModalProps) {
  // Pre-fill with the series' own name: the usual duplicate has the same one.
  const [query, setQuery] = useState(source.name)
  const [targetId, setTargetId] = useState<number | null>(null)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const options = useMemo(() => {
    const q = query.trim().toLowerCase()
    const others = allSeries.filter((s) => s.id !== source.id)
    const matches = q
      ? others.filter((s) => s.name.toLowerCase().includes(q))
      : others
    return matches.length > 0 || !q ? matches : others
  }, [allSeries, query, source.id])

  const target = allSeries.find((s) => s.id === targetId) ?? null

  const handleMerge = async () => {
    if (!target) return
    setMerging(true)
    setError(null)
    try {
      await api.post<MergeResponse>(`/api/series/${target.id}/merge`, {
        source_id: source.id,
      })
      onMerged(target.id)
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Could not merge the series')
      setMerging(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-3 animate-fade-in sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-series-title"
      data-testid="merge-series-modal"
    >
      <div className="w-full max-w-xl border border-white bg-black animate-scale-in">
        <div className="flex items-start justify-between gap-4 border-b-2 border-white px-5 py-4">
          <div>
            <h2
              id="merge-series-title"
              className="text-xl font-bold tracking-tight text-white"
            >
              Merge &ldquo;{source.name}&rdquo; into…
            </h2>
            <p className="mt-1 text-sm text-white/55 normal-case">
              Its {sourceBookCount} book{sourceBookCount === 1 ? '' : 's'},
              reading orders and sub-series move to the series you pick, then
              &ldquo;{source.name}&rdquo; is deleted.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center text-white/60 hover:bg-white hover:text-black"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a series"
              aria-label="Find a series"
              className="w-full border border-white/25 bg-black py-2 pl-9 pr-3 text-sm text-white normal-case focus:border-primary focus:outline-none"
              autoFocus
            />
          </div>

          <ul className="max-h-72 overflow-y-auto border border-white/[0.14]">
            {options.length === 0 && (
              <li className="px-3 py-4 text-sm text-white/50">
                No other series yet.
              </li>
            )}
            {options.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setTargetId(s.id)}
                  className={`flex w-full items-center gap-3 border-b border-white/[0.08] px-3 py-2.5 text-left transition-colors last:border-0 ${
                    targetId === s.id
                      ? 'bg-primary text-white'
                      : 'text-white/80 hover:bg-white/[0.06]'
                  }`}
                  data-testid="merge-series-option"
                >
                  <span className="flex-1 truncate text-sm font-semibold normal-case">
                    {s.name}
                    {s.parent_name && (
                      <span
                        className={`ml-2 text-xs font-normal ${targetId === s.id ? 'text-white/70' : 'text-white/40'}`}
                      >
                        in {s.parent_name}
                      </span>
                    )}
                  </span>
                  <span
                    className={`text-xs tabular-nums ${targetId === s.id ? 'text-white/80' : 'text-white/40'}`}
                  >
                    {s.book_count} book{s.book_count === 1 ? '' : 's'}
                  </span>
                  {targetId === s.id && <Check size={14} />}
                </button>
              </li>
            ))}
          </ul>

          {target && (
            <p
              className="flex flex-wrap items-center gap-2 text-sm text-white/70 normal-case"
              data-testid="merge-series-summary"
            >
              <span className="font-semibold text-white">{source.name}</span>
              <ArrowRight size={14} className="text-primary" />
              <span className="font-semibold text-white">{target.name}</span>
              <span className="text-white/45">
                ({target.book_count} book{target.book_count === 1 ? '' : 's'}{' '}
                there now; a book in both keeps its position in {target.name})
              </span>
            </p>
          )}

          {error && (
            <p className="border border-red-400/40 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="border border-white/25 px-4 py-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white hover:text-black"
            >
              Cancel
            </button>
            <button
              onClick={handleMerge}
              disabled={!target || merging}
              className="flex items-center gap-2 bg-primary px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-40"
              data-testid="merge-series-confirm"
            >
              {merging ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <GitMerge size={12} />
              )}
              Merge and delete &ldquo;{source.name}&rdquo;
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
