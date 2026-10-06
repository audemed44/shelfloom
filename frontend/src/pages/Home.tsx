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
  Search,
  Star,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { useCountUp } from '../hooks/useCountUp'
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
import { GOAL_STATUS } from '../types/goals'
import type { GoalProgress } from '../types/goals'
import { useQuickSearch } from '../components/search/QuickSearch'
import { CoverImage } from '../components/shared/CoverFallback'

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
    'absolute top-[38%] z-10 hidden sm:grid size-10 -translate-y-1/2 place-items-center bg-white text-black transition-opacity duration-200 opacity-0 group-hover/scroll:opacity-100 hover:bg-primary hover:text-white'

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
        className="stagger flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 pt-1 sm:snap-none sm:px-0 no-scrollbar"
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
// Section heading — Swiss rule with an index number
// ---------------------------------------------------------------------------

function SectionTitle({
  index,
  children,
  action,
}: {
  index: number
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="rule mb-5 flex items-baseline gap-4">
      <span className="w-6 shrink-0 text-xs font-semibold tabular-nums text-primary-400">
        {String(index).padStart(2, '0')}
      </span>
      <h4 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
        {children}
      </h4>
      {action && <div className="ml-auto flex items-center">{action}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hero — the book in progress
// ---------------------------------------------------------------------------

function HeroBook({ book }: { book: Book & { reading_progress?: number } }) {
  const progress = Math.round(book.reading_progress ?? 0)
  const cover = getBookCoverUrl(book.id, book.cover_path)
  const canRead =
    book.format === 'epub' && !book.file_path?.startsWith('manual://')
  return (
    <div
      className="group relative grid grid-cols-[auto_1fr] border border-white/[0.14] bg-white/[0.02] transition-colors hover:bg-white/[0.05]"
      data-testid="hero-book"
    >
      <Link
        to={`/books/${book.id}`}
        className="w-28 p-4 sm:w-44 sm:p-6"
        aria-label={book.title}
        tabIndex={-1}
      >
        <div className="book-cover aspect-[2/3] overflow-hidden bg-white/5">
          <CoverImage
            src={cover}
            title={book.title}
            author={book.author}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        </div>
      </Link>
      <div className="flex min-w-0 flex-col justify-between gap-4 py-4 pr-4 sm:py-6 sm:pr-8">
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-primary-400">
            Continue reading
          </p>
          <Link
            to={`/books/${book.id}`}
            className="mt-2 block text-2xl font-extrabold leading-[0.95] tracking-tighter text-white line-clamp-3 hover:underline hover:decoration-primary hover:underline-offset-4 sm:text-5xl"
          >
            {book.title}
          </Link>
          {book.author && (
            <p className="mt-2 truncate text-sm font-medium text-white/55 sm:text-base">
              {book.author}
            </p>
          )}
        </div>
        <div>
          <div className="flex items-end justify-between gap-4">
            <p className="text-4xl font-extrabold leading-none tracking-tighter tabular-nums text-white sm:text-7xl">
              <span>{progress}</span>
              <span className="text-2xl text-white/50 sm:text-4xl">%</span>
            </p>
            <Link
              to={canRead ? `/books/${book.id}/read` : `/books/${book.id}`}
              className="inline-flex shrink-0 items-center gap-2 bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-600 sm:px-4"
              data-testid="hero-book-action"
            >
              {canRead ? 'Read' : 'Open'} <ArrowRight size={14} />
            </Link>
          </div>
          <div className="mt-3 h-1 bg-white/15">
            <div
              className="h-full bg-primary transition-[width] duration-1000"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyHero() {
  return (
    <div className="flex h-full flex-col justify-between gap-8 border border-white/[0.14] p-6 sm:p-8">
      <BookOpen size={28} className="text-primary-400" />
      <div>
        <p className="text-sm font-semibold tracking-widest text-white">
          Nothing In Progress
        </p>
        <p className="mt-1 text-sm text-white/50">
          Open the library to start reading
        </p>
        <Link
          to="/library"
          className="mt-5 inline-flex items-center gap-2 bg-primary px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-primary-600"
        >
          Browse library <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat — typographic column
// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: number | null
  format?: (n: number) => string
  sub?: string
}

function StatCard({
  icon: Icon,
  label,
  value,
  format = String,
  sub,
}: StatCardProps) {
  const animated = useCountUp(value)
  const empty = value == null
  return (
    <div className="flex min-w-0 flex-col justify-between gap-4 border-t border-white/[0.14] pt-3 xl:flex-row xl:items-end">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-white/45">
          <Icon size={12} className="shrink-0" />
          <span className="truncate">{label}</span>
        </p>
        {sub && (
          <p className="mt-0.5 text-[11px] leading-tight text-white/40 sm:text-xs">
            {sub}
          </p>
        )}
      </div>
      <h5
        className={`text-2xl font-extrabold leading-none tracking-tighter tabular-nums min-[420px]:text-3xl sm:text-5xl ${empty ? 'text-white/20' : 'text-white'}`}
      >
        {animated == null ? '—' : format(animated)}
      </h5>
    </div>
  )
}

// ---------------------------------------------------------------------------
// This year's books, against the reading goal
// ---------------------------------------------------------------------------

function GoalStat({
  goal,
  completed,
}: {
  goal: GoalProgress | null
  completed: number | null
}) {
  const animated = useCountUp(completed)
  const year = new Date().getFullYear()
  const target = goal?.target ?? null
  const pct =
    target && completed != null ? Math.min(100, (completed / target) * 100) : 0
  return (
    <Link
      to={`/stats/year/${year}`}
      className="group flex min-w-0 flex-col justify-between gap-4 border-t border-white/[0.14] pt-3 xl:flex-row xl:items-end"
      data-testid="goal-stat"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-white/45">
          <Flame size={12} className="shrink-0" />
          <span className="truncate">This Year</span>
        </p>
        <p className="mt-0.5 text-[11px] leading-tight text-white/40 sm:text-xs">
          {target ? (
            <>
              {(goal?.status && GOAL_STATUS[goal.status]) ?? 'books completed'}
            </>
          ) : (
            <>
              books completed ·{' '}
              <span className="text-primary-400 group-hover:underline">
                set a goal
              </span>
            </>
          )}
        </p>
        {target != null && (
          <div className="mt-2 h-1 w-full max-w-[10rem] bg-white/15">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <h5
        className={`text-2xl font-extrabold leading-none tracking-tighter tabular-nums min-[420px]:text-3xl sm:text-5xl ${completed == null ? 'text-white/20' : 'text-white'}`}
      >
        {animated == null ? '—' : animated}
        {target != null && (
          <span className="text-base font-bold text-white/40 sm:text-2xl">
            /{target}
          </span>
        )}
      </h5>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Currently reading card
// ---------------------------------------------------------------------------

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
      <div className="book-cover aspect-[2/3] overflow-hidden bg-white/5 transition-transform duration-300 group-hover:-translate-y-1">
        <CoverImage
          src={getBookCoverUrl(book.id, book.cover_path)}
          title={book.title}
          author={book.author}
          alt={book.title}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
          <div
            className="h-full bg-primary"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      </div>
      <div className="mt-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug text-white line-clamp-2 group-hover:text-primary-300">
            {book.title}
          </p>
          {book.author && (
            <p className="mt-0.5 truncate text-xs text-white/45">
              {book.author}
            </p>
          )}
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-primary-400">
          {Math.round(progress)}%
        </span>
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Activity feed — ruled table
// ---------------------------------------------------------------------------

function ActivityFeed({ sessions }: { sessions: RecentSession[] }) {
  return (
    <div>
      {sessions.map((s, i) => (
        <Link
          key={i}
          to={`/books/${s.book_id}`}
          className="group grid grid-cols-[1fr_auto] items-center gap-4 border-b border-white/[0.1] py-3 transition-colors hover:bg-white/[0.04] sm:grid-cols-[2rem_1fr_auto_auto_auto]"
          data-testid="activity-item"
        >
          <span className="hidden text-xs tabular-nums text-white/30 sm:block">
            {String(i + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white transition-colors group-hover:text-primary-300">
              {s.title}
            </p>
            {s.author && (
              <p className="truncate text-xs text-white/40">{s.author}</p>
            )}
          </div>
          <span className="hidden w-12 text-right text-xs tabular-nums text-white/40 sm:block">
            {s.pages_read != null && s.pages_read > 0 ? `${s.pages_read}p` : ''}
          </span>
          <div className="flex items-center gap-4 sm:contents">
            <span className="w-14 text-right text-sm font-semibold tabular-nums text-white">
              {fmtDuration(s.duration)}
            </span>
            <span className="w-14 text-right text-xs text-white/40">
              {timeAgo(s.start_time)}
            </span>
          </div>
        </Link>
      ))}
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
          <div className="book-cover aspect-[2/3] overflow-hidden bg-white/5 transition-transform duration-300 group-hover:-translate-y-1">
            <img
              src={`/api/serials/${serial.id}/cover`}
              alt={serial.title ?? 'Serial'}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
            {hasNew && (
              <div className="absolute left-2 top-2">
                <span className="relative inline-flex items-center gap-1.5 bg-primary px-2 py-1 text-[10px] font-bold text-white">
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
                <span className="bg-accent px-2 py-1 text-[10px] font-bold text-white">
                  ERROR
                </span>
              </div>
            )}
            {/* Thin fetched-progress bar along the bottom edge */}
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
              <div
                className="h-full bg-primary"
                style={{ width: `${fetchedPct}%` }}
              />
            </div>
          </div>
        </Link>
      </div>
      <div className="mt-2.5 flex items-start justify-between gap-2">
        <Link to={`/serials/${serial.id}`} className="min-w-0">
          <p className="text-sm font-semibold leading-snug text-white line-clamp-2 group-hover:text-primary-300">
            {serial.title}
          </p>
          {serial.author && (
            <p className="mt-0.5 truncate text-xs text-white/45">
              {serial.author}
            </p>
          )}
        </Link>
        <button
          type="button"
          onClick={() => onFetchPending(serial.id)}
          aria-label={`Fetch pending chapters for ${serial.title ?? 'serial'}`}
          title="Fetch pending chapters"
          disabled={fetchPendingDisabled}
          className="grid size-8 shrink-0 place-items-center border border-white/25 text-white/80 transition-colors hover:border-primary hover:bg-primary hover:text-white disabled:opacity-40"
        >
          {isFetchingPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Download size={13} />
          )}
        </button>
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-1.5 text-[11px] leading-tight text-white/50 tabular-nums">
        <span>
          {serial.fetched_count}/{serial.total_chapters} fetched
        </span>
        {serial.stubbed_chapter_count > 0 && (
          <span className="text-accent">
            · {serial.stubbed_chapter_count} stubbed
          </span>
        )}
      </p>
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

  const { data: pendingVerdicts } = useApi<
    { id: string; title: string; cover_path: string | null }[]
  >('/api/stats/pending-verdicts')
  const { data: goal } = useApi<GoalProgress>(
    `/api/stats/goal/${new Date().getFullYear()}`
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

  const { open: openSearch } = useQuickSearch()
  const iconButton =
    'grid size-8 place-items-center border border-white/20 text-white/70 transition-colors hover:border-primary hover:bg-primary hover:text-white disabled:opacity-50'
  const heroBook = currentlyReading[0]
  let section = 0
  const next = () => ++section

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12 lg:py-10">
      {/* Header */}
      <header className="mb-10 grid grid-cols-12 gap-4 animate-fade-up sm:mb-14">
        <div className="col-span-12 lg:col-span-9">
          <h1 className="text-[3.25rem] font-extrabold leading-[0.9] tracking-tighter sm:text-8xl">
            {greeting()}
            <span className="text-primary">.</span>
            <span className="sr-only"> — Dashboard</span>
          </h1>
        </div>
        <div className="col-span-12 flex flex-col justify-end gap-1 lg:col-span-3 lg:border-l lg:border-white/[0.14] lg:pl-4">
          <p className="text-[10px] font-semibold tracking-widest text-white/45">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <p className="text-sm text-white/60">
            Welcome back, reader. Your library awaits.
          </p>
        </div>
        {/* Phones have no sidebar, so give search a prominent entry point */}
        <button
          onClick={openSearch}
          className="col-span-12 flex items-center gap-3 border border-white/25 px-4 py-3 text-left text-sm text-white/50 sm:hidden"
          data-testid="home-search"
        >
          <Search size={16} className="text-primary-400" />
          Search books, series, genres…
        </button>
      </header>

      <div className="stagger grid grid-cols-12 gap-x-6 gap-y-12 lg:gap-x-8 lg:gap-y-16">
        {/* Hero */}
        <section className="col-span-12 xl:col-span-8">
          {heroBook ? <HeroBook book={heroBook} /> : <EmptyHero />}
        </section>

        {/* Stats */}
        <section className="col-span-12 grid grid-cols-3 gap-4 xl:col-span-4 xl:grid-cols-1 xl:gap-6">
          <StatCard
            icon={Clock}
            label="This Week"
            value={thisWeekSeconds > 0 ? thisWeekSeconds : null}
            format={fmtDuration}
            sub="reading time"
          />
          <StatCard
            icon={BookOpen}
            label="This Week"
            value={thisWeekPages > 0 ? thisWeekPages : null}
            sub="pages read"
          />
          <GoalStat
            goal={goal ?? null}
            completed={
              completedBooks !== undefined ? booksCompletedThisYear : null
            }
          />
        </section>

        {/* Finished books still waiting for a rating */}
        {pendingVerdicts && pendingVerdicts.length > 0 && (
          <section className="col-span-12">
            <Link
              to="/verdicts"
              className="group flex items-center gap-4 border border-white/[0.14] px-4 py-3 transition-colors hover:border-white sm:px-5"
              data-testid="pending-verdicts"
            >
              <div className="hidden shrink-0 -space-x-3 sm:flex" aria-hidden>
                {pendingVerdicts.slice(0, 4).map((b) => (
                  <img
                    key={b.id}
                    src={getBookCoverUrl(b.id, b.cover_path)}
                    alt=""
                    loading="lazy"
                    className="h-12 w-8 border border-black bg-white/5 object-cover"
                  />
                ))}
              </div>
              <Star size={16} className="shrink-0 text-primary-400 sm:hidden" />
              <p className="min-w-0 flex-1 text-sm text-white/70">
                <span className="font-semibold text-white">
                  {pendingVerdicts.length} finished{' '}
                  {pendingVerdicts.length === 1 ? 'book needs' : 'books need'}{' '}
                  your verdict.
                </span>{' '}
                <span className="hidden sm:inline">
                  Rate them one after another.
                </span>
              </p>
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-primary-400 group-hover:text-white">
                Rate <ArrowRight size={13} />
              </span>
            </Link>
          </section>
        )}

        {/* Currently Reading */}
        {currentlyReading.length > 0 && (
          <section className="col-span-12">
            <SectionTitle
              index={next()}
              action={
                <span className="text-sm font-semibold tabular-nums text-white/40">
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
              index={next()}
              action={
                <div className="flex items-center gap-2">
                  {pendingBatchStatus &&
                    pendingBatchStatus.state !== 'idle' && (
                      <span className="mr-2 text-[10px] tracking-widest uppercase text-white/40">
                        {pendingBatchStatus.processed_serials}/
                        {pendingBatchStatus.total_serials} processed
                      </span>
                    )}
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
          <SectionTitle index={next()}>Reading Activity</SectionTitle>
          <ReadingHeatmap
            data={heatmapData ?? []}
            year={CURRENT_YEAR}
            streak={streak}
            bare
          />
        </section>

        {/* Recent activity */}
        {activitySessions.length > 0 && (
          <section className="col-span-12 2xl:col-span-5">
            <SectionTitle index={next()}>Recent Activity</SectionTitle>
            <ActivityFeed sessions={activitySessions} />
          </section>
        )}

        {/* Status row */}
        <section className="col-span-12">
          <div className="grid grid-cols-2 gap-4 border-t-2 border-white pt-3 sm:grid-cols-4">
            <span className="text-xs font-semibold text-white/60">
              {overview
                ? `${overview.books_owned} books in library`
                : 'Loading…'}
            </span>
            {overview && (
              <span className="text-xs font-semibold text-white/60">
                {`${overview.books_read} completed`}
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
