import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Flame, Clock, BookOpen } from 'lucide-react'
import { useApi } from '../hooks/useApi'
import type { PaginatedResponse } from '../types'
import type { Book } from '../types'
import type { LucideIcon } from 'lucide-react'

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

interface HeatmapEntry {
  date: string
  seconds: number
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
// Heatmap grid builder
// ---------------------------------------------------------------------------

const EMPTY_HEATMAP: number[][] = Array.from({ length: 53 }, () =>
  Array(7).fill(0)
)

function buildHeatmapGrid(data: HeatmapEntry[]): number[][] {
  if (!data.length) return EMPTY_HEATMAP
  const maxSec = Math.max(...data.map((d) => d.seconds))
  if (!maxSec) return EMPTY_HEATMAP

  const dayMap = new Map<string, number>()
  for (const d of data) {
    dayMap.set(d.date, d.seconds / maxSec)
  }

  const year = parseInt(data[0].date.slice(0, 4), 10)
  const jan1 = new Date(year, 0, 1)
  const startDay = new Date(jan1)
  startDay.setDate(jan1.getDate() - jan1.getDay()) // back to Sunday

  const weeks: number[][] = []
  const cursor = new Date(startDay)

  while (weeks.length < 53) {
    const week: number[] = []
    for (let d = 0; d < 7; d++) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      week.push(dayMap.get(key) ?? 0)
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

function cellClass(level: number): string {
  if (!level) return 'bg-white/5 border border-white/10'
  if (level <= 0.25) return 'bg-primary/20'
  if (level <= 0.5) return 'bg-primary/40'
  if (level <= 0.75) return 'bg-primary/75'
  return 'bg-primary'
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

interface ReadingHeatmapProps {
  weeks: number[][]
  streak: number
}

function ReadingHeatmap({ weeks, streak }: ReadingHeatmapProps) {
  const isEmpty = weeks.every((w) => w.every((v) => !v))
  return (
    <div className="bg-white/5 border border-white/10 p-8 h-full">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h4 className="text-xl font-black tracking-widest text-white">
            Reading Activity
          </h4>
          <p className="text-white/40 text-xs font-bold tracking-wider mt-1">
            {CURRENT_YEAR} Activity Heatmap
          </p>
        </div>
        <div className="bg-primary text-white text-[10px] font-black px-3 py-1 tracking-widest flex items-center gap-1.5">
          <Flame size={11} />
          {streak > 0 ? `${streak} Day Streak` : 'No Streak Yet'}
        </div>
      </div>

      <div className="overflow-x-auto pb-4">
        <div className="inline-grid grid-rows-7 grid-flow-col gap-1.5 min-w-max">
          {weeks.flatMap((week, wi) =>
            week.map((level, di) => (
              <div
                key={`${wi}-${di}`}
                className={`h-3 w-3 ${cellClass(level)}`}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-6">
        {isEmpty ? (
          <p className="text-white/40 text-xs font-medium italic normal-case">
            No reading data yet. Sync your KOReader to see activity.
          </p>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-white/40 font-black">Less</span>
          <div className="flex gap-1">
            {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
              <div key={i} className={`w-3 h-3 ${cellClass(v)}`} />
            ))}
          </div>
          <span className="text-[10px] text-white/40 font-black">More</span>
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
      className="bg-white/5 border border-white/10 p-5 flex gap-4 items-start relative overflow-hidden hover:border-white/20 transition-colors group"
      data-testid="currently-reading-card"
    >
      <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
      <div className="w-16 h-24 flex-shrink-0 bg-white/10 overflow-hidden">
        <img
          src={`/api/books/${book.id}/cover`}
          alt={book.title}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-primary text-[10px] font-black tracking-widest mb-1">
          Currently Reading
        </p>
        <h3 className="text-sm font-black tracking-tight text-white leading-snug truncate">
          {book.title}
        </h3>
        {book.author && (
          <p className="text-white/50 text-xs mt-0.5 normal-case truncate">
            {book.author}
          </p>
        )}
        <div className="mt-3 space-y-1">
          <span className="text-[10px] text-white/40 font-black">
            {Math.round(progress)}% Complete
          </span>
          <div className="h-1 bg-white/10 w-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
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
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const { data: booksData } = useApi<
    PaginatedResponse<Book & { reading_progress?: number }>
  >('/api/books?status=reading&sort=last_read&per_page=5')

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

  const currentlyReading = booksData?.items ?? []
  const streak = overview?.current_streak_days ?? 0
  const heatmapWeeks = useMemo(
    () => buildHeatmapGrid(heatmapData ?? []),
    [heatmapData]
  )
  const thisWeekSeconds = weekTimeData?.reduce((a, b) => a + b.value, 0) ?? 0
  const thisWeekPages = weekPagesData?.reduce((a, b) => a + b.value, 0) ?? 0

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
            <div className="bg-white/5 border border-white/10 p-8 relative flex items-center justify-center py-12">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {currentlyReading.map((book) => (
                <CurrentlyReadingCard key={book.id} book={book} />
              ))}
            </div>
          )}
        </section>

        {/* Heatmap */}
        <section className="col-span-12 lg:col-span-8">
          <ReadingHeatmap weeks={heatmapWeeks} streak={streak} />
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
            label="Current Streak"
            value={streak > 0 ? `${streak} days` : null}
            sub={streak > 0 ? 'keep it up!' : 'start reading today'}
          />
        </section>

        {/* Recent activity */}
        {recentSessions && recentSessions.length > 0 && (
          <section className="col-span-12">
            <ActivityFeed sessions={recentSessions} />
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
            <div className="text-[10px] font-black tracking-widest text-primary flex items-center gap-2">
              <span className="block w-2 h-2 rounded-full bg-primary animate-pulse" />
              Live Analytics
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
