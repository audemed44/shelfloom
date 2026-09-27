import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock,
  BookOpen,
  Flame,
  RefreshCw,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ArrowRight,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { ReadingHeatmap } from '../components/ReadingHeatmap'
import type { PaginatedResponse } from '../types'
import type { Book, SerialDashboardEntry } from '../types'
import type { LucideIcon } from 'lucide-react'
import type { HeatmapEntry } from '../components/ReadingHeatmap'
import type {
  PendingChapterBatchStatusResponse,
  PendingChapterFetchResponse,
} from '../types/api'
import { getBookCoverUrl } from '../utils/bookCover'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatsOverview {
  books_owned: number
  books_read: number
  total_reading_time_seconds: number
  total_pages_read: number
  current_streak_days: number
}

interface TimeSeriesEntry {
  date: string
  value: number
}

interface RecentSession {
  book_id: string
  title: string
  author: string | null
  duration: number
  pages_read: number | null
  start_time: string
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function fmtDuration(seconds: number): string {
  if (!seconds) return '0m'
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`
}

function timeAgo(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

const CURRENT_YEAR = new Date().getFullYear()

const WEEK_START = (() => {
  const now = new Date()
  const day = now.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() + diff)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
})()

// ---------------------------------------------------------------------------
// Motion helpers
// ---------------------------------------------------------------------------

function prefersMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Animates a number from 0 → target once it becomes known. */
function useCountUp(target: number | null, durationMs = 900): number | null {
  const [value, setValue] = useState<number | null>(
    target == null || !prefersMotion() ? target : 0
  )

  useEffect(() => {
    if (target == null) {
      setValue(null)
      return
    }
    if (!prefersMotion() || typeof requestAnimationFrame === 'undefined') {
      setValue(target)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs])

  return value
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Late night reading'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

// ---------------------------------------------------------------------------
// Scroll row with arrow buttons
// ---------------------------------------------------------------------------

function ScrollRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateArrows = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    updateArrows()
    const el = ref.current
    if (!el) return
    el.addEventListener('scroll', updateArrows, { passive: true })
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateArrows)
      ro.observe(el)
    }
    return () => {
      el.removeEventListener('scroll', updateArrows)
      ro?.disconnect()
    }
  }, [updateArrows])

  const scroll = (dir: 'left' | 'right') => {
    const el = ref.current
    if (!el) return
    const cardWidth = el.querySelector(':scope > *')?.clientWidth ?? 200
    const gap = 16
    el.scrollBy({
      left: dir === 'left' ? -(cardWidth + gap) * 2 : (cardWidth + gap) * 2,
      behavior: 'smooth',
    })
  }

  const arrowClass =
    'absolute top-[38%] z-10 hidden sm:grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-ink-850/90 text-white shadow-lift backdrop-blur transition-all duration-300 opacity-0 group-hover/scroll:opacity-100 hover:bg-primary hover:border-primary'

  return (
    <div className="relative group/scroll -mx-4 sm:mx-0">
      {canScrollLeft && (
        <button
          onClick={() => scroll('left')}
          className={`${arrowClass} left-1`}
          aria-label="Scroll left"
        >
          <ChevronLeft size={18} />
        </button>
      )}
      <div
        ref={ref}
        className="stagger flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 pt-1 sm:snap-none sm:px-0 no-scrollbar"
      >
        {children}
      </div>
      {canScrollRight && (
        <button
          onClick={() => scroll('right')}
          className={`${arrowClass} right-1`}
          aria-label="Scroll right"
        >
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  )
}

const ROW_ITEM_CLASS =
  'w-[42%] snap-start sm:w-[calc(33.333%-11px)] md:w-[calc(25%-12px)] lg:w-[calc(20%-13px)] xl:w-[calc(16.667%-14px)] flex-shrink-0'

// ---------------------------------------------------------------------------
// Section heading
// ---------------------------------------------------------------------------

function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h4 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-white">
        {children}
      </h4>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function HeroBook({ book }: { book: Book & { reading_progress?: number } }) {
  const progress = Math.round(book.reading_progress ?? 0)
  const cover = getBookCoverUrl(book.id, book.cover_path)
  return (
    <Link
      to={`/books/${book.id}`}
      className="group relative block overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-850"
      data-testid="hero-book"
    >
      {/* Blurred cover wash */}
      <div
        className="absolute inset-0 scale-125 bg-cover bg-center opacity-40 blur-3xl saturate-150 transition-transform duration-[2s] group-hover:scale-150"
        style={{ backgroundImage: `url("${cover}")` }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-ink-900 via-ink-900/85 to-ink-900/30" />

      <div className="relative flex items-center gap-5 p-5 sm:gap-8 sm:p-8">
        <div className="w-24 shrink-0 sm:w-36 animate-float [--tilt:-3deg]">
          <div className="book-cover aspect-[2/3] overflow-hidden rounded-lg bg-white/5 transition-transform duration-500 group-hover:scale-[1.04]">
            <img
              src={cover}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-widest text-primary-300">
            Pick up where you left off
          </p>
          <p className="mt-2 font-display text-2xl font-semibold leading-tight text-white line-clamp-2 sm:text-4xl">
            {book.title}
          </p>
          {book.author && (
            <p className="mt-1 text-sm text-white/55 truncate sm:text-base">
              {book.author}
            </p>
          )}
          <div className="mt-5 max-w-sm">
            <div className="mb-1.5 flex justify-between text-xs text-white/50">
              <span>{progress}% complete</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary-400 via-primary to-accent-rose transition-[width] duration-1000"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-ink-900 transition-transform duration-300 group-hover:translate-x-1">
            <BookOpen size={14} />
            Continue reading
            <ArrowRight size={14} />
          </span>
        </div>
      </div>
    </Link>
  )
}

function EmptyHero() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-primary/15 via-ink-850 to-accent-rose/10 p-8 sm:p-10">
      <div className="flex flex-col items-center gap-6 sm:flex-row">
        <div className="relative h-28 w-32 shrink-0" aria-hidden="true">
          {[
            'left-0 bg-primary/70 [--tilt:-8deg]',
            'left-8 bg-accent-rose/70 [--tilt:4deg] [animation-delay:-2s]',
            'left-16 bg-accent/70 [--tilt:-2deg] [animation-delay:-4s]',
          ].map((c) => (
            <div
              key={c}
              className={`absolute top-0 h-28 w-16 rounded-md shadow-card animate-float ${c}`}
            />
          ))}
        </div>
        <div className="text-center sm:text-left">
          <p className="text-sm font-semibold tracking-widest text-white/70">
            Nothing In Progress
          </p>
          <p className="mt-1 text-sm text-white/45">
            Open the library to start reading
          </p>
          <Link
            to="/library"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white shadow-glow transition-transform hover:-translate-y-0.5"
          >
            Browse library <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: number | null
  format?: (n: number) => string
  sub?: string
  tint: string
}

function StatCard({
  icon: Icon,
  label,
  value,
  format = String,
  sub,
  tint,
}: StatCardProps) {
  const animated = useCountUp(value)
  const empty = value == null
  return (
    <div className="group surface relative overflow-hidden p-3.5 sm:p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/15">
      <div
        className={`absolute -right-8 -top-8 size-28 rounded-full opacity-25 blur-2xl transition-opacity duration-500 group-hover:opacity-50 ${tint}`}
        aria-hidden="true"
      />
      <div className="relative flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:gap-4">
        <div
          className={`grid size-9 sm:size-11 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white ring-1 ring-white/10`}
        >
          <Icon size={19} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-widest text-white/40">
            {label}
          </p>
          <h5
            className={`font-display text-xl sm:text-3xl font-semibold leading-tight tabular-nums ${empty ? 'text-white/20' : 'text-white'}`}
          >
            {animated == null ? '—' : format(animated)}
          </h5>
          {sub && (
            <p className="text-[11px] sm:text-xs text-white/40 leading-tight">
              {sub}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Currently reading card
// ---------------------------------------------------------------------------

function ProgressRing({ value }: { value: number }) {
  const r = 14
  const c = 2 * Math.PI * r
  return (
    <div className="relative grid size-10 place-items-center rounded-full bg-black/70 backdrop-blur">
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="3"
        />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="#8b7cff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(100, value) / 100)}
        />
      </svg>
      <span className="relative text-[9px] font-bold text-white">
        {Math.round(value)}%
      </span>
    </div>
  )
}

function CurrentlyReadingCard({
  book,
}: {
  book: Book & { reading_progress?: number }
}) {
  const progress = book.reading_progress ?? 0
  return (
    <Link
      to={`/books/${book.id}`}
      className="group block"
      data-testid="currently-reading-card"
    >
      <div className="book-cover aspect-[2/3] overflow-hidden rounded-xl bg-white/5 transition-all duration-500 ease-out group-hover:-translate-y-1.5 group-hover:shadow-lift">
        <img
          src={getBookCoverUrl(book.id, book.cover_path)}
          alt={book.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
        <div className="absolute right-2 top-2">
          <ProgressRing value={progress} />
        </div>
      </div>
      <div className="mt-3 px-0.5">
        <p className="text-sm font-semibold leading-snug text-white/90 line-clamp-2 group-hover:text-white">
          {book.title}
        </p>
        {book.author && (
          <p className="mt-0.5 truncate text-xs text-white/45">{book.author}</p>
        )}
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

function ActivityFeed({ sessions }: { sessions: RecentSession[] }) {
  return (
    <div className="surface p-5 sm:p-6">
      <h4 className="mb-4 font-display text-xl font-semibold text-white">
        Recent Activity
      </h4>
      <div className="relative">
        <div className="absolute bottom-3 left-[19px] top-3 w-px bg-gradient-to-b from-primary/50 via-white/10 to-transparent" />
        {sessions.map((s, i) => (
          <Link
            key={i}
            to={`/books/${s.book_id}`}
            className="group relative flex items-center gap-4 rounded-xl py-2.5 pl-1 pr-2 transition-colors hover:bg-white/[0.04]"
            data-testid="activity-item"
          >
            <div className="relative z-10 size-9 shrink-0 overflow-hidden rounded-lg bg-ink-700 ring-2 ring-ink-850">
              <img
                src={getBookCoverUrl(s.book_id)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-white/85 transition-colors group-hover:text-primary-300">
                {s.title}
              </p>
              {s.author && (
                <p className="truncate text-xs text-white/35">{s.author}</p>
              )}
            </div>
            <div className="ml-2 flex shrink-0 items-center gap-3 sm:gap-4">
              {s.pages_read != null && s.pages_read > 0 && (
                <span className="hidden text-xs text-white/35 sm:inline">
                  {s.pages_read}p
                </span>
              )}
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs font-semibold text-white/75">
                {fmtDuration(s.duration)}
              </span>
              <span className="w-14 text-right text-xs text-white/35">
                {timeAgo(s.start_time)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New chapters card
// ---------------------------------------------------------------------------

function NewChaptersCard({
  serial,
  onFetchPending,
  fetchPendingDisabled,
  fetchPendingLoading,
}: {
  serial: SerialDashboardEntry
  onFetchPending: (serialId: number) => void
  fetchPendingDisabled: boolean
  fetchPendingLoading: boolean
}) {
  const hasNew = serial.new_chapter_count > 0
  const isFetchingPending =
    fetchPendingLoading || serial.fetch_state === 'running'
  const fetchedPct =
    serial.total_chapters > 0
      ? Math.round((serial.fetched_count / serial.total_chapters) * 100)
      : 0

  return (
    <div className="group block" data-testid="new-chapters-card">
      <div className="relative">
        <Link to={`/serials/${serial.id}`} className="block">
          <div className="book-cover aspect-[2/3] overflow-hidden rounded-xl bg-white/5 transition-all duration-500 ease-out group-hover:-translate-y-1.5 group-hover:shadow-lift">
            <img
              src={`/api/serials/${serial.id}/cover`}
              alt={serial.title ?? 'Serial'}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
            {hasNew && (
              <div className="absolute left-2 top-2">
                <span className="relative inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white shadow-glow">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                  </span>
                  +{serial.new_chapter_count} NEW
                </span>
              </div>
            )}
            {serial.status === 'error' && (
              <div className="absolute right-2 top-2">
                <span className="rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold text-white">
                  ERROR
                </span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-2.5 pb-2.5 pt-8">
              <div className="flex flex-wrap gap-1 pr-10 text-[10px] leading-tight text-white/80">
                <span>{serial.total_chapters} ch</span>
                <span className="text-white/30">·</span>
                <span>
                  {serial.fetched_count}/{serial.total_chapters} fetched
                </span>
                {serial.stubbed_chapter_count > 0 && (
                  <span className="text-amber-300">
                    {serial.stubbed_chapter_count} stubbed
                  </span>
                )}
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/15 mr-10">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${fetchedPct}%` }}
                />
              </div>
            </div>
          </div>
        </Link>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onFetchPending(serial.id)
          }}
          aria-label={`Fetch pending chapters for ${serial.title ?? 'serial'}`}
          title="Fetch pending chapters"
          disabled={fetchPendingDisabled}
          className="absolute bottom-2 right-2 z-10 grid size-8 place-items-center rounded-full border border-white/15 bg-black/70 text-white/70 backdrop-blur transition-all hover:border-primary hover:bg-primary hover:text-white disabled:opacity-40"
        >
          {isFetchingPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Download size={13} />
          )}
        </button>
      </div>
      <div className="mt-3 px-0.5">
        <p className="text-sm font-semibold leading-snug text-white/90 line-clamp-2">
          {serial.title}
        </p>
        {serial.author && (
          <p className="mt-0.5 truncate text-xs text-white/45">
            {serial.author}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const { data: booksData } = useApi<
    PaginatedResponse<Book & { reading_progress?: number }>
  >('/api/books?status=reading&sort=last_read&per_page=200')

  const { data: overview } = useApi<StatsOverview>('/api/stats/overview')

  const { data: heatmapData } = useApi<HeatmapEntry[]>(
    `/api/stats/heatmap?year=${CURRENT_YEAR}`
  )

  const { data: weekTimeData } = useApi<TimeSeriesEntry[]>(
    `/api/stats/reading-time?granularity=day&from=${encodeURIComponent(WEEK_START)}`
  )

  const { data: weekPagesData } = useApi<TimeSeriesEntry[]>(
    `/api/stats/pages?granularity=day&from=${encodeURIComponent(WEEK_START)}`
  )

  const { data: recentSessions } = useApi<RecentSession[]>(
    '/api/stats/recent-sessions?limit=10'
  )

  const { data: completedBooks } = useApi<{ completed_at: string }[]>(
    '/api/stats/books-completed'
  )

  const [serialRefreshKey, setSerialRefreshKey] = useState(0)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [fetchingPendingAll, setFetchingPendingAll] = useState(false)
  const [fetchingPendingSerialId, setFetchingPendingSerialId] = useState<
    number | null
  >(null)

  const { data: serialsDashboard } = useApi<SerialDashboardEntry[]>(
    `/api/serials/dashboard?_k=${serialRefreshKey}`
  )
  const [batchStatusRefreshKey, setBatchStatusRefreshKey] = useState(0)
  const { data: pendingBatchStatus } =
    useApi<PendingChapterBatchStatusResponse>(
      `/api/serials/fetch-pending-status?_k=${batchStatusRefreshKey}`
    )

  const handleCheckUpdates = useCallback(async () => {
    setCheckingUpdates(true)
    try {
      await api.post('/api/serials/check-updates')
      setSerialRefreshKey((k) => k + 1)
    } catch {
      // ignore
    } finally {
      setCheckingUpdates(false)
    }
  }, [])

  const refreshSerialDashboard = useCallback(() => {
    setSerialRefreshKey((k) => k + 1)
    setBatchStatusRefreshKey((k) => k + 1)
  }, [])

  const handleFetchAllPending = useCallback(async () => {
    setFetchingPendingAll(true)
    try {
      await api.post<PendingChapterBatchStatusResponse>(
        '/api/serials/fetch-pending'
      )
      refreshSerialDashboard()
    } catch {
      // ignore
    } finally {
      setFetchingPendingAll(false)
    }
  }, [refreshSerialDashboard])

  const handleFetchPendingSerial = useCallback(
    async (serialId: number) => {
      setFetchingPendingSerialId(serialId)
      try {
        await api.post<PendingChapterFetchResponse>(
          `/api/serials/${serialId}/chapters/fetch-pending`
        )
        refreshSerialDashboard()
      } catch {
        // ignore
      } finally {
        setFetchingPendingSerialId((current) =>
          current === serialId ? null : current
        )
      }
    },
    [refreshSerialDashboard]
  )

  useEffect(() => {
    if (pendingBatchStatus?.state !== 'running') return

    const intervalId = window.setInterval(() => {
      refreshSerialDashboard()
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [pendingBatchStatus?.state, refreshSerialDashboard])

  const currentlyReading = booksData?.items ?? []
  const streak = overview?.current_streak_days ?? 0
  const thisWeekSeconds = weekTimeData?.reduce((a, b) => a + b.value, 0) ?? 0
  const thisWeekPages = weekPagesData?.reduce((a, b) => a + b.value, 0) ?? 0
  const activitySessions = useMemo(
    () => (recentSessions ?? []).slice(0, 5),
    [recentSessions]
  )
  const booksCompletedThisYear = useMemo(
    () =>
      (completedBooks ?? []).filter((b) =>
        b.completed_at?.startsWith(String(CURRENT_YEAR))
      ).length,
    [completedBooks]
  )
  const batchRunning = pendingBatchStatus?.state === 'running'

  const iconButton =
    'grid size-8 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition-all hover:border-primary/50 hover:text-white disabled:opacity-50'
  const heroBook = currentlyReading[0]

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12 lg:py-10">
      {/* Header */}
      <header className="mb-8 animate-fade-up sm:mb-10">
        <p className="text-[11px] font-semibold tracking-widest text-white/40">
          {new Date().toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </p>
        <h1 className="mt-2 text-4xl font-semibold leading-[1.05] sm:text-6xl">
          <span className="text-gradient animate-gradient-pan">
            {greeting()}
          </span>
          <span className="sr-only"> — Dashboard</span>
        </h1>
        <p className="mt-3 text-base text-white/50 sm:text-lg">
          Welcome back, reader. Your library awaits.
        </p>
      </header>

      <div className="stagger grid grid-cols-12 gap-6 lg:gap-8">
        {/* Hero */}
        <section className="col-span-12 xl:col-span-8">
          {heroBook ? <HeroBook book={heroBook} /> : <EmptyHero />}
        </section>

        {/* Stat cards */}
        <section className="col-span-12 grid grid-cols-3 gap-2.5 sm:gap-4 xl:col-span-4 xl:grid-cols-1">
          <StatCard
            icon={Clock}
            label="This Week"
            value={thisWeekSeconds > 0 ? thisWeekSeconds : null}
            format={fmtDuration}
            sub="reading time"
            tint="bg-primary"
          />
          <StatCard
            icon={BookOpen}
            label="This Week"
            value={thisWeekPages > 0 ? thisWeekPages : null}
            sub="pages read"
            tint="bg-accent-teal"
          />
          <StatCard
            icon={Flame}
            label="This Year"
            value={completedBooks !== undefined ? booksCompletedThisYear : null}
            sub="books completed"
            tint="bg-accent"
          />
        </section>

        {/* Currently Reading */}
        {currentlyReading.length > 0 && (
          <section className="col-span-12">
            <SectionTitle
              action={
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-white/50">
                  {currentlyReading.length}
                </span>
              }
            >
              Currently Reading
            </SectionTitle>
            <ScrollRow>
              {currentlyReading.map((book) => (
                <div key={book.id} className={ROW_ITEM_CLASS}>
                  <CurrentlyReadingCard book={book} />
                </div>
              ))}
            </ScrollRow>
          </section>
        )}

        {/* New Chapters */}
        {serialsDashboard && serialsDashboard.length > 0 && (
          <section className="col-span-12">
            <SectionTitle
              action={
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleFetchAllPending}
                    disabled={batchRunning || fetchingPendingAll}
                    aria-label="Fetch all pending chapters"
                    title="Fetch all pending chapters"
                    className={iconButton}
                  >
                    {batchRunning || fetchingPendingAll ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                  </button>
                  <button
                    onClick={handleCheckUpdates}
                    disabled={checkingUpdates}
                    className={iconButton}
                    title="Check for new chapters"
                  >
                    <RefreshCw
                      size={14}
                      className={checkingUpdates ? 'animate-spin' : ''}
                    />
                  </button>
                  {pendingBatchStatus &&
                    pendingBatchStatus.state !== 'idle' && (
                      <span className="text-[10px] tracking-widest uppercase text-white/35">
                        {pendingBatchStatus.processed_serials}/
                        {pendingBatchStatus.total_serials} processed
                      </span>
                    )}
                </div>
              }
            >
              Web Serials
            </SectionTitle>
            <ScrollRow>
              {serialsDashboard.map((serial) => (
                <div key={serial.id} className={ROW_ITEM_CLASS}>
                  <NewChaptersCard
                    serial={serial}
                    onFetchPending={handleFetchPendingSerial}
                    fetchPendingDisabled={
                      batchRunning ||
                      serial.fetch_state === 'running' ||
                      fetchingPendingSerialId === serial.id
                    }
                    fetchPendingLoading={fetchingPendingSerialId === serial.id}
                  />
                </div>
              ))}
            </ScrollRow>
          </section>
        )}

        {/* Heatmap */}
        <section
          className={`col-span-12 ${activitySessions.length > 0 ? '2xl:col-span-7' : ''}`}
        >
          <ReadingHeatmap
            data={heatmapData ?? []}
            year={CURRENT_YEAR}
            streak={streak}
          />
        </section>

        {/* Recent activity */}
        {activitySessions.length > 0 && (
          <section className="col-span-12 2xl:col-span-5">
            <ActivityFeed sessions={activitySessions} />
          </section>
        )}

        {/* Status row */}
        <section className="col-span-12">
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.07] pt-5">
            <div className="flex gap-3">
              <span className="rounded-full bg-white/[0.05] px-3 py-1 text-xs text-white/50">
                {overview
                  ? `${overview.books_owned} books in library`
                  : 'Loading…'}
              </span>
              {overview && (
                <span className="rounded-full bg-white/[0.05] px-3 py-1 text-xs text-white/50">
                  {`${overview.books_read} completed`}
                </span>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
