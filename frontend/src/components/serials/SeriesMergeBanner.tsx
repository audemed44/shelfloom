import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, GitMerge, Loader2, X } from 'lucide-react'
import { api } from '../../api/client'

interface CandidateBook {
  book_id: string
  title: string
  sequence: number | null
  linked: boolean
}

export interface SeriesMergeCandidate {
  series_id: number
  name: string
  book_count: number
  reasons: string[]
  books: CandidateBook[]
}

interface MergeResult {
  series_id: number
  series_name: string
  merged_from: string
  moved_books: number
  linked_volumes: number
}

interface SeriesMergeBannerProps {
  serialId: number
  /** Changes whenever the serial's volumes change, so candidates are re-checked. */
  refreshKey: number
  onMerged: () => void
}

const DISMISS_KEY = 'shelfloom.seriesMerge.dismissed'

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function writeDismissed(keys: string[]) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(keys))
  } catch {
    // Private mode or blocked storage: the banner just comes back next time.
  }
}

/**
 * Offers to fold a series that already holds this story's books (typically
 * the published ebooks, added before the serial) into the serial's series.
 */
export default function SeriesMergeBanner({
  serialId,
  refreshKey,
  onMerged,
}: SeriesMergeBannerProps) {
  const [candidates, setCandidates] = useState<SeriesMergeCandidate[]>([])
  const [dismissed, setDismissed] = useState<string[]>(readDismissed)
  const [linkBooks, setLinkBooks] = useState<Record<number, boolean>>({})
  const [merging, setMerging] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MergeResult | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<SeriesMergeCandidate[]>(
        `/api/serials/${serialId}/series-merge-candidates`
      )
      .then((d) => {
        if (!cancelled) setCandidates(Array.isArray(d) ? d : [])
      })
      .catch(() => {
        if (!cancelled) setCandidates([])
      })
    return () => {
      cancelled = true
    }
  }, [serialId, refreshKey])

  const keyOf = (c: SeriesMergeCandidate) => `${serialId}:${c.series_id}`
  const visible = candidates.filter((c) => !dismissed.includes(keyOf(c)))

  const dismiss = (c: SeriesMergeCandidate) => {
    const next = [...dismissed, keyOf(c)]
    setDismissed(next)
    writeDismissed(next)
  }

  const merge = async (c: SeriesMergeCandidate, link: boolean) => {
    setMerging(c.series_id)
    setError(null)
    try {
      const res = await api.post<MergeResult>(
        `/api/serials/${serialId}/merge-series`,
        { series_id: c.series_id, link_as_volumes: link }
      )
      setResult(res ?? null)
      setCandidates((prev) => prev.filter((x) => x.series_id !== c.series_id))
      onMerged()
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Could not merge the series')
    } finally {
      setMerging(null)
    }
  }

  if (result) {
    return (
      <div
        className="mb-10 flex items-start gap-3 border border-white/25 px-4 py-3"
        data-testid="series-merge-done"
      >
        <Check size={16} className="mt-0.5 shrink-0 text-primary" />
        <p className="flex-1 text-sm text-white/75">
          Merged &ldquo;{result.merged_from}&rdquo; into{' '}
          <Link
            to={`/series/${result.series_id}`}
            className="font-semibold text-white underline decoration-primary underline-offset-4"
          >
            {result.series_name}
          </Link>
          .
          {result.linked_volumes > 0 &&
            ` ${result.linked_volumes} book${result.linked_volumes === 1 ? '' : 's'} added as ebook volumes — set their chapter ranges below.`}
        </p>
        <button
          onClick={() => setResult(null)}
          aria-label="Dismiss"
          className="text-white/40 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  if (visible.length === 0) return null

  return (
    <div className="mb-10 space-y-3">
      {visible.map((c) => {
        const unlinked = c.books.filter((b) => !b.linked)
        const link = linkBooks[c.series_id] ?? unlinked.length > 0
        return (
          <section
            key={c.series_id}
            className="border-2 border-primary"
            data-testid="series-merge-banner"
          >
            <div className="flex items-center justify-between gap-3 bg-primary px-4 py-2">
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white">
                <GitMerge size={13} />
                Series found in your library
              </p>
              <button
                onClick={() => dismiss(c)}
                aria-label="Dismiss"
                className="text-white/70 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <p className="text-sm leading-relaxed text-white/75">
                <Link
                  to={`/series/${c.series_id}`}
                  className="font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-primary"
                >
                  {c.name}
                </Link>{' '}
                already has {c.book_count} book{c.book_count === 1 ? '' : 's'}{' '}
                {c.reasons.includes('linked_ebook')
                  ? 'including an ebook linked to this serial'
                  : 'with the same name as this serial'}
                . Merge it into this serial&rsquo;s series so everything shares
                one reading order; the old series is then deleted.
              </p>
              <ol className="flex flex-wrap gap-2">
                {c.books.map((b) => (
                  <li
                    key={b.book_id}
                    className="border border-white/20 px-2.5 py-1 text-xs text-white/70"
                  >
                    {b.sequence != null && (
                      <span className="mr-1.5 tabular-nums text-white/40">
                        #{b.sequence}
                      </span>
                    )}
                    {b.title}
                    {b.linked && (
                      <span className="ml-1.5 text-[10px] font-semibold tracking-widest text-primary-400">
                        LINKED
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              {unlinked.length > 0 && (
                <label className="flex items-start gap-2.5 text-sm text-white/75">
                  <input
                    type="checkbox"
                    checked={link}
                    onChange={(e) =>
                      setLinkBooks((prev) => ({
                        ...prev,
                        [c.series_id]: e.target.checked,
                      }))
                    }
                    className="mt-0.5 accent-primary"
                    data-testid="series-merge-link"
                  />
                  <span>
                    Also add {unlinked.length === 1 ? 'it' : 'them'} as ebook
                    volumes, in series order, before the generated volumes
                  </span>
                </label>
              )}
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => merge(c, link)}
                  disabled={merging !== null}
                  className="flex items-center gap-2 bg-primary px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
                  data-testid="series-merge-confirm"
                >
                  {merging === c.series_id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <GitMerge size={12} />
                  )}
                  Merge series
                </button>
                <button
                  onClick={() => dismiss(c)}
                  className="border border-white/25 px-4 py-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white hover:text-black"
                >
                  Not now
                </button>
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}
