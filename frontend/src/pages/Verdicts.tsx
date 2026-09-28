import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Loader2,
  MessageSquareText,
  RotateCcw,
  SkipForward,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { getBookCoverUrl } from '../utils/bookCover'
import StarRating from '../components/shared/StarRating'

export interface PendingVerdict {
  id: string
  title: string
  author: string | null
  cover_path: string | null
  page_count: number | null
  completed_at: string | null
}

type Outcome = 'rated' | 'dnf'

interface Done {
  book: PendingVerdict
  index: number
  outcome: Outcome
  rating: number | null
}

function fmtFinished(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  return `Finished ${d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`
}

/**
 * Rate finished books one after another: tap a star and the next book comes
 * up. A few words can be added before saving, and the last one can be undone.
 */
export default function Verdicts() {
  const { data, loading, error } = useApi<PendingVerdict[]>(
    '/api/stats/pending-verdicts'
  )
  // The list as loaded, then as you work through it.
  const [local, setQueue] = useState<PendingVerdict[] | null>(null)
  const queue = local ?? data ?? null
  const [index, setIndex] = useState(0)
  const [rating, setRating] = useState<number | null>(null)
  const [review, setReview] = useState('')
  const [writing, setWriting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [last, setLast] = useState<Done | null>(null)
  const [doneCount, setDoneCount] = useState(0)

  const book = queue && index < queue.length ? queue[index] : null
  const remaining = queue ? queue.length : 0

  const resetForm = () => {
    setRating(null)
    setReview('')
    setWriting(false)
  }

  /** Take the current book off the queue (the next one slides into place). */
  const finish = useCallback(
    (outcome: Outcome, value: number | null) => {
      if (!queue || !book) return
      setLast({ book, index, outcome, rating: value })
      setQueue(queue.filter((b) => b.id !== book.id))
      if (index >= queue.length - 1) setIndex(0)
      setDoneCount((n) => n + 1)
      resetForm()
    },
    [queue, book, index]
  )

  const save = useCallback(
    async (value: number | null, text: string) => {
      if (!book || saving) return
      if (value == null && !text.trim()) return
      setSaving(true)
      setMessage(null)
      try {
        await api.patch(`/api/books/${book.id}`, {
          rating: value,
          review: text.trim() || null,
        })
        finish('rated', value)
      } catch {
        setMessage('Could not save that; try again')
      } finally {
        setSaving(false)
      }
    },
    [book, saving, finish]
  )

  const markDnf = async () => {
    if (!book || saving) return
    setSaving(true)
    setMessage(null)
    try {
      if (review.trim() || rating != null) {
        await api.patch(`/api/books/${book.id}`, {
          rating,
          review: review.trim() || null,
        })
      }
      await api.post(`/api/books/${book.id}/dnf`, {})
      finish('dnf', rating)
    } catch {
      setMessage('Could not mark it as not finished; try again')
    } finally {
      setSaving(false)
    }
  }

  const skip = useCallback(() => {
    if (!queue || queue.length < 2) return
    setIndex((i) => (i + 1) % queue.length)
    resetForm()
  }, [queue])

  const undo = async () => {
    if (!last || !queue || saving) return
    setSaving(true)
    try {
      await api.patch(`/api/books/${last.book.id}`, {
        rating: null,
        review: null,
      })
      if (last.outcome === 'dnf')
        await api.delete(`/api/books/${last.book.id}/dnf`)
      const restored = [...queue]
      const at = Math.min(last.index, restored.length)
      restored.splice(at, 0, last.book)
      setQueue(restored)
      setIndex(at)
      setDoneCount((n) => Math.max(0, n - 1))
      setLast(null)
      resetForm()
    } catch {
      setMessage('Could not undo that')
    } finally {
      setSaving(false)
    }
  }

  // Tapping a star is the verdict, unless you've started writing a few words.
  const onStar = (value: number) => {
    setRating(value)
    if (!writing) void save(value, '')
  }

  // Keyboard: 1–5 rate, S skips.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable]')) return
      if (/^[1-5]$/.test(e.key)) onStar(Number(e.key))
      else if (e.key.toLowerCase() === 's') skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const upcoming = useMemo(() => {
    if (!queue || !book) return []
    return [...queue.slice(index + 1), ...queue.slice(0, index)].slice(0, 12)
  }, [queue, book, index])

  const lastLabel = last
    ? last.outcome === 'dnf'
      ? `${last.book.title} marked as not finished`
      : last.rating != null
        ? `${last.book.title} rated ${last.rating} ★`
        : `Review saved for ${last.book.title}`
    : null

  return (
    <div className="mx-auto min-h-screen max-w-[1200px] px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-10">
      <nav className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-white/45">
        <Link to="/" className="hover:text-white">
          Home
        </Link>
        <ChevronRight size={12} />
        <span className="text-white/70">Verdicts</span>
      </nav>

      <header className="mb-8 border-b-2 border-white pb-5">
        <h1 className="text-5xl font-extrabold leading-[0.9] tracking-tighter text-white sm:text-7xl">
          Your verdicts
        </h1>
        <p
          className="mt-3 text-base text-white/55"
          data-testid="verdicts-count"
        >
          {queue === null
            ? loading
              ? 'Loading…'
              : error
                ? 'Could not load your finished books.'
                : ''
            : remaining === 0
              ? 'Every finished book has a verdict.'
              : `${remaining} finished ${remaining === 1 ? 'book is' : 'books are'} waiting for a rating${
                  doneCount ? ` · ${doneCount} done this time` : ''
                }`}
        </p>
      </header>

      {queue === null && loading && (
        <p className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      )}

      {lastLabel && (
        <div
          className="mb-6 flex items-center justify-between gap-3 border border-white/25 px-4 py-2.5 text-sm"
          data-testid="verdict-last"
        >
          <span className="flex min-w-0 items-center gap-2 text-white/80">
            <Check size={14} className="shrink-0 text-primary-400" />
            <span className="truncate">{lastLabel}</span>
          </span>
          <button
            onClick={() => void undo()}
            disabled={saving}
            className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-white/60 hover:text-white disabled:opacity-40"
            data-testid="verdict-undo"
          >
            <RotateCcw size={12} /> Undo
          </button>
        </div>
      )}

      {queue !== null && !book && (
        <div className="py-12" data-testid="verdicts-done">
          <p className="text-4xl font-extrabold tracking-tighter text-white sm:text-6xl">
            All caught up.
          </p>
          <p className="mt-3 text-white/55">
            {doneCount
              ? `You gave ${doneCount} ${doneCount === 1 ? 'verdict' : 'verdicts'}.`
              : 'Nothing is waiting for a verdict.'}
          </p>
          <Link
            to="/library"
            className="mt-8 inline-flex items-center gap-2 border border-white/25 px-4 py-2.5 text-sm font-semibold text-white/80 hover:bg-white hover:text-black"
          >
            Back to the library <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {book && (
        <>
          <section
            key={book.id}
            className="grid animate-fade-up grid-cols-[7rem_1fr] gap-5 sm:grid-cols-[12rem_1fr] sm:gap-8"
            data-testid="verdict-card"
          >
            <Link to={`/books/${book.id}`} className="block self-start">
              <img
                src={getBookCoverUrl(book.id, book.cover_path)}
                alt=""
                className="aspect-[2/3] w-full bg-white/5 object-cover"
              />
            </Link>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tabular-nums text-white/40">
                {index + 1} / {remaining}
              </p>
              <h2
                className="mt-1 text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl"
                data-testid="verdict-title"
              >
                {book.title}
              </h2>
              <p className="mt-1 text-sm text-white/60 sm:text-base">
                {book.author ?? 'Unknown author'}
              </p>
              <p className="mt-1 text-xs text-white/40">
                {fmtFinished(book.completed_at)}
                {book.page_count ? ` · ${book.page_count} pages` : ''}
              </p>

              <div className="mt-6">
                <p className="mb-2 text-[10px] font-semibold tracking-widest text-white/45">
                  {writing ? 'RATING' : 'TAP A STAR — THE NEXT BOOK COMES UP'}
                </p>
                <StarRating value={rating} onChange={onStar} size={34} />
              </div>
            </div>
          </section>

          <div className="mt-6">
            {writing ? (
              <div>
                <textarea
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder="What stayed with you?"
                  className="w-full resize-none border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder-white/25 focus:border-primary focus:outline-none"
                  data-testid="verdict-review"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => void save(rating, review)}
                    disabled={saving || (rating == null && !review.trim())}
                    className="flex items-center gap-2 bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-40"
                    data-testid="verdict-save"
                  >
                    {saving ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    Save and next
                  </button>
                  <button
                    onClick={() => {
                      setWriting(false)
                      setReview('')
                    }}
                    className="px-3 py-2.5 text-sm font-semibold text-white/50 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setWriting(true)}
                  className="flex items-center gap-2 border border-white/25 px-3 py-2.5 text-xs font-semibold text-white/80 hover:bg-white hover:text-black"
                  data-testid="verdict-write"
                >
                  <MessageSquareText size={13} /> Add a few words
                </button>
                <button
                  onClick={skip}
                  disabled={remaining < 2}
                  className="flex items-center gap-2 border border-white/25 px-3 py-2.5 text-xs font-semibold text-white/80 hover:bg-white hover:text-black disabled:opacity-30"
                  data-testid="verdict-skip"
                >
                  <SkipForward size={13} /> Skip for now
                </button>
                <button
                  onClick={() => void markDnf()}
                  disabled={saving}
                  className="flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-white/50 hover:text-accent disabled:opacity-40"
                  data-testid="verdict-dnf"
                >
                  <AlertTriangle size={13} /> Didn&apos;t finish it
                </button>
              </div>
            )}
            {message && <p className="mt-3 text-sm text-accent">{message}</p>}
            <p className="mt-4 hidden text-[11px] text-white/35 sm:block">
              Keys: 1–5 to rate, S to skip.
            </p>
          </div>

          {upcoming.length > 0 && (
            <section className="mt-12 border-t border-white/[0.14] pt-4">
              <p className="mb-3 text-[10px] font-semibold tracking-widest text-white/45">
                UP NEXT
              </p>
              <ol className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
                {upcoming.map((b) => (
                  <li key={b.id} className="w-16 shrink-0 sm:w-20">
                    <button
                      onClick={() => {
                        setIndex(queue!.findIndex((q) => q.id === b.id))
                        resetForm()
                      }}
                      className="block w-full opacity-60 transition-opacity hover:opacity-100"
                      title={b.title}
                    >
                      <img
                        src={getBookCoverUrl(b.id, b.cover_path)}
                        alt={b.title}
                        loading="lazy"
                        className="aspect-[2/3] w-full bg-white/5 object-cover"
                      />
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </div>
  )
}
