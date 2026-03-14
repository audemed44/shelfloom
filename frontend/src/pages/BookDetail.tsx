import { useState, useEffect, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  Download,
  Edit2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Clock,
  Highlighter,
  AlertTriangle,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import EditBookModal from '../components/book-detail/EditBookModal'
import DeleteBookModal from '../components/book-detail/DeleteBookModal'
import AssignSeriesModal from '../components/series/AssignSeriesModal'
import type { BookDetail, Shelf, ReadingSession, Highlight } from '../types'

// ── helpers ────────────────────────────────────────────────────────────────────

function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '0 min'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// ── sub-components ─────────────────────────────────────────────────────────────

interface BadgeProps {
  children: React.ReactNode
  className?: string
}

function Badge({ children, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-black tracking-widest uppercase border rounded ${className}`}>
      {children}
    </span>
  )
}

interface ProgressBarProps {
  percent: number | null
}

function ProgressBar({ percent }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, percent ?? 0))
  return (
    <div className="relative h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div
        className="absolute left-0 top-0 h-full bg-primary transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// Extended session type for display (backend may include extra fields)
interface SessionDisplay extends ReadingSession {
  start_time?: string
  device?: string
  pages_read?: number
  duration?: number
}

interface SessionRowProps {
  session: SessionDisplay
}

function SessionRow({ session }: SessionRowProps) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-3">
        <Clock size={13} className="text-white/30 shrink-0" />
        <span className="text-xs text-white/60 normal-case">{fmtDate(session.start_time)}</span>
        {session.device && (
          <span className="text-[10px] text-white/30 normal-case">{session.device}</span>
        )}
      </div>
      <div className="flex items-center gap-4 text-xs">
        {session.pages_read != null && (
          <span className="text-white/50 normal-case">{session.pages_read} pages</span>
        )}
        <span className="text-white font-black">{fmtDuration(session.duration)}</span>
      </div>
    </div>
  )
}

interface HighlightCardProps {
  highlight: Highlight
}

function HighlightCard({ highlight }: HighlightCardProps) {
  return (
    <div className="bg-white/5 border border-white/10 rounded p-3 space-y-1">
      <p className="text-sm text-white/90 normal-case leading-relaxed">&ldquo;{highlight.text}&rdquo;</p>
      {highlight.note && (
        <p className="text-xs text-primary/80 normal-case">{highlight.note}</p>
      )}
      {highlight.chapter && (
        <p className="text-[10px] text-white/30 tracking-widest uppercase">{highlight.chapter}</p>
      )}
    </div>
  )
}

// ── reading summary type ────────────────────────────────────────────────────────

interface ReadingSummary {
  percent_finished: number | null
  total_time_seconds: number
  total_sessions: number
}

// ── series membership with nav ─────────────────────────────────────────────────

interface SeriesNavBook {
  id: number
  title: string
}

interface SeriesMembership {
  series_id: number
  series_name: string
  sequence: number | null
  prev_book?: SeriesNavBook | null
  next_book?: SeriesNavBook | null
}

// ── main component ─────────────────────────────────────────────────────────────

export default function BookDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [book, setBook] = useState<BookDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showAssignSeries, setShowAssignSeries] = useState(false)
  const [seriesRefreshKey, setSeriesRefreshKey] = useState(0)
  const [moveOpen, setMoveOpen] = useState(false)
  const [movingTo, setMovingTo] = useState<number | null>(null)

  const { data: shelves } = useApi<Shelf[]>('/api/shelves')
  const { data: summary } = useApi<ReadingSummary>(id ? `/api/books/${id}/reading-summary` : null)
  const { data: sessionsData } = useApi<{ items: SessionDisplay[] }>(id ? `/api/books/${id}/sessions?per_page=5` : null)
  const { data: highlightsData } = useApi<{ items: Highlight[] }>(id ? `/api/books/${id}/highlights?per_page=5` : null)
  const { data: seriesMemberships } = useApi<SeriesMembership[]>(id ? `/api/books/${id}/series?_k=${seriesRefreshKey}` : null)

  const fetchBook = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const data = await api.get<BookDetail>(`/api/books/${id}`)
      setBook(data!)
    } catch (err) {
      const apiErr = err as { status?: number }
      if (apiErr.status === 404) setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchBook() }, [fetchBook])

  const handleMove = async (shelfId: number) => {
    setMoveOpen(false)
    setMovingTo(shelfId)
    try {
      const updated = await api.post<BookDetail>(`/api/books/${id}/move`, { shelf_id: shelfId })
      if (updated) setBook(updated)
    } catch {
      // silently ignore — UI keeps old state
    } finally {
      setMovingTo(null)
    }
  }

  // ── loading / error states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-3 w-40 bg-white/10 rounded" />
        <div className="flex gap-6">
          <div className="w-40 aspect-[2/3] bg-white/5 rounded shrink-0" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-3/4 bg-white/10 rounded" />
            <div className="h-4 w-1/2 bg-white/5 rounded" />
            <div className="h-3 w-full bg-white/5 rounded mt-4" />
            <div className="h-3 w-5/6 bg-white/5 rounded" />
          </div>
        </div>
      </div>
    )
  }

  if (notFound || !book) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4" data-testid="not-found">
        <AlertTriangle size={32} className="text-white/20" />
        <p className="text-sm text-white/40 tracking-widest uppercase">Book not found</p>
        <Link to="/library" className="text-xs text-primary hover:underline">Back to library</Link>
      </div>
    )
  }

  const currentShelf = shelves?.find((s) => s.id === book.shelf_id)
  const otherShelves = shelves?.filter((s) => s.id !== book.shelf_id) ?? []
  const percent = summary?.percent_finished != null ? Math.round(summary.percent_finished) : null
  const sessions = sessionsData?.items ?? []
  const highlights = highlightsData?.items ?? []
  const primarySeries = seriesMemberships?.[0] ?? null

  // ── breadcrumb ──────────────────────────────────────────────────────────────

  const crumbs: Array<{ to: string | null; label: string }> = [
    { to: '/library', label: 'Library' },
    ...(primarySeries ? [{ to: `/series/${primarySeries.series_id}`, label: primarySeries.series_name }] : []),
    { to: null, label: book.title },
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-8">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase text-white/40" aria-label="breadcrumb">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={10} className="text-white/20" />}
            {c.to ? (
              <Link to={c.to} className="hover:text-primary transition-colors">{c.label}</Link>
            ) : (
              <span className={i === crumbs.length - 1 ? 'text-white/70' : ''}>{c.label}</span>
            )}
          </span>
        ))}
      </nav>

      {/* Hero */}
      <div className="flex gap-6 sm:gap-8">
        {/* Cover */}
        <div className="shrink-0 w-28 sm:w-40">
          <div className="aspect-[2/3] bg-white/5 border border-white/10 rounded overflow-hidden">
            <img
              src={`/api/books/${book.id}/cover`}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white leading-tight">
              {book.title}
            </h1>
            {book.author && (
              <p className="text-sm text-white/60 normal-case mt-0.5">{book.author}</p>
            )}
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-2" data-testid="book-badges">
            <Badge className="border-primary/40 text-primary">{book.format}</Badge>
            {currentShelf && (
              <Badge className="border-white/20 text-white/60">{currentShelf.name}</Badge>
            )}
            {primarySeries && (
              <Badge className="border-white/20 text-white/50">
                {primarySeries.series_name}
                {primarySeries.sequence != null && ` #${primarySeries.sequence}`}
              </Badge>
            )}
          </div>

          {/* Reading progress */}
          {percent != null && (
            <div className="space-y-1" data-testid="reading-progress">
              <div className="flex justify-between text-[10px] tracking-widest uppercase text-white/40">
                <span>Progress</span>
                <span className="text-primary">{percent}%</span>
              </div>
              <ProgressBar percent={percent} />
              {summary && summary.total_time_seconds > 0 && (
                <p className="text-[10px] text-white/30 tracking-widest uppercase">
                  {fmtDuration(summary.total_time_seconds)} read · {summary.total_sessions} session{summary.total_sessions !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] tracking-widest uppercase text-white/30">
            {book.page_count && <span>{book.page_count} pages</span>}
            {book.language && <span>{book.language}</span>}
            {book.publisher && <span className="normal-case">{book.publisher}</span>}
            {book.date_published && <span>{book.date_published}</span>}
            <span>Added {fmtDate(book.created_at)}</span>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={`/api/books/${book.id}/download`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 transition-colors"
              data-testid="download-btn"
            >
              <Download size={12} />
              Download
            </a>

            {/* Move shelf dropdown */}
            <div className="relative">
              <button
                onClick={() => setMoveOpen((v) => !v)}
                disabled={movingTo != null || otherShelves.length === 0}
                data-testid="move-shelf-btn"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/60 hover:text-white hover:border-white/40 disabled:opacity-40 transition-colors"
              >
                Move shelf
                <ChevronRight size={10} className={`transition-transform ${moveOpen ? 'rotate-90' : ''}`} />
              </button>
              {moveOpen && (
                <div
                  className="absolute left-0 top-full mt-1 z-30 min-w-[160px] bg-black border border-white/20 rounded shadow-xl"
                  data-testid="move-shelf-dropdown"
                >
                  {otherShelves.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleMove(s.id)}
                      className="w-full text-left px-3 py-2 text-xs text-white/70 normal-case hover:bg-white/5 hover:text-white transition-colors"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowEdit(true)}
              data-testid="edit-btn"
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors"
            >
              <Edit2 size={12} />
              Edit
            </button>

            <button
              onClick={() => setShowAssignSeries(true)}
              data-testid="assign-series-btn"
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors"
            >
              Series
            </button>

            <button
              onClick={() => setShowDelete(true)}
              data-testid="delete-btn"
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase border border-red-500/30 text-red-400/70 hover:text-red-400 hover:border-red-400/60 transition-colors"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Description */}
      {book.description && (
        <section className="space-y-2">
          <h2 className="text-[10px] font-black tracking-widest uppercase text-white/40">Description</h2>
          <p className="text-sm text-white/70 normal-case leading-relaxed">{book.description}</p>
        </section>
      )}

      {/* Series navigation */}
      {primarySeries && (primarySeries.prev_book || primarySeries.next_book) && (
        <section className="bg-white/5 border border-white/10 rounded p-4 space-y-3" data-testid="series-nav">
          <h2 className="text-[10px] font-black tracking-widest uppercase text-white/40">
            {primarySeries.series_name}
          </h2>
          <div className="flex gap-3">
            {primarySeries.prev_book ? (
              <Link
                to={`/books/${primarySeries.prev_book.id}`}
                data-testid="prev-book-link"
                className="flex-1 flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded hover:border-white/20 transition-colors"
              >
                <ChevronLeft size={14} className="text-white/40 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] tracking-widest uppercase text-white/30">Previous</p>
                  <p className="text-xs text-white/80 normal-case truncate">{primarySeries.prev_book.title}</p>
                </div>
              </Link>
            ) : <div className="flex-1" />}

            {primarySeries.next_book ? (
              <Link
                to={`/books/${primarySeries.next_book.id}`}
                data-testid="next-book-link"
                className="flex-1 flex items-center justify-end gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded hover:border-white/20 transition-colors"
              >
                <div className="min-w-0 text-right">
                  <p className="text-[9px] tracking-widest uppercase text-white/30">Next</p>
                  <p className="text-xs text-white/80 normal-case truncate">{primarySeries.next_book.title}</p>
                </div>
                <ChevronRight size={14} className="text-white/40 shrink-0" />
              </Link>
            ) : <div className="flex-1" />}
          </div>
        </section>
      )}

      {/* Reading sessions */}
      {sessions.length > 0 && (
        <section className="space-y-3" data-testid="sessions-section">
          <h2 className="flex items-center gap-2 text-[10px] font-black tracking-widest uppercase text-white/40">
            <BookOpen size={12} />
            Reading Sessions
          </h2>
          <div className="bg-white/5 border border-white/10 rounded px-4">
            {sessions.map((s) => <SessionRow key={s.id} session={s} />)}
          </div>
        </section>
      )}

      {/* Highlights */}
      {highlights.length > 0 && (
        <section className="space-y-3" data-testid="highlights-section">
          <h2 className="flex items-center gap-2 text-[10px] font-black tracking-widest uppercase text-white/40">
            <Highlighter size={12} />
            Highlights
          </h2>
          <div className="space-y-2">
            {highlights.map((h) => <HighlightCard key={h.id} highlight={h} />)}
          </div>
        </section>
      )}

      {/* Modals */}
      {showEdit && (
        <EditBookModal
          book={book}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { setBook(updated); setShowEdit(false) }}
        />
      )}
      {showDelete && (
        <DeleteBookModal
          book={book}
          onClose={() => setShowDelete(false)}
          onDeleted={() => navigate('/library')}
        />
      )}
      {showAssignSeries && (
        <AssignSeriesModal
          bookId={book.id}
          currentSeries={seriesMemberships ?? []}
          onClose={() => setShowAssignSeries(false)}
          onSaved={() => { setShowAssignSeries(false); setSeriesRefreshKey((k) => k + 1) }}
        />
      )}
    </div>
  )
}
