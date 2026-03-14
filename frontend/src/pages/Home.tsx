import { Play, Clock, BookOpen, Trophy } from 'lucide-react'
import { useApi } from '../hooks/useApi'
import type { Book, PaginatedResponse } from '../types'
import type { LucideIcon } from 'lucide-react'

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

// Empty 53×7 grid — filled with real data when Phase 4 stats API is ready
const EMPTY_HEATMAP: number[][] = Array.from({ length: 53 }, () => Array(7).fill(0))

function cellClass(level: number): string {
  if (!level) return 'bg-white/5 border border-white/10'
  if (level <= 0.25) return 'bg-primary/20'
  if (level <= 0.5) return 'bg-primary/40'
  if (level <= 0.75) return 'bg-primary/75'
  return 'bg-primary'
}

interface ReadingHeatmapProps {
  weeks?: number[][]
  streak?: number
}

function ReadingHeatmap({ weeks = EMPTY_HEATMAP, streak = 0 }: ReadingHeatmapProps) {
  const isEmpty = weeks.every((w) => w.every((v) => !v))
  return (
    <div className="bg-white/5 border border-white/10 p-8 h-full">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h4 className="text-xl font-black tracking-widest text-white">
            Reading Activity
          </h4>
          <p className="text-white/40 text-xs font-bold tracking-wider mt-1">
            Yearly Activity Heatmap
          </p>
        </div>
        <div className="bg-primary text-white text-[10px] font-black px-3 py-1 tracking-widest">
          {streak > 0 ? `${streak} Day Streak` : 'No Streak Yet'}
        </div>
      </div>

      <div className="heatmap-container overflow-x-auto pb-4">
        <div className="inline-grid grid-rows-7 grid-flow-col gap-1.5 min-w-max">
          {weeks.flatMap((week, wi) =>
            week.map((level, di) => (
              <div key={`${wi}-${di}`} className={`h-3 w-3 ${cellClass(level)}`} />
            ))
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-6">
        {isEmpty ? (
          <p className="text-white/40 text-xs font-medium italic normal-case">
            No reading data yet. Sync your KOReader or start reading to see activity.
          </p>
        ) : (
          <div /> /* spacer */
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
}

function StatCard({ icon: Icon, label, value }: StatCardProps) {
  const empty = !value
  return (
    <div className="bg-white/5 border border-white/10 p-6 flex items-center gap-6">
      <div className="w-12 h-12 bg-primary/20 flex items-center justify-center text-primary shrink-0">
        <Icon size={20} />
      </div>
      <div>
        <p className="text-white/40 text-[10px] font-black tracking-widest">{label}</p>
        <h5 className={`text-3xl font-black leading-tight ${empty ? 'text-white/20' : 'text-white'}`}>
          {value ?? '—'}
        </h5>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Currently Reading card
// ---------------------------------------------------------------------------

interface CurrentlyReadingBook {
  id: number
  title: string
  author: string | null
  cover_url?: string
  reading_progress?: number
  current_page?: number
  page_count?: number | null
}

interface CurrentlyReadingCardProps {
  book: CurrentlyReadingBook | null
}

function CurrentlyReadingCard({ book }: CurrentlyReadingCardProps) {
  if (!book) {
    return (
      <div className="bg-white/5 border border-white/10 p-8 relative">
        <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
        <div className="flex items-center justify-center py-12">
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
      </div>
    )
  }

  const progress = book.reading_progress ?? 0
  const currentPage = book.current_page ?? 0
  const totalPages = book.page_count ?? 0
  const pageLabel =
    currentPage > 0 && totalPages > 0
      ? `${currentPage} / ${totalPages} Pages`
      : `${Math.round(progress)}% Complete`

  return (
    <div className="bg-white/5 border border-white/10 p-8 flex flex-col md:flex-row gap-8 items-center relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-primary" />

      {/* Cover */}
      <div className="w-48 h-72 flex-shrink-0 bg-white/10 shadow-2xl relative">
        {book.cover_url ? (
          <img
            src={book.cover_url}
            alt={book.title}
            className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-end p-3 bg-gradient-to-br from-primary/20 to-transparent">
            <p className="text-[10px] text-white/40 leading-tight normal-case">
              {book.title}
            </p>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 space-y-6">
        <div>
          <span className="text-primary text-xs font-black tracking-[0.3em] mb-2 block">
            Currently Reading
          </span>
          <h3 className="text-4xl lg:text-5xl font-black tracking-tighter text-white leading-none">
            {book.title}
          </h3>
          <p className="text-white/60 text-xl font-medium mt-2 normal-case">
            {book.author}
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-end">
            <span className="text-white text-sm font-bold tracking-widest">
              {pageLabel}
            </span>
            <span className="text-primary text-3xl font-black leading-none">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="h-4 bg-white/10 w-full overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="flex gap-4 pt-2">
          <button className="bg-primary hover:bg-blue-600 text-white font-black text-sm tracking-widest px-8 py-4 flex items-center gap-3 transition-colors">
            <Play size={16} fill="currentColor" />
            Resume Reading
          </button>
          <button className="border border-white/20 hover:bg-white/10 text-white font-black text-sm tracking-widest px-8 py-4 transition-colors">
            Details
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  // Books list — used to find an in-progress book
  const { data: booksData } = useApi<PaginatedResponse<Book & { reading_progress?: number; current_page?: number }>>('/api/books?per_page=50')

  // Find the most recently active in-progress book
  const currentlyReading =
    booksData?.items?.find(
      (b) => (b.reading_progress ?? 0) > 0 && (b.reading_progress ?? 0) < 100
    ) ?? null

  // Stats require Phase 4 (/api/stats/overview) — show empty until then
  const stats: { timeRead: string | null; pages: string | null; completion: string | null } = {
    timeRead: null,
    pages: null,
    completion: null,
  }

  // Heatmap + streak require Phase 4 (/api/stats/heatmap)
  const heatmapWeeks = EMPTY_HEATMAP
  const streak = 0

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
          <CurrentlyReadingCard book={currentlyReading} />
        </section>

        {/* Heatmap */}
        <section className="col-span-12 lg:col-span-8">
          <ReadingHeatmap weeks={heatmapWeeks} streak={streak} />
        </section>

        {/* Stat cards */}
        <section className="col-span-12 lg:col-span-4 grid grid-cols-1 gap-4">
          <StatCard icon={Clock} label="Time Read" value={stats.timeRead} />
          <StatCard icon={BookOpen} label="Volume" value={stats.pages} />
          <StatCard icon={Trophy} label="Completion" value={stats.completion} />
        </section>

        {/* Status row */}
        <section className="col-span-12">
          <div className="border-t-2 border-primary pt-4 flex flex-wrap justify-between items-center gap-4">
            <div className="flex gap-8">
              <span className="text-[10px] font-black tracking-tighter text-white/40">
                Version 0.1.0-Stable
              </span>
              <span className="text-[10px] font-black tracking-tighter text-white/40">
                Last Synced: Online
              </span>
            </div>
            <div className="text-[10px] font-black tracking-widest text-primary flex items-center gap-2">
              <span className="block w-2 h-2 rounded-full bg-primary animate-pulse" />
              Live Analytics Active
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
