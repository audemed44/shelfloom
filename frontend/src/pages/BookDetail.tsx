import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Download,
  Edit2,
  Trash2,
  ChevronRight,
  ChevronLeft,
  BookOpen,
  Clock,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Loader2,
  Upload,
  PlusCircle,
  MessageSquareText,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import EditBookModal from '../components/book-detail/EditBookModal'
import DeleteBookModal from '../components/book-detail/DeleteBookModal'
import LogSessionModal from '../components/book-detail/LogSessionModal'
import VerdictModal from '../components/book-detail/VerdictModal'
import type { BookDetail, Shelf, ReadingSession, Highlight } from '../types'
import type { SeriesBook } from '../types/api'
import { getBookCoverUrl } from '../utils/bookCover'
import StarRating from '../components/shared/StarRating'

// ── helpers ────────────────────────────────────────────────────────────────────

function fmtFormat(format: string | null | undefined): string {
  if (!format) return ''
  return format.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '0 min'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// ── extended session display type ───────────────────────────────────────────────

interface SessionDisplay extends ReadingSession {
  start_time?: string
  device?: string
  pages_read?: number
  duration?: number
}

// ── sub-components ─────────────────────────────────────────────────────────────

function SessionRow({ session }: { session: SessionDisplay }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.12]">
      <div className="flex items-center gap-3">
        <Clock size={13} className="text-white/30 shrink-0" />
        <span className="text-xs text-white/60 normal-case">
          {fmtDate(session.start_time ?? session.started_at)}
        </span>
        {session.device && (
          <span className="text-[10px] text-white/30 normal-case">
            {session.device}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 text-xs">
        {session.pages_read != null && (
          <span className="text-white/50 normal-case">
            {session.pages_read} pages
          </span>
        )}
        <span className="text-white font-semibold">
          {fmtDuration(session.duration ?? session.duration_seconds)}
        </span>
      </div>
    </div>
  )
}

// ── series shelf ───────────────────────────────────────────────────────────────

function fmtSequence(seq: number | null | undefined): string {
  if (seq == null) return '—'
  return Number.isInteger(seq) ? String(seq) : String(seq)
}

function SeriesShelf({
  books,
  currentBookId,
  seriesId,
  seriesName,
  sequence,
}: {
  books: SeriesBook[]
  currentBookId: string | number
  seriesId: number
  seriesName: string
  sequence: number | null
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLAnchorElement>(null)
  const currentIndex = books.findIndex(
    (b) => String(b.book_id) === String(currentBookId)
  )

  // Centre the current book inside the shelf without moving the page.
  useEffect(() => {
    const scroller = scrollerRef.current
    const current = currentRef.current
    if (!scroller || !current) return
    scroller.scrollLeft =
      current.offsetLeft - scroller.clientWidth / 2 + current.clientWidth / 2
  }, [books, currentBookId])

  const scrollBy = (dir: -1 | 1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <section className="mb-12" data-testid="series-shelf">
      <div className="rule flex items-end justify-between gap-4 mb-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-widest text-primary-400">
            {sequence != null
              ? `Book ${fmtSequence(sequence)} of ${books.length}`
              : `${books.length} books`}
          </p>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white truncate">
            In this series
          </h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => scrollBy(-1)}
            aria-label="Scroll series left"
            className="hidden sm:grid size-8 place-items-center border border-white/25 text-white/70 hover:bg-white hover:text-black transition-colors"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={() => scrollBy(1)}
            aria-label="Scroll series right"
            className="hidden sm:grid size-8 place-items-center border border-white/25 text-white/70 hover:bg-white hover:text-black transition-colors"
          >
            <ChevronRight size={15} />
          </button>
          <Link
            to={`/series/${seriesId}`}
            className="inline-flex items-center gap-1 bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-primary hover:text-white transition-colors"
          >
            <span className="hidden sm:inline">{seriesName}</span>
            <span className="sm:hidden">View series</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      {/* Reading-order track */}
      <div className="flex gap-1 h-1 mb-4" aria-hidden="true">
        {books.map((sb, i) => (
          <div
            key={sb.book_id}
            className={`flex-1 transition-colors ${
              i === currentIndex
                ? 'bg-primary'
                : i < currentIndex
                  ? 'bg-white/60'
                  : 'bg-white/10'
            }`}
          />
        ))}
      </div>

      <div
        ref={scrollerRef}
        className="relative -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 pt-2 sm:mx-0 sm:gap-4 sm:px-1 no-scrollbar"
        data-testid="series-shelf-list"
      >
        {books.map((sb) => {
          const isCurrent = String(sb.book_id) === String(currentBookId)
          return (
            <Link
              key={sb.book_id}
              ref={isCurrent ? currentRef : undefined}
              to={`/books/${sb.book_id}`}
              aria-current={isCurrent ? 'page' : undefined}
              data-testid="series-shelf-book"
              className="group w-24 shrink-0 snap-start sm:w-28"
            >
              <div
                className={`book-cover relative aspect-[2/3] overflow-hidden rounded-lg bg-ink-700 transition-all duration-300 ${
                  isCurrent
                    ? 'outline outline-2 outline-offset-2 outline-primary'
                    : 'opacity-80 group-hover:opacity-100 group-hover:-translate-y-1'
                }`}
              >
                <div className="absolute inset-0 grid place-items-center p-2 text-center text-[10px] leading-tight text-white/40">
                  {sb.title}
                </div>
                <img
                  src={getBookCoverUrl(sb.book_id, sb.cover_path)}
                  alt=""
                  loading="lazy"
                  className="relative h-full w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
                <span
                  className={`absolute left-0 top-0 px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${
                    isCurrent
                      ? 'bg-primary text-white'
                      : 'bg-black text-white/80'
                  }`}
                >
                  #{fmtSequence(sb.sequence)}
                </span>
              </div>
              <p
                className={`mt-2 text-xs leading-snug line-clamp-2 ${
                  isCurrent
                    ? 'font-semibold text-white'
                    : 'text-white/60 group-hover:text-white'
                }`}
              >
                {sb.title}
              </p>
              {isCurrent && (
                <p className="mt-0.5 text-[9px] font-semibold tracking-widest text-primary-400">
                  Reading now
                </p>
              )}
            </Link>
          )
        })}
      </div>
    </section>
  )
}

// ── types ──────────────────────────────────────────────────────────────────────

interface ReadingSummary {
  percent_finished: number | null
  total_time_seconds: number
  total_sessions: number
}

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

interface SeriesInfo {
  id: number
  name: string
  parent_id: number | null
}

// ── main component ─────────────────────────────────────────────────────────────

export default function BookDetailPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const [book, setBook] = useState<BookDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showLogSession, setShowLogSession] = useState(false)
  const [showVerdict, setShowVerdict] = useState(false)
  const [seriesRefreshKey, setSeriesRefreshKey] = useState(0)
  const [moveOpen, setMoveOpen] = useState(false)
  const [movingTo, setMovingTo] = useState<number | null>(null)
  const [coverRefreshing, setCoverRefreshing] = useState(false)
  const [coverUploading, setCoverUploading] = useState(false)
  const [coverKey, setCoverKey] = useState(0)
  const [markingRead, setMarkingRead] = useState(false)
  const [summaryKey, setSummaryKey] = useState(0)
  const [sessionsKey, setSessionsKey] = useState(0)

  const { data: shelves } = useApi<Shelf[]>('/api/shelves')
  const { data: summary } = useApi<ReadingSummary>(
    id ? `/api/books/${id}/reading-summary?_k=${summaryKey}` : null
  )
  const { data: sessionsData } = useApi<{ items: SessionDisplay[] }>(
    id ? `/api/books/${id}/sessions?per_page=10&_k=${sessionsKey}` : null
  )
  const { data: highlightsData } = useApi<{ items: Highlight[] }>(
    id ? `/api/books/${id}/highlights?per_page=5` : null
  )
  const { data: seriesMemberships } = useApi<SeriesMembership[]>(
    id ? `/api/books/${id}/series?_k=${seriesRefreshKey}` : null
  )
  const primarySeries = seriesMemberships?.[0] ?? null
  const { data: seriesBooks } = useApi<SeriesBook[]>(
    primarySeries ? `/api/series/${primarySeries.series_id}/books` : null
  )
  // Fetch all series (flat list) only when this book is in a series, to build ancestry chain
  const { data: allSeriesList } = useApi<SeriesInfo[]>(
    primarySeries ? '/api/series/tree' : null
  )

  // Walk parent_id links from the direct series up to the root
  const seriesAncestors = useMemo((): SeriesInfo[] => {
    if (!primarySeries || !Array.isArray(allSeriesList)) return []
    const byId = new Map(allSeriesList.map((s) => [s.id, s]))
    const chain: SeriesInfo[] = []
    const visited = new Set<number>()
    let current = byId.get(primarySeries.series_id)
    while (current) {
      if (visited.has(current.id)) break // cycle guard
      visited.add(current.id)
      chain.unshift(current)
      current =
        current.parent_id != null ? byId.get(current.parent_id) : undefined
    }
    return chain
  }, [primarySeries, allSeriesList])

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

  useEffect(() => {
    fetchBook()
  }, [fetchBook])

  useEffect(() => {
    const state = location.state as { openVerdict?: boolean } | null
    if (state?.openVerdict) {
      setShowVerdict(true)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.pathname, location.state, navigate])

  const handleRefreshCover = async () => {
    if (!id) return
    setCoverRefreshing(true)
    try {
      const updated = await api.post<BookDetail>(
        `/api/books/${id}/refresh-cover`,
        {}
      )
      if (updated) {
        setBook(updated)
        setCoverKey((k) => k + 1)
      }
    } catch {
      // silently ignore
    } finally {
      setCoverRefreshing(false)
    }
  }

  const handleUploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !id) return
    e.target.value = ''
    setCoverUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const updated = await api.upload<BookDetail>(
        `/api/books/${id}/upload-cover`,
        formData
      )
      if (updated) {
        setBook(updated)
        setCoverKey((k) => k + 1)
      }
    } catch {
      // silently ignore
    } finally {
      setCoverUploading(false)
    }
  }

  const handleMarkRead = async (markRead: boolean) => {
    if (!id) return
    setMarkingRead(true)
    try {
      if (markRead) {
        await api.post(`/api/books/${id}/mark-read`, {})
      } else {
        await api.delete(`/api/books/${id}/mark-read`)
      }
      await fetchBook()
      setSummaryKey((k) => k + 1)
    } catch {
      // silently ignore
    } finally {
      setMarkingRead(false)
    }
  }

  const handleMove = async (shelfId: number) => {
    setMoveOpen(false)
    setMovingTo(shelfId)
    try {
      const updated = await api.post<BookDetail>(`/api/books/${id}/move`, {
        shelf_id: shelfId,
      })
      if (updated) setBook(updated)
    } catch {
      // silently ignore — UI keeps old state
    } finally {
      setMovingTo(null)
    }
  }

  // Weekly reading activity bars from sessions data
  const weeklyBars = useMemo(() => {
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const totals = new Array(7).fill(0)
    const now = new Date()
    ;(sessionsData?.items ?? []).forEach((s) => {
      const dateStr = s.start_time ?? s.started_at
      if (!dateStr) return
      const d = new Date(dateStr)
      const diffDays = Math.floor(
        (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
      )
      if (diffDays >= 7) return
      let idx = d.getDay() - 1 // Mon = 0
      if (idx < 0) idx = 6 // Sun = 6
      totals[idx] += s.duration ?? s.duration_seconds ?? 0
    })
    const max = Math.max(...totals, 1)
    return dayLabels.map((label, i) => ({
      label,
      heightPct: Math.max(6, Math.round((totals[i] / max) * 100)),
      active: totals[i] > 0,
    }))
  }, [sessionsData])

  // ── loading / error states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 animate-pulse">
        <div className="h-3 w-40 bg-white/10 rounded mb-10" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <div className="aspect-[2/3] skeleton rounded-2xl w-48 mx-auto sm:w-60 lg:w-full" />
          </div>
          <div className="lg:col-span-7 space-y-6 pt-4">
            <div className="h-4 w-32 bg-white/10 rounded" />
            <div className="h-14 w-3/4 bg-white/10 rounded" />
            <div className="h-5 w-1/3 bg-white/5 rounded" />
            <div className="flex gap-3 mt-8">
              <div className="h-10 w-28 bg-white/10 rounded-lg" />
              <div className="h-10 w-28 bg-white/5 rounded-lg" />
              <div className="h-10 w-28 bg-white/5 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (notFound || !book) {
    return (
      <div
        className="flex flex-col items-center justify-center py-24 gap-4"
        data-testid="not-found"
      >
        <AlertTriangle size={32} className="text-white/20" />
        <p className="text-sm text-white/40 tracking-widest uppercase">
          Book not found
        </p>
        <Link to="/library" className="text-xs text-primary hover:underline">
          Back to library
        </Link>
      </div>
    )
  }

  const currentShelf = shelves?.find((s) => s.id === book.shelf_id)
  const otherShelves = shelves?.filter((s) => s.id !== book.shelf_id) ?? []
  const percent =
    summary?.percent_finished != null
      ? Math.round(summary.percent_finished)
      : null
  const sessions = sessionsData?.items ?? []
  const highlights = highlightsData?.items ?? []
  const isDnf = book.status === 'dnf'
  const genres = book.genres ?? []

  // Breadcrumb — Library → ancestor0 → … → ancestorN (direct series) → Book
  const crumbs: Array<{ to: string | null; label: string }> = [
    { to: '/library', label: 'Library' },
    ...seriesAncestors.map((s) => ({ to: `/series/${s.id}`, label: s.name })),
    { to: null, label: book.title },
  ]

  const seriesBookList = Array.isArray(seriesBooks) ? seriesBooks : []
  const coverUrl = getBookCoverUrl(book.id, book.cover_path, coverKey)
  const ringR = 26
  const ringC = 2 * Math.PI * ringR
  const pct = percent ?? 0

  const secondaryBtn =
    'flex items-center gap-2 border border-white/25 px-4 py-2.5 text-xs font-semibold text-white/80 hover:text-black hover:bg-white hover:border-white transition-colors'

  return (
    <div className="relative">
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumb */}
        <nav
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap text-xs text-white/45 mb-6 border-b border-white/[0.14] pb-3 sm:mb-10"
          aria-label="breadcrumb"
        >
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5 shrink-0">
              {i > 0 && <ChevronRight size={12} className="text-white/25" />}
              {c.to ? (
                <Link
                  to={c.to}
                  className="hover:text-primary-400 transition-colors"
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  className={
                    i === crumbs.length - 1
                      ? 'text-white/75 max-w-[16rem] truncate'
                      : ''
                  }
                >
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </nav>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:gap-y-6">
          {/* ── Cover ── */}
          <div className="lg:col-span-4 lg:row-start-1 animate-fade-up">
            <div className="book-cover relative aspect-[2/3] w-40 overflow-hidden bg-white/5 sm:w-56 lg:w-full">
              <img
                key={coverKey}
                src={coverUrl}
                alt={book.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />

              <div className="absolute bottom-2 right-2 flex gap-1.5">
                <label
                  title="Upload cover image"
                  className={`grid size-8 place-items-center bg-black text-white/80 hover:bg-white hover:text-black transition-all cursor-pointer ${coverUploading ? 'opacity-40 pointer-events-none' : ''}`}
                >
                  {coverUploading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Upload size={13} />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleUploadCover}
                  />
                </label>
                <button
                  onClick={handleRefreshCover}
                  disabled={coverRefreshing}
                  data-testid="refresh-cover-btn"
                  title="Refresh cover from file"
                  className="grid size-8 place-items-center bg-black text-white/80 hover:bg-white hover:text-black transition-all disabled:opacity-40"
                >
                  {coverRefreshing ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* ── Main info ── */}
          <div className="lg:col-span-8 lg:col-start-5 lg:row-start-1 lg:row-span-2 flex flex-col min-w-0 animate-fade-up [animation-delay:80ms]">
            {/* Series label */}
            {primarySeries && (
              <Link
                to={`/series/${primarySeries.series_id}`}
                className="group mb-4 inline-flex max-w-full items-center gap-3 self-start"
              >
                <span className="shrink-0 bg-primary px-2 py-1 text-[10px] font-semibold tracking-widest text-white">
                  {primarySeries.sequence != null
                    ? `Book ${primarySeries.sequence}`
                    : 'Series'}
                </span>
                <span className="truncate text-sm text-white/55 group-hover:text-white transition-colors">
                  of {primarySeries.series_name}
                </span>
              </Link>
            )}

            {/* Title + Author */}
            <div className="mb-6">
              <h1 className="text-[2.75rem] sm:text-6xl lg:text-7xl font-extrabold tracking-tighter text-white leading-[0.92] mb-4 break-words">
                {book.title}
              </h1>
              {book.author && (
                <p className="text-lg sm:text-2xl font-medium tracking-tight text-white/60">
                  {book.author}
                </p>
              )}
              {book.rating != null && (
                <div className="mt-3 flex">
                  <StarRating value={book.rating} readOnly size={16} />
                </div>
              )}
            </div>

            {/* Format / shelf / genre badges */}
            <div
              className="flex flex-wrap gap-2 mb-8"
              data-testid="book-badges"
            >
              {book.format && (
                <span className="px-2 py-1 text-[11px] font-semibold bg-primary text-white">
                  {fmtFormat(book.format)}
                </span>
              )}
              {currentShelf && (
                <span className="px-2 py-1 text-[11px] font-medium border border-white/25 text-white/60">
                  {currentShelf.name}
                </span>
              )}
              {primarySeries && (
                <span className="px-2 py-1 text-[11px] font-medium border border-white/25 text-white/50">
                  {primarySeries.series_name}
                  {primarySeries.sequence != null
                    ? ` #${primarySeries.sequence}`
                    : ''}
                </span>
              )}
              {genres.map((genre) => (
                <span
                  key={genre.id}
                  className="px-2 py-1 text-[11px] font-medium border border-primary text-primary-300"
                >
                  {genre.name}
                </span>
              ))}
              {book.tags?.map((t) => (
                <span
                  key={t.id}
                  className="px-2 py-1 text-[11px] font-medium border border-accent/70 text-accent"
                >
                  {t.name}
                </span>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 mb-12">
              {!book.file_path?.startsWith('manual://') && (
                <a
                  href={`/api/books/${book.id}/download`}
                  className="flex items-center gap-2 bg-primary px-5 py-2.5 text-xs font-semibold text-white hover:bg-primary-600 transition-colors"
                  data-testid="download-btn"
                >
                  <Download size={14} />
                  Download
                </a>
              )}

              {/* Move shelf dropdown */}
              {!book.file_path?.startsWith('manual://') && (
                <div className="relative">
                  <button
                    onClick={() => setMoveOpen((v) => !v)}
                    disabled={movingTo != null || otherShelves.length === 0}
                    data-testid="move-shelf-btn"
                    className={`${secondaryBtn} disabled:opacity-40`}
                  >
                    Move Shelf
                    <ChevronRight
                      size={12}
                      className={`transition-transform ${moveOpen ? 'rotate-90' : ''}`}
                    />
                  </button>
                  {moveOpen && (
                    <div
                      className="absolute left-0 top-full mt-1 z-30 min-w-[180px] bg-black border border-white animate-scale-in"
                      data-testid="move-shelf-dropdown"
                    >
                      {otherShelves.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => handleMove(s.id)}
                          className="w-full text-left px-4 py-2.5 text-sm text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => setShowLogSession(true)}
                data-testid="log-session-btn"
                className={secondaryBtn}
              >
                <PlusCircle size={14} />
                Log Session
              </button>

              <button
                onClick={() => setShowVerdict(true)}
                data-testid="review-btn"
                className={secondaryBtn}
              >
                <MessageSquareText size={14} />
                Your Verdict
              </button>

              <button
                onClick={() => handleMarkRead(percent == null || percent < 100)}
                disabled={markingRead}
                data-testid="mark-read-btn"
                className={`${secondaryBtn} disabled:opacity-40 ${
                  percent != null && percent >= 100
                    ? '!border-primary/40 !text-primary-300'
                    : ''
                }`}
              >
                <CheckCircle2 size={14} />
                {percent != null && percent >= 100 && !isDnf
                  ? 'Unmark'
                  : 'Mark Read'}
              </button>

              <button
                onClick={() => setShowEdit(true)}
                data-testid="edit-btn"
                className={secondaryBtn}
              >
                <Edit2 size={14} />
                Edit
              </button>

              <button
                onClick={() => setShowDelete(true)}
                data-testid="delete-btn"
                aria-label="Delete book"
                className="grid size-10 place-items-center border border-red-500/40 text-red-400/70 hover:text-red-300 hover:border-red-400/60 hover:bg-red-500/10 transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* Every book in the series, visible right on the page */}
            {primarySeries && seriesBookList.length > 1 && (
              <SeriesShelf
                books={seriesBookList}
                currentBookId={book.id}
                seriesId={primarySeries.series_id}
                seriesName={primarySeries.series_name}
                sequence={primarySeries.sequence}
              />
            )}

            {/* Description */}
            {book.description && (
              <div className="mb-10">
                <h2 className="text-[10px] font-semibold tracking-widest text-white/40 mb-3">
                  Description
                </h2>
                <p className="text-[15px] text-white/75 leading-relaxed">
                  {book.description}
                </p>
              </div>
            )}

            {/* Verdict */}
            <div className="mb-12">
              <div className="rule flex items-center justify-between mb-5">
                <p className="text-xl font-bold tracking-tight text-white">
                  Your Verdict
                </p>
                <button
                  onClick={() => setShowVerdict(true)}
                  className="text-xs font-semibold text-primary-400 hover:text-white transition-colors"
                >
                  Edit
                </button>
              </div>
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-8">
                  <div>
                    <p className="text-[10px] font-semibold tracking-widest text-white/35 mb-1.5">
                      Rating
                    </p>
                    {book.rating != null ? (
                      <div className="flex items-center gap-2">
                        <StarRating value={book.rating} readOnly size={16} />
                        <span className="text-sm font-semibold text-white/70">
                          {book.rating.toFixed(1)} / 5
                        </span>
                      </div>
                    ) : (
                      <p className="text-sm text-white/35">Unrated</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold tracking-widest text-white/35 mb-1.5">
                      Outcome
                    </p>
                    {isDnf ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold tracking-widest bg-red-500/10 border border-red-400/30 text-red-400">
                        <AlertTriangle size={12} />
                        DNF
                      </span>
                    ) : (
                      <span className="text-sm text-white/60">
                        {percent != null && percent >= 100
                          ? 'Completed'
                          : percent != null && percent > 0
                            ? 'In progress'
                            : 'No verdict yet'}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold tracking-widest text-white/35 mb-1.5">
                      Pages
                    </p>
                    <p className="text-sm text-white/70">
                      {book.page_count ? book.page_count.toLocaleString() : '—'}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-semibold tracking-widest text-white/35 mb-2">
                    Review
                  </p>
                  {book.review ? (
                    <p className="text-base text-white/80 leading-relaxed whitespace-pre-wrap">
                      {book.review}
                    </p>
                  ) : (
                    <p className="text-sm text-white/35">No review yet.</p>
                  )}
                  {book.review_updated_at && (
                    <p className="mt-3 text-[10px] font-semibold tracking-widest text-white/30">
                      Updated {fmtDate(book.review_updated_at)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Highlights */}
            {highlights.length > 0 && (
              <section
                className="space-y-4 mb-10"
                data-testid="highlights-section"
              >
                <h2 className="rule text-xl font-bold tracking-tight text-white">
                  Recent Highlights
                </h2>
                <div className="space-y-4">
                  {highlights.map((h) => (
                    <figure
                      key={h.id}
                      className="relative border-l-4 border-primary py-1 pl-5"
                    >
                      <p className="text-lg sm:text-xl font-medium tracking-tight leading-snug text-white">
                        &ldquo;{h.text}&rdquo;
                      </p>
                      {h.note && (
                        <p className="text-sm text-primary-300 mt-2">
                          {h.note}
                        </p>
                      )}
                      {h.chapter && (
                        <div className="mt-2 flex gap-3 text-[10px] font-semibold tracking-widest text-white/35">
                          <span>{h.chapter}</span>
                        </div>
                      )}
                    </figure>
                  ))}
                </div>
              </section>
            )}

            {/* Reading sessions */}
            {sessions.length > 0 && (
              <section className="space-y-3" data-testid="sessions-section">
                <h2 className="rule flex items-center gap-2 text-xl font-bold tracking-tight text-white">
                  <BookOpen size={16} className="text-primary-400" />
                  Reading Sessions
                </h2>
                <div>
                  {sessions.slice(0, 5).map((s) => (
                    <SessionRow key={s.id} session={s} />
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* ── Side cards ── */}
          <div className="lg:col-span-4 lg:row-start-2 space-y-6 self-start animate-fade-up [animation-delay:160ms]">
            {/* Progress card */}
            <div
              className="border-t-2 border-white pt-4 space-y-6"
              data-testid={percent != null ? 'reading-progress' : undefined}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-semibold tracking-widest text-white/40 mb-1">
                    Book Progress
                  </p>
                  {percent != null ? (
                    <p className="text-5xl font-extrabold tracking-tighter tabular-nums">
                      {percent}%{' '}
                      <span className="text-sm font-medium tracking-normal text-white/40">
                        Complete
                      </span>
                    </p>
                  ) : (
                    <p className="text-2xl font-bold tracking-tight text-white/35">
                      Not started
                    </p>
                  )}
                  {summary && summary.total_time_seconds > 0 && (
                    <p className="text-xs text-white/40 mt-1">
                      {fmtDuration(summary.total_time_seconds)} ·{' '}
                      {summary.total_sessions} session
                      {summary.total_sessions !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>

                {percent != null && (
                  <svg
                    viewBox="0 0 64 64"
                    className="size-16 shrink-0 -rotate-90"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id="progress-ring" x1="0" x2="1">
                        <stop offset="0%" stopColor="#2563ff" />
                        <stop offset="100%" stopColor="#2563ff" />
                      </linearGradient>
                    </defs>
                    <circle
                      cx="32"
                      cy="32"
                      r={ringR}
                      fill="none"
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth="6"
                    />
                    <circle
                      cx="32"
                      cy="32"
                      r={ringR}
                      fill="none"
                      stroke="url(#progress-ring)"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={ringC}
                      strokeDashoffset={ringC * (1 - Math.min(pct, 100) / 100)}
                      className="transition-[stroke-dashoffset] duration-1000"
                    />
                  </svg>
                )}
              </div>

              {/* Weekly activity bars */}
              <div>
                <div className="flex items-end gap-1.5 h-14">
                  {weeklyBars.map((bar) => (
                    <div
                      key={bar.label}
                      className={`flex-1 transition-all ${bar.active ? 'bg-primary' : 'bg-white/[0.1]'}`}
                      style={{ height: `${bar.heightPct}%` }}
                    />
                  ))}
                </div>
                <div className="flex justify-between mt-1.5">
                  {weeklyBars.map((bar) => (
                    <span
                      key={bar.label}
                      className="flex-1 text-center text-[10px] text-white/35"
                    >
                      {bar.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Series navigation */}
            {primarySeries && (
              <div
                className="border-t-2 border-white pt-4 space-y-6"
                data-testid="series-nav"
              >
                {/* Prev / Next navigation */}
                {(primarySeries.prev_book || primarySeries.next_book) && (
                  <div className="flex gap-2">
                    {primarySeries.prev_book ? (
                      <Link
                        to={`/books/${primarySeries.prev_book.id}`}
                        data-testid="prev-book-link"
                        className="group flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 border border-white/20 hover:border-white transition-colors"
                      >
                        <ChevronLeft
                          size={14}
                          className="text-white/40 shrink-0 group-hover:-translate-x-0.5 transition-transform"
                        />
                        <div className="min-w-0">
                          <p className="text-[9px] font-semibold tracking-widest text-white/35">
                            Previous
                          </p>
                          <p className="text-xs text-white/85 truncate">
                            {primarySeries.prev_book.title}
                          </p>
                        </div>
                      </Link>
                    ) : (
                      <div className="flex-1" />
                    )}
                    {primarySeries.next_book ? (
                      <Link
                        to={`/books/${primarySeries.next_book.id}`}
                        data-testid="next-book-link"
                        className="group flex-1 min-w-0 flex items-center justify-end gap-2 px-3 py-2.5 border border-white/20 hover:border-white transition-colors"
                      >
                        <div className="min-w-0 text-right">
                          <p className="text-[9px] font-semibold tracking-widest text-white/35">
                            Next
                          </p>
                          <p className="text-xs text-white/85 truncate">
                            {primarySeries.next_book.title}
                          </p>
                        </div>
                        <ChevronRight
                          size={14}
                          className="text-white/40 shrink-0 group-hover:translate-x-0.5 transition-transform"
                        />
                      </Link>
                    ) : (
                      <div className="flex-1" />
                    )}
                  </div>
                )}

                {/* Hierarchy */}
                <div>
                  <p className="text-[10px] font-semibold tracking-widest text-white/40 mb-4">
                    Navigation Tree
                  </p>
                  <div className="space-y-2">
                    {seriesAncestors.map((s, i) => {
                      const isLast = i === seriesAncestors.length - 1
                      return (
                        <div
                          key={s.id}
                          className="flex items-center gap-2 text-xs"
                          style={{ paddingLeft: `${i * 1}rem` }}
                        >
                          <span className="text-[9px] font-semibold tracking-widest text-white/30">
                            {i === 0 ? 'Collection' : 'Series'}
                          </span>
                          <ChevronRight size={11} className="text-white/20" />
                          <Link
                            to={`/series/${s.id}`}
                            className={
                              isLast
                                ? 'text-primary-400 hover:underline'
                                : 'text-white/65 hover:text-primary-400 hover:underline transition-colors'
                            }
                          >
                            {s.name}
                          </Link>
                        </div>
                      )
                    })}
                    {primarySeries.sequence != null && (
                      <div
                        className="flex items-center gap-2 text-xs"
                        style={{
                          paddingLeft: `${seriesAncestors.length * 1}rem`,
                        }}
                      >
                        <span className="text-[9px] font-semibold tracking-widest text-white/30">
                          Current
                        </span>
                        <ChevronRight size={11} className="text-white/20" />
                        <span className="text-white/85">
                          Book {primarySeries.sequence}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer: publication details */}
        {(book.date_published ||
          book.publisher ||
          book.language ||
          book.isbn ||
          book.format) && (
          <footer className="mt-16 pt-4 border-t-2 border-white">
            <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-8 gap-y-5 text-sm">
              {book.date_published && (
                <div className="flex flex-col gap-1">
                  <dt className="text-[10px] font-semibold tracking-widest text-white/35">
                    Published
                  </dt>
                  <dd className="text-white/75">{book.date_published}</dd>
                </div>
              )}
              {book.publisher && (
                <div className="flex flex-col gap-1">
                  <dt className="text-[10px] font-semibold tracking-widest text-white/35">
                    Publisher
                  </dt>
                  <dd className="text-white/75">{book.publisher}</dd>
                </div>
              )}
              {book.language && (
                <div className="flex flex-col gap-1">
                  <dt className="text-[10px] font-semibold tracking-widest text-white/35">
                    Language
                  </dt>
                  <dd className="text-white/75 uppercase">{book.language}</dd>
                </div>
              )}
              {book.isbn && (
                <div className="flex flex-col gap-1">
                  <dt className="text-[10px] font-semibold tracking-widest text-white/35">
                    ISBN
                  </dt>
                  <dd className="text-white/75 font-mono text-xs">
                    {book.isbn}
                  </dd>
                </div>
              )}
              {book.format && (
                <div className="flex flex-col gap-1">
                  <dt className="text-[10px] font-semibold tracking-widest text-white/35">
                    Format
                  </dt>
                  <dd className="text-white/75">{fmtFormat(book.format)}</dd>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <dt className="text-[10px] font-semibold tracking-widest text-white/35">
                  Last Read
                </dt>
                <dd className="text-white/75">{fmtDate(book.last_read)}</dd>
              </div>
            </dl>
          </footer>
        )}
      </div>

      {/* Modals */}
      {showEdit && (
        <EditBookModal
          book={book}
          currentSeries={seriesMemberships ?? []}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => {
            setBook(updated)
            setShowEdit(false)
          }}
          onSeriesChange={() => setSeriesRefreshKey((k) => k + 1)}
        />
      )}
      {showVerdict && (
        <VerdictModal
          book={book}
          onClose={() => setShowVerdict(false)}
          onSaved={(updated) => {
            setBook(updated)
            setShowVerdict(false)
          }}
        />
      )}
      {showDelete && (
        <DeleteBookModal
          book={book}
          onClose={() => setShowDelete(false)}
          onDeleted={() => navigate('/library')}
        />
      )}
      {showLogSession && book && (
        <LogSessionModal
          bookId={String(book.id)}
          onClose={() => setShowLogSession(false)}
          onSaved={() => {
            setShowLogSession(false)
            setSummaryKey((k) => k + 1)
            setSessionsKey((k) => k + 1)
          }}
        />
      )}
    </div>
  )
}
