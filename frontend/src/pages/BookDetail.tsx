import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  Download,
  Edit2,
  Trash2,
  ChevronRight,
  BookOpen,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Loader2,
  Upload,
  PlusCircle,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import EditBookModal from '../components/book-detail/EditBookModal'
import DeleteBookModal from '../components/book-detail/DeleteBookModal'
import LogSessionModal from '../components/book-detail/LogSessionModal'
import type { BookDetail, Shelf, ReadingSession, Highlight } from '../types'
import type { SeriesBook } from '../types/api'

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
    <div className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
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
        <span className="text-white font-black">
          {fmtDuration(session.duration ?? session.duration_seconds)}
        </span>
      </div>
    </div>
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
  const navigate = useNavigate()

  const [book, setBook] = useState<BookDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showLogSession, setShowLogSession] = useState(false)
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
            <div className="aspect-[2/3] bg-white/5 rounded-xl" />
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

  // Breadcrumb — Library → ancestor0 → … → ancestorN (direct series) → Book
  const crumbs: Array<{ to: string | null; label: string }> = [
    { to: '/library', label: 'Library' },
    ...seriesAncestors.map((s) => ({ to: `/series/${s.id}`, label: s.name })),
    { to: null, label: book.title },
  ]

  // Circular progress (conic-gradient)
  const pct = percent ?? 0
  const circularStyle = {
    background: `conic-gradient(#258cf4 ${pct}%, #1a1a1a ${pct}%)`,
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <nav
        className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase text-white/40 mb-10"
        aria-label="breadcrumb"
      >
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={10} className="text-white/20" />}
            {c.to ? (
              <Link to={c.to} className="hover:text-primary transition-colors">
                {c.label}
              </Link>
            ) : (
              <span className={i === crumbs.length - 1 ? 'text-white/70' : ''}>
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
        {/* ── Left Column ── */}
        <div className="lg:col-span-5 space-y-6 order-2 lg:order-1">
          {/* Cover */}
          <div className="relative aspect-[2/3] w-full rounded-xl overflow-hidden bg-white/5 border border-white/10 shadow-2xl shadow-primary/5">
            <img
              key={coverKey}
              src={`/api/books/${book.id}/cover`}
              alt={book.title}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
            {/* Genre + tag overlay at bottom of cover */}
            {(book.genres.length > 0 || book.tags?.length > 0) && (
              <div className="absolute bottom-0 left-0 right-0 flex flex-wrap gap-1 px-2 py-2 bg-gradient-to-t from-black/90 to-transparent pointer-events-none">
                {book.genres.map((genre) => (
                  <span
                    key={genre.id}
                    className="bg-primary/80 text-[8px] font-black tracking-widest px-1.5 py-0.5 text-white normal-case leading-tight"
                  >
                    {genre.name}
                  </span>
                ))}
                {book.tags?.map((t) => (
                  <span
                    key={t.id}
                    className="bg-amber-500/80 text-[8px] font-black tracking-widest px-1.5 py-0.5 text-white normal-case leading-tight"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            )}

            <div className="absolute bottom-2 right-2 flex gap-1.5">
              <label
                title="Upload cover image"
                className={`p-2 bg-black/60 border border-white/10 text-white/50 hover:text-white hover:border-white/30 rounded-lg transition-all cursor-pointer ${coverUploading ? 'opacity-40 pointer-events-none' : ''}`}
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
                className="p-2 bg-black/60 border border-white/10 text-white/50 hover:text-white hover:border-white/30 rounded-lg transition-all disabled:opacity-40"
              >
                {coverRefreshing ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
              </button>
            </div>
          </div>

          {/* Progress card */}
          <div
            className="bg-slate-900/60 border border-white/10 rounded-xl p-6 space-y-6"
            data-testid={percent != null ? 'reading-progress' : undefined}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
                  Book Progress
                </p>
                {percent != null ? (
                  <p className="text-3xl font-black tracking-tight">
                    {percent}%{' '}
                    <span className="text-sm font-normal text-white/40">
                      Complete
                    </span>
                  </p>
                ) : (
                  <p className="text-lg font-black tracking-tight text-white/30">
                    Not started
                  </p>
                )}
                {summary && summary.total_time_seconds > 0 && (
                  <p className="text-[10px] text-white/30 tracking-widest uppercase mt-1">
                    {fmtDuration(summary.total_time_seconds)} ·{' '}
                    {summary.total_sessions} session
                    {summary.total_sessions !== 1 ? 's' : ''}
                  </p>
                )}
              </div>

              {percent != null && (
                <div
                  className="relative size-16 rounded-full p-0.5 shrink-0"
                  style={circularStyle}
                >
                  <div className="size-full bg-black rounded-full" />
                </div>
              )}
            </div>

            {/* Weekly activity bars */}
            <div>
              <div className="flex items-end gap-1 h-14">
                {weeklyBars.map((bar) => (
                  <div
                    key={bar.label}
                    className={`flex-1 rounded-t-sm transition-all ${bar.active ? 'bg-primary/70' : 'bg-white/10'}`}
                    style={{ height: `${bar.heightPct}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-1.5">
                {weeklyBars.map((bar) => (
                  <span
                    key={bar.label}
                    className="flex-1 text-center text-[9px] font-bold uppercase tracking-tighter text-white/30"
                  >
                    {bar.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Series navigation tree */}
          {primarySeries && (
            <div
              className="bg-slate-900/60 border border-white/10 rounded-xl p-6 space-y-6"
              data-testid="series-nav"
            >
              {/* Prev / Next navigation */}
              {(primarySeries.prev_book || primarySeries.next_book) && (
                <div className="flex gap-2">
                  {primarySeries.prev_book ? (
                    <Link
                      to={`/books/${primarySeries.prev_book.id}`}
                      data-testid="prev-book-link"
                      className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded hover:border-white/20 transition-colors"
                    >
                      <ChevronRight
                        size={13}
                        className="text-white/40 shrink-0 rotate-180"
                      />
                      <div className="min-w-0">
                        <p className="text-[9px] tracking-widest uppercase text-white/30">
                          Previous
                        </p>
                        <p className="text-xs text-white/80 normal-case truncate">
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
                      className="flex-1 min-w-0 flex items-center justify-end gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded hover:border-white/20 transition-colors"
                    >
                      <div className="min-w-0 text-right">
                        <p className="text-[9px] tracking-widest uppercase text-white/30">
                          Next
                        </p>
                        <p className="text-xs text-white/80 normal-case truncate">
                          {primarySeries.next_book.title}
                        </p>
                      </div>
                      <ChevronRight
                        size={13}
                        className="text-white/40 shrink-0"
                      />
                    </Link>
                  ) : (
                    <div className="flex-1" />
                  )}
                </div>
              )}

              {/* Hierarchy */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-4">
                  Navigation Tree
                </p>
                <div className="space-y-2">
                  {/* All ancestors from root down to direct series */}
                  {seriesAncestors.map((s, i) => {
                    const isLast = i === seriesAncestors.length - 1
                    return (
                      <div
                        key={s.id}
                        className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
                        style={{ paddingLeft: `${i * 1}rem` }}
                      >
                        {i > 0 && (
                          <span className="text-white/10 border-l border-white/10 self-stretch mr-1" />
                        )}
                        <span className="text-white/30">
                          {i === 0 ? 'Collection' : 'Series'}
                        </span>
                        <ChevronRight size={10} className="text-white/20" />
                        <Link
                          to={`/series/${s.id}`}
                          className={
                            isLast
                              ? 'text-primary hover:underline'
                              : 'text-white/60 hover:text-primary hover:underline transition-colors'
                          }
                        >
                          {s.name}
                        </Link>
                      </div>
                    )
                  })}
                  {/* Current book position */}
                  {primarySeries.sequence != null && (
                    <div
                      className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
                      style={{
                        paddingLeft: `${seriesAncestors.length * 1}rem`,
                      }}
                    >
                      <span className="text-white/30">Current</span>
                      <ChevronRight size={10} className="text-white/20" />
                      <span className="text-white/80">
                        Book {primarySeries.sequence}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Series book list */}
              {seriesBooks && seriesBooks.length > 0 && (
                <div className="pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
                      Series Progress
                    </p>
                    <Link
                      to={`/series/${primarySeries.series_id}`}
                      className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline"
                    >
                      {seriesBooks.length} Books
                    </Link>
                  </div>

                  {/* Progress dots */}
                  <div className="flex gap-1 h-1 mb-4">
                    {seriesBooks.map((sb) => (
                      <div
                        key={sb.book_id}
                        className={`flex-1 rounded-full ${String(sb.book_id) === String(book.id) ? 'bg-primary' : 'bg-white/10'}`}
                      />
                    ))}
                  </div>

                  <div className="space-y-2">
                    {seriesBooks.slice(0, 5).map((sb) => {
                      const isCurrent = String(sb.book_id) === String(book.id)
                      return (
                        <Link
                          key={sb.book_id}
                          to={`/books/${sb.book_id}`}
                          className={`flex items-center gap-3 ${isCurrent ? '' : 'opacity-50 hover:opacity-100 transition-opacity'}`}
                        >
                          <div
                            className={`size-7 rounded text-[9px] font-black flex items-center justify-center shrink-0 ${isCurrent ? 'bg-primary text-white' : 'bg-white/10 text-white/50'}`}
                          >
                            {sb.sequence != null
                              ? String(sb.sequence).padStart(2, '0')
                              : '—'}
                          </div>
                          <div className="flex-1 min-w-0 border-b border-white/5 pb-2 flex items-center justify-between">
                            <span
                              className={`text-xs truncate normal-case ${isCurrent ? 'font-bold text-white' : 'font-medium text-white/70'}`}
                            >
                              {sb.title}
                            </span>
                            {isCurrent ? (
                              <CheckCircle2
                                size={13}
                                className="text-primary shrink-0 ml-2"
                              />
                            ) : (
                              <ArrowRight
                                size={13}
                                className="text-white/20 shrink-0 ml-2"
                              />
                            )}
                          </div>
                        </Link>
                      )
                    })}
                    {seriesBooks.length > 5 && (
                      <Link
                        to={`/series/${primarySeries.series_id}`}
                        className="text-[10px] text-primary hover:underline uppercase tracking-widest font-black pl-10 block pt-1"
                      >
                        +{seriesBooks.length - 5} more
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right Column ── */}
        <div className="lg:col-span-7 flex flex-col order-1 lg:order-2">
          {/* Series label */}
          {primarySeries && (
            <div className="flex items-center gap-3 mb-4">
              <span className="bg-primary/20 text-primary px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest">
                {primarySeries.sequence != null
                  ? `Book ${primarySeries.sequence}`
                  : 'Series'}
              </span>
              <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
                of {primarySeries.series_name}
              </span>
            </div>
          )}

          {/* Title + Author */}
          <div className="mb-6">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tighter text-white leading-[0.95] mb-3 uppercase">
              {book.title}
            </h1>
            {book.author && (
              <p className="text-xl font-light text-white/50 tracking-tight normal-case">
                {book.author}
              </p>
            )}
          </div>

          {/* Format / shelf / genre badges */}
          <div className="flex flex-wrap gap-2 mb-8" data-testid="book-badges">
            {book.format && (
              <span className="px-2.5 py-0.5 text-[10px] font-black tracking-widest uppercase border border-primary/40 text-primary rounded">
                {fmtFormat(book.format)}
              </span>
            )}
            {currentShelf && (
              <span className="px-2.5 py-0.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/50 rounded">
                {currentShelf.name}
              </span>
            )}
            {primarySeries && (
              <span className="px-2.5 py-0.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/40 rounded normal-case">
                {primarySeries.series_name}
                {primarySeries.sequence != null
                  ? ` #${primarySeries.sequence}`
                  : ''}
              </span>
            )}
            {book.genres.map((genre) => (
              <span
                key={genre.id}
                className="px-2.5 py-0.5 text-[10px] font-black tracking-widest bg-primary/15 border border-primary/30 text-primary rounded normal-case"
              >
                {genre.name}
              </span>
            ))}
            {book.tags?.map((t) => (
              <span
                key={t.id}
                className="px-2.5 py-0.5 text-[10px] font-black tracking-widest bg-amber-500/15 border border-amber-500/30 text-amber-400 rounded normal-case"
              >
                {t.name}
              </span>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 mb-10">
            {!book.file_path?.startsWith('manual://') && (
              <a
                href={`/api/books/${book.id}/download`}
                className="flex items-center gap-2 px-6 py-3 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 rounded-lg transition-all"
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
                  className="flex items-center gap-2 px-6 py-3 text-[10px] font-black tracking-widest uppercase bg-white/5 border border-white/10 text-white/70 hover:text-white hover:border-white/30 disabled:opacity-40 rounded-lg transition-all"
                >
                  Move Shelf
                  <ChevronRight
                    size={12}
                    className={`transition-transform ${moveOpen ? 'rotate-90' : ''}`}
                  />
                </button>
                {moveOpen && (
                  <div
                    className="absolute left-0 top-full mt-1 z-30 min-w-[160px] bg-black border border-white/20 rounded-lg shadow-xl"
                    data-testid="move-shelf-dropdown"
                  >
                    {otherShelves.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => handleMove(s.id)}
                        className="w-full text-left px-4 py-2.5 text-xs text-white/70 normal-case hover:bg-white/5 hover:text-white transition-colors"
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
              className="flex items-center gap-2 px-4 py-3 text-[10px] font-black tracking-widest uppercase border border-white/10 text-white/40 hover:text-white hover:border-white/30 rounded-lg transition-all"
            >
              <PlusCircle size={13} />
              Log Session
            </button>

            <button
              onClick={() => handleMarkRead(percent == null || percent < 100)}
              disabled={markingRead}
              data-testid="mark-read-btn"
              className={`flex items-center gap-2 px-4 py-3 text-[10px] font-black tracking-widest uppercase border rounded-lg transition-all disabled:opacity-40 ${
                percent != null && percent >= 100
                  ? 'border-primary/40 text-primary/70 hover:text-primary hover:border-primary'
                  : 'border-white/10 text-white/40 hover:text-white hover:border-white/30'
              }`}
            >
              <CheckCircle2 size={13} />
              {percent != null && percent >= 100 ? 'Unmark' : 'Mark Read'}
            </button>

            <button
              onClick={() => setShowEdit(true)}
              data-testid="edit-btn"
              className="flex items-center gap-2 px-4 py-3 text-[10px] font-black tracking-widest uppercase border border-white/10 text-white/40 hover:text-white hover:border-white/30 rounded-lg transition-all"
            >
              <Edit2 size={13} />
              Edit
            </button>

            <button
              onClick={() => setShowDelete(true)}
              data-testid="delete-btn"
              className="flex items-center gap-2 px-4 py-3 text-[10px] font-black tracking-widest uppercase border border-red-500/20 text-red-400/50 hover:text-red-400 hover:border-red-400/50 rounded-lg transition-all"
            >
              <Trash2 size={13} />
            </button>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 py-8 border-y border-white/10 mb-10">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-1">
                Series
              </p>
              <p className="text-base font-medium normal-case">
                {primarySeries?.series_name ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-1">
                Pages
              </p>
              <p className="text-base font-medium">
                {book.page_count ? book.page_count.toLocaleString() : '—'}
              </p>
            </div>
          </div>

          {/* Description */}
          {book.description && (
            <div className="mb-8">
              <h2 className="text-[10px] font-black tracking-widest uppercase text-white/40 mb-3">
                Description
              </h2>
              <p className="text-sm text-white/70 normal-case leading-relaxed">
                {book.description}
              </p>
            </div>
          )}

          {/* Highlights */}
          {highlights.length > 0 && (
            <section
              className="space-y-4 mb-8"
              data-testid="highlights-section"
            >
              <h2 className="text-sm font-black uppercase tracking-widest text-white/80">
                Recent Highlights
              </h2>
              <div className="space-y-5">
                {highlights.map((h, i) => (
                  <div
                    key={h.id}
                    className={`relative pl-5 border-l-2 ${i === 0 ? 'border-primary/50' : 'border-white/10'}`}
                  >
                    <p className="text-base leading-relaxed text-white/80 normal-case italic">
                      &ldquo;{h.text}&rdquo;
                    </p>
                    {h.note && (
                      <p className="text-sm text-primary/70 normal-case mt-1">
                        {h.note}
                      </p>
                    )}
                    {h.chapter && (
                      <div className="mt-1.5 flex gap-3 text-[10px] font-bold uppercase tracking-widest text-white/30">
                        <span>{h.chapter}</span>
                      </div>
                    )}
                  </div>
                ))}
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
              <div className="bg-white/5 border border-white/10 rounded-xl px-4">
                {sessions.slice(0, 5).map((s) => (
                  <SessionRow key={s.id} session={s} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Footer: publication details */}
      {(book.date_published ||
        book.publisher ||
        book.language ||
        book.isbn ||
        book.genres.length > 0 ||
        book.format) && (
        <footer className="mt-20 pt-8 border-t border-white/10 opacity-70">
          <div className="flex flex-wrap gap-x-12 gap-y-4 text-[10px] font-black uppercase tracking-widest">
            {book.date_published && (
              <div className="flex flex-col gap-1">
                <span className="text-white/30">Published</span>
                <span>{book.date_published}</span>
              </div>
            )}
            {book.publisher && (
              <div className="flex flex-col gap-1">
                <span className="text-white/30">Publisher</span>
                <span className="normal-case">{book.publisher}</span>
              </div>
            )}
            {book.language && (
              <div className="flex flex-col gap-1">
                <span className="text-white/30">Language</span>
                <span>{book.language}</span>
              </div>
            )}
            {book.isbn && (
              <div className="flex flex-col gap-1">
                <span className="text-white/30">ISBN</span>
                <span>{book.isbn}</span>
              </div>
            )}
            {book.genres.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-white/30">Genres</span>
                <div className="flex flex-wrap gap-1">
                  {book.genres.map((genre) => (
                    <span
                      key={genre.id}
                      className="bg-primary/15 border border-primary/30 text-[9px] font-black tracking-widest px-1.5 py-0.5 text-primary normal-case"
                    >
                      {genre.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {book.format && (
              <div className="flex flex-col gap-1">
                <span className="text-white/30">Format</span>
                <span>{fmtFormat(book.format)}</span>
              </div>
            )}
            {book.tags && book.tags.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-white/30">Tags</span>
                <div className="flex flex-wrap gap-1">
                  {book.tags.map((t) => (
                    <span
                      key={t.id}
                      className="bg-amber-500/15 border border-amber-500/30 text-[9px] font-black tracking-widest px-1.5 py-0.5 text-amber-400 normal-case"
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-white/30">Last Read</span>
              <span className="normal-case">{fmtDate(book.last_read)}</span>
            </div>
          </div>
        </footer>
      )}

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
