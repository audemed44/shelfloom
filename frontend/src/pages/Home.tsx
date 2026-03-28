import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock,
  BookOpen,
  Flame,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { ReadingHeatmap } from '../components/ReadingHeatmap'
import type { PaginatedResponse } from '../types'
import type { Book, SerialDashboardEntry } from '../types'
import type { LucideIcon } from 'lucide-react'
import type { HeatmapEntry } from '../components/ReadingHeatmap'

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

  return (
    <div className="relative group/scroll">
      {canScrollLeft && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center bg-gradient-to-r from-black to-transparent opacity-0 group-hover/scroll:opacity-100 transition-opacity"
        >
          <ChevronLeft size={20} className="text-white" />
        </button>
      )}
      <div
        ref={ref}
        className="flex gap-3 sm:gap-4 overflow-x-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        {children}
      </div>
      {canScrollRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center bg-gradient-to-l from-black to-transparent opacity-0 group-hover/scroll:opacity-100 transition-opacity"
        >
          <ChevronRight size={20} className="text-white" />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: string | null
  sub?: string
}

function StatCard({ icon: Icon, label, value, sub }: StatCardProps) {
  const empty = !value
  return (
    <div className="bg-white/5 border border-white/10 p-6 flex items-center gap-6">
      <div className="w-12 h-12 bg-primary/20 flex items-center justify-center text-primary shrink-0">
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-white/40 text-[10px] font-black tracking-widest">
          {label}
        </p>
        <h5
          className={`text-3xl font-black leading-tight ${empty ? 'text-white/20' : 'text-white'}`}
        >
          {value ?? '—'}
        </h5>
        {sub && (
          <p className="text-[10px] text-white/30 normal-case mt-0.5">{sub}</p>
        )}
      </div>
    </div>
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
      <div className="aspect-[2/3] bg-white/5 border border-white/10 group-hover:border-primary transition-colors overflow-hidden relative">
        <img
          src={`/api/books/${book.id}/cover`}
          alt={book.title}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
        <div className="absolute top-2 right-2">
          <span className="bg-black/70 text-[9px] font-black tracking-widest px-1.5 py-0.5 text-white/50">
            {Math.round(progress)}%
          </span>
        </div>
        {progress > 0 && progress < 100 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
      <div className="mt-2 px-0.5">
        <p className="text-sm font-black tracking-tighter leading-tight line-clamp-2">
          {book.title}
        </p>
        {book.author && (
          <p className="text-xs text-white/40 mt-0.5 normal-case truncate">
            {book.author}
          </p>
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
    <div className="bg-white/5 border border-white/10 p-6">
      <h4 className="text-xs font-black tracking-widest text-white mb-4">
        Recent Activity
      </h4>
      <div>
        {sessions.map((s, i) => (
          <Link
            key={i}
            to={`/books/${s.book_id}`}
            className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0 hover:text-primary transition-colors group"
            data-testid="activity-item"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white/80 normal-case truncate group-hover:text-primary transition-colors">
                {s.title}
              </p>
              {s.author && (
                <p className="text-[10px] text-white/30 normal-case truncate">
                  {s.author}
                </p>
              )}
            </div>
            <div className="flex items-center gap-4 shrink-0 ml-4">
              {s.pages_read != null && s.pages_read > 0 && (
                <span className="text-[10px] text-white/30 font-bold">
                  {s.pages_read}p
                </span>
              )}
              <span className="text-xs font-black text-white/60">
                {fmtDuration(s.duration)}
              </span>
              <span className="text-[10px] text-white/30 font-bold w-14 text-right">
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

function NewChaptersCard({ serial }: { serial: SerialDashboardEntry }) {
  const hasNew = serial.new_chapter_count > 0
  return (
    <Link
      to={`/serials/${serial.id}`}
      className="group block"
      data-testid="new-chapters-card"
    >
      <div className="aspect-[2/3] bg-white/5 border border-white/10 group-hover:border-primary transition-colors overflow-hidden relative">
        <img
          src={`/api/serials/${serial.id}/cover`}
          alt={serial.title ?? 'Serial'}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
        {/* New chapters badge */}
        {hasNew && (
          <div className="absolute top-2 left-2">
            <span className="bg-primary text-[9px] font-black tracking-widest px-1.5 py-0.5 text-white">
              +{serial.new_chapter_count} NEW
            </span>
          </div>
        )}
        {/* Status badge */}
        <div className="absolute top-2 right-2">
          <span className="bg-black/70 text-[9px] font-black tracking-widest px-1.5 py-0.5 text-white/50">
            {serial.status.toUpperCase()}
          </span>
        </div>
        {/* Bottom badges: chapter count + fetched progress */}
        <div className="absolute bottom-0 left-0 right-0 flex flex-wrap gap-1 px-2 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
          <span className="bg-white/20 text-[8px] font-black tracking-widest px-1.5 py-0.5 text-white normal-case leading-tight">
            {serial.total_chapters} ch
          </span>
          <span className="bg-white/20 text-[8px] font-black tracking-widest px-1.5 py-0.5 text-white normal-case leading-tight">
            {serial.fetched_count}/{serial.total_chapters} fetched
          </span>
        </div>
      </div>
      <div className="mt-2 px-0.5">
        <p className="text-sm font-black tracking-tighter leading-tight line-clamp-2">
          {serial.title}
        </p>
        {serial.author && (
          <p className="text-xs text-white/40 mt-0.5 normal-case truncate">
            {serial.author}
          </p>
        )}
      </div>
    </Link>
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

  const { data: serialsDashboard } = useApi<SerialDashboardEntry[]>(
    `/api/serials/dashboard?_k=${serialRefreshKey}`
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

  return (
    <div className="p-6 lg:p-12">
      {/* Header */}
      <header className="mb-12">
        <h2 className="text-6xl font-black tracking-tighter text-white">
          Dashboard
        </h2>
        <p className="text-white/40 font-medium text-lg mt-2 normal-case">
          Welcome back, reader. Your library awaits.
        </p>
      </header>

      <div className="grid grid-cols-12 gap-8">
        {/* Currently Reading */}
        <section className="col-span-12">
          {currentlyReading.length === 0 ? (
            <div className="bg-white/5 border border-white/10 p-8 flex items-center justify-center py-12">
              <div className="text-center">
                <BookOpen size={40} className="mx-auto mb-3 text-white/20" />
                <p className="text-sm font-black tracking-widest text-white/30">
                  Nothing In Progress
                </p>
                <p className="text-xs mt-1 text-white/20 normal-case">
                  Open the library to start reading
                </p>
              </div>
            </div>
          ) : (
            <>
              <h4 className="text-sm font-black tracking-widest text-white mb-4">
                Currently Reading
              </h4>
              <ScrollRow>
                {currentlyReading.map((book) => (
                  <div
                    key={book.id}
                    className="w-[calc(50%-6px)] sm:w-[calc(33.333%-11px)] md:w-[calc(25%-12px)] lg:w-[calc(20%-13px)] xl:w-[calc(16.667%-13px)] flex-shrink-0"
                  >
                    <CurrentlyReadingCard book={book} />
                  </div>
                ))}
              </ScrollRow>
            </>
          )}
        </section>

        {/* New Chapters */}
        {serialsDashboard && serialsDashboard.length > 0 && (
          <section className="col-span-12">
            <div className="flex items-center gap-3 mb-4">
              <h4 className="text-sm font-black tracking-widest text-white">
                Web Serials
              </h4>
              <button
                onClick={handleCheckUpdates}
                disabled={checkingUpdates}
                className="text-white/40 hover:text-primary transition-colors disabled:opacity-50"
                title="Check for new chapters"
              >
                <RefreshCw
                  size={14}
                  className={checkingUpdates ? 'animate-spin' : ''}
                />
              </button>
            </div>
            <ScrollRow>
              {serialsDashboard.map((serial) => (
                <div
                  key={serial.id}
                  className="w-[calc(50%-6px)] sm:w-[calc(33.333%-11px)] md:w-[calc(25%-12px)] lg:w-[calc(20%-13px)] xl:w-[calc(16.667%-13px)] flex-shrink-0"
                >
                  <NewChaptersCard serial={serial} />
                </div>
              ))}
            </ScrollRow>
          </section>
        )}

        {/* Heatmap */}
        <section className="col-span-12 lg:col-span-8">
          <ReadingHeatmap
            data={heatmapData ?? []}
            year={CURRENT_YEAR}
            streak={streak}
          />
        </section>

        {/* Stat cards */}
        <section className="col-span-12 lg:col-span-4 grid grid-cols-1 gap-4">
          <StatCard
            icon={Clock}
            label="This Week"
            value={thisWeekSeconds > 0 ? fmtDuration(thisWeekSeconds) : null}
            sub="reading time"
          />
          <StatCard
            icon={BookOpen}
            label="This Week"
            value={thisWeekPages > 0 ? String(thisWeekPages) : null}
            sub="pages read"
          />
          <StatCard
            icon={Flame}
            label="This Year"
            value={
              completedBooks !== undefined
                ? String(booksCompletedThisYear)
                : null
            }
            sub="books completed"
          />
        </section>

        {/* Recent activity */}
        {activitySessions.length > 0 && (
          <section className="col-span-12">
            <ActivityFeed sessions={activitySessions} />
          </section>
        )}

        {/* Status row */}
        <section className="col-span-12">
          <div className="border-t-2 border-primary pt-4 flex flex-wrap justify-between items-center gap-4">
            <div className="flex gap-8">
              <span className="text-[10px] font-black tracking-tighter text-white/40">
                {overview
                  ? `${overview.books_owned} books in library`
                  : 'Loading…'}
              </span>
              <span className="text-[10px] font-black tracking-tighter text-white/40">
                {overview ? `${overview.books_read} completed` : ''}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
