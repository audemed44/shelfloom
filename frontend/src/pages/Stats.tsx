import { useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Flame, ChevronLeft, ChevronRight } from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { ReadingHeatmap } from '../components/ReadingHeatmap'
import type { HeatmapEntry } from '../components/ReadingHeatmap'

// ===========================================================================
// Types
// ===========================================================================

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

interface StreakData {
  current: number
  longest: number
  last_read_date: string | null
  history: { start: string; end: string; days: number }[]
}

interface DistributionData {
  by_hour: { hour: number; seconds: number }[]
  by_weekday: { weekday: number; seconds: number }[]
}

interface AuthorEntry {
  author: string
  total_seconds: number
  session_count: number
}

interface TagEntry {
  tag: string
  total_seconds: number
  session_count: number
}

interface CompletedBook {
  book_id: string
  title: string
  author: string | null
  completed_at: string
}

interface CalendarBook {
  book_id: string
  title: string
  duration: number
}

interface CalendarDay {
  date: string
  books: CalendarBook[]
}

type Tab =
  | 'overview'
  | 'reading-time'
  | 'calendar'
  | 'books-authors'
  | 'streaks'
type Granularity = 'day' | 'week' | 'month'
type DatePreset = '30d' | '1y' | 'all'

// ===========================================================================
// Constants
// ===========================================================================

const BOOK_COLOR_CLASSES = [
  'bg-blue-600',
  'bg-pink-600',
  'bg-emerald-600',
  'bg-yellow-500',
  'bg-purple-600',
  'bg-orange-500',
  'bg-red-600',
  'bg-teal-600',
]

const BOOK_TEXT_CLASSES = [
  'text-white',
  'text-white',
  'text-white',
  'text-black',
  'text-white',
  'text-black',
  'text-white',
  'text-white',
]

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'reading-time', label: 'Reading Time' },
  { id: 'calendar', label: 'Activity Calendar' },
  { id: 'books-authors', label: 'Books & Authors' },
  { id: 'streaks', label: 'Streaks & Distribution' },
]

const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: '30d', label: 'Last 30 Days' },
  { id: '1y', label: 'Last Year' },
  { id: 'all', label: 'All Time' },
]

// ===========================================================================
// Utilities
// ===========================================================================

function fmtSec(s: number): string {
  if (!s) return '0m'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`
}

function bookColorIdx(bookId: string): number {
  let h = 0
  for (let i = 0; i < bookId.length; i++)
    h = (h * 31 + bookId.charCodeAt(i)) & 0xffff
  return h % BOOK_COLOR_CLASSES.length
}

function intensityClass(value: number, max: number): string {
  if (!value || !max) return 'bg-white/5'
  const r = value / max
  if (r <= 0.2) return 'bg-primary/20'
  if (r <= 0.4) return 'bg-primary/40'
  if (r <= 0.6) return 'bg-primary/60'
  if (r <= 0.8) return 'bg-primary/75'
  return 'bg-primary'
}

function buildFromParam(preset: DatePreset): string {
  const now = new Date()
  if (preset === '30d') {
    const from = new Date(now)
    from.setDate(from.getDate() - 30)
    return `&from=${encodeURIComponent(from.toISOString())}`
  }
  if (preset === '1y') {
    const from = new Date(now)
    from.setFullYear(from.getFullYear() - 1)
    return `&from=${encodeURIComponent(from.toISOString())}`
  }
  return ''
}

function fmtBucket(bucket: string, gran: Granularity): string {
  if (gran === 'month') {
    const parts = bucket.split('-')
    const m = parseInt(parts[1] ?? '1', 10)
    const y = parts[0] ?? ''
    return `${MONTH_NAMES[m - 1]} '${y.slice(2)}`
  }
  if (gran === 'week') {
    const parts = bucket.split('-W')
    return `W${parts[1] ?? bucket.slice(-2)}`
  }
  try {
    return new Date(bucket + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return bucket
  }
}

function limitSeries(data: TimeSeriesEntry[], max: number): TimeSeriesEntry[] {
  if (data.length <= max) return data
  const step = Math.ceil(data.length / max)
  return data.filter((_, i) => i % step === 0)
}

// ===========================================================================
// BarChart
// ===========================================================================

interface BarChartProps {
  data: TimeSeriesEntry[]
  granularity: Granularity
  valueFormatter?: (v: number) => string
  height?: number
  'data-testid'?: string
}

function BarChart({
  data,
  granularity,
  valueFormatter = fmtSec,
  height = 192,
  'data-testid': testId,
}: BarChartProps) {
  const limited = useMemo(() => limitSeries(data, 60), [data])
  const max = useMemo(
    () => Math.max(...limited.map((d) => d.value), 1),
    [limited]
  )
  const showEvery = limited.length > 20 ? Math.ceil(limited.length / 10) : 1

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-white/20 text-xs normal-case"
        style={{ height }}
        data-testid={testId}
      >
        No data for this period
      </div>
    )
  }

  return (
    <div data-testid={testId}>
      <div className="flex items-end justify-between gap-px" style={{ height }}>
        {limited.map((d, i) => {
          const pct = (d.value / max) * 100
          return (
            <div
              key={i}
              className="flex-1 relative group cursor-default"
              style={{ height: '100%' }}
              title={`${fmtBucket(d.date, granularity)}: ${valueFormatter(d.value)}`}
            >
              <div
                className="absolute bottom-0 w-full bg-primary/30 group-hover:bg-primary transition-colors"
                style={{ height: `${Math.max(pct, 1)}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between mt-3 overflow-hidden">
        {limited.map((d, i) => (
          <span
            key={i}
            className="text-[9px] text-white/25 font-bold flex-1 text-center truncate"
          >
            {i % showEvery === 0 ? fmtBucket(d.date, granularity) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

// ===========================================================================
// LineChart
// ===========================================================================

function LineChart({
  data,
  granularity,
  cumulative = false,
  'data-testid': testId,
}: {
  data: TimeSeriesEntry[]
  granularity: Granularity
  cumulative?: boolean
  'data-testid'?: string
}) {
  const processed = useMemo(() => {
    const limited = limitSeries(data, 60)
    if (!cumulative) return limited
    let running = 0
    return limited.map((d) => ({ ...d, value: (running += d.value) }))
  }, [data, cumulative])

  if (data.length === 0) {
    return (
      <div
        className="h-32 flex items-center justify-center text-white/20 text-xs normal-case"
        data-testid={testId}
      >
        No data for this period
      </div>
    )
  }

  const maxVal = Math.max(...processed.map((d) => d.value), 1)
  const W = 400
  const H = 80

  const pts = processed
    .map((d, i) => {
      const x = processed.length > 1 ? (i / (processed.length - 1)) * W : W / 2
      const y = H - (d.value / maxVal) * H * 0.88
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const areaD = `M ${pts.replace(/ /g, ' L ')} L ${W},${H} L 0,${H} Z`

  const indices = [
    0,
    Math.floor(processed.length / 3),
    Math.floor((processed.length * 2) / 3),
    processed.length - 1,
  ].filter((i) => i >= 0 && i < processed.length)

  return (
    <div className="relative" data-testid={testId}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 128 }}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="line-fill-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#258cf4" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#258cf4" stopOpacity="0" />
          </linearGradient>
        </defs>
        {processed.length > 1 && (
          <>
            <path d={areaD} fill="url(#line-fill-grad)" />
            <polyline
              points={pts}
              fill="none"
              stroke="#258cf4"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}
        {processed.length === 1 && (
          <circle cx={W / 2} cy={H / 2} r="4" fill="#258cf4" />
        )}
      </svg>
      <div className="flex justify-between mt-2">
        {indices.map((i) => (
          <span
            key={i}
            className="text-[9px] text-white/30 font-bold uppercase"
          >
            {fmtBucket(processed[i].date, granularity)}
          </span>
        ))}
      </div>
    </div>
  )
}

// ===========================================================================
// HorizontalBar
// ===========================================================================

function HorizontalBar({
  label,
  value,
  max,
  sub,
}: {
  label: string
  value: number
  max: number
  sub?: string
}) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-bold uppercase">
        <span className="text-white/70 truncate mr-4">{label}</span>
        <span className="text-white/40 shrink-0">{sub ?? fmtSec(value)}</span>
      </div>
      <div className="h-1.5 w-full bg-white/5">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pct}%`, opacity: 0.4 + (pct / 100) * 0.6 }}
        />
      </div>
    </div>
  )
}

// ===========================================================================
// GranularityToggle
// ===========================================================================

function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity
  onChange: (g: Granularity) => void
}) {
  return (
    <div className="flex bg-white/5 p-0.5">
      {(['day', 'week', 'month'] as Granularity[]).map((g) => (
        <button
          key={g}
          onClick={() => onChange(g)}
          data-testid={`gran-${g}`}
          className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest transition-colors ${
            value === g
              ? 'bg-white/10 text-white'
              : 'text-white/40 hover:text-white/70'
          }`}
        >
          {g}
        </button>
      ))}
    </div>
  )
}

// ===========================================================================
// TimeOfDayHistogram
// ===========================================================================

function TimeOfDayHistogram({
  data,
}: {
  data: { hour: number; seconds: number }[]
}) {
  const max = Math.max(...data.map((d) => d.seconds), 1)
  return (
    <div>
      <div className="h-40 flex items-end gap-px">
        {data.map((d) => {
          const pct = Math.max((d.seconds / max) * 100, d.seconds > 0 ? 2 : 0)
          return (
            <div
              key={d.hour}
              className={`flex-1 ${intensityClass(d.seconds, max)}`}
              style={{ height: `${pct}%` }}
              title={`${d.hour}:00 — ${fmtSec(d.seconds)}`}
            />
          )
        })}
      </div>
      <div className="flex justify-between mt-3 text-[9px] font-bold text-white/25 uppercase">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:59</span>
      </div>
    </div>
  )
}

// ===========================================================================
// DayOfWeekChart
// ===========================================================================

function DayOfWeekChart({
  data,
}: {
  data: { weekday: number; seconds: number }[]
}) {
  // SQLite weekday: 0=Sun … 6=Sat → render Mon-Sun
  const ordered = [1, 2, 3, 4, 5, 6, 0]
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const max = Math.max(...data.map((d) => d.seconds), 1)
  return (
    <div className="h-32 flex items-end gap-2">
      {ordered.map((w, i) => {
        const entry = data.find((d) => d.weekday === w)
        const val = entry?.seconds ?? 0
        const pct = (val / max) * 100
        return (
          <div key={w} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full flex flex-col justify-end"
              style={{ height: 96 }}
            >
              <div
                className={`w-full transition-all ${intensityClass(val, max)}`}
                style={{ height: `${Math.max(pct, 2)}%` }}
                title={`${labels[i]}: ${fmtSec(val)}`}
              />
            </div>
            <span className="text-[9px] font-bold text-white/30 uppercase">
              {labels[i].slice(0, 2)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ===========================================================================
// RadialClock — creative time-of-day chart
// ===========================================================================

function RadialClock({ data }: { data: { hour: number; seconds: number }[] }) {
  const max = Math.max(...data.map((d) => d.seconds), 1)
  const cx = 100
  const cy = 100
  const innerR = 28
  const outerR = 88

  const sectors = data.map((d, i) => {
    const startDeg = (i * 360) / 24 - 90
    const endDeg = ((i + 1) * 360) / 24 - 90
    const r = innerR + (d.seconds / max) * (outerR - innerR)
    const toRad = (deg: number) => (deg * Math.PI) / 180
    const x1 = cx + innerR * Math.cos(toRad(startDeg))
    const y1 = cy + innerR * Math.sin(toRad(startDeg))
    const x2 = cx + r * Math.cos(toRad(startDeg))
    const y2 = cy + r * Math.sin(toRad(startDeg))
    const x3 = cx + r * Math.cos(toRad(endDeg))
    const y3 = cy + r * Math.sin(toRad(endDeg))
    const x4 = cx + innerR * Math.cos(toRad(endDeg))
    const y4 = cy + innerR * Math.sin(toRad(endDeg))
    const path = `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${x3.toFixed(2)} ${y3.toFixed(2)} L ${x4.toFixed(2)} ${y4.toFixed(2)} A ${innerR} ${innerR} 0 0 0 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`
    const opacity = max > 0 ? (d.seconds / max) * 0.8 + 0.1 : 0.05
    return { path, opacity, hour: d.hour, seconds: d.seconds }
  })

  const axisHours = [0, 6, 12, 18]

  return (
    <div>
      <p className="text-[9px] font-bold text-white/30 mb-2 normal-case">
        Radial view — midnight at top, clockwise
      </p>
      <svg viewBox="0 0 200 200" className="w-full max-w-[200px] mx-auto">
        {sectors.map((s, i) => (
          <path key={i} d={s.path} fill="#258cf4" fillOpacity={s.opacity}>
            <title>
              {s.hour}:00 — {fmtSec(s.seconds)}
            </title>
          </path>
        ))}
        <circle
          cx={cx}
          cy={cy}
          r={innerR}
          fill="#000"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />
        {axisHours.map((h) => {
          const angle = (h * 360) / 24 - 90
          const toRad = (deg: number) => (deg * Math.PI) / 180
          const x1 = cx + innerR * Math.cos(toRad(angle))
          const y1 = cy + innerR * Math.sin(toRad(angle))
          const x2 = cx + (outerR + 6) * Math.cos(toRad(angle))
          const y2 = cy + (outerR + 6) * Math.sin(toRad(angle))
          const lx = cx + (outerR + 16) * Math.cos(toRad(angle))
          const ly = cy + (outerR + 16) * Math.sin(toRad(angle))
          const label =
            h === 0
              ? '12a'
              : h === 12
                ? '12p'
                : `${h > 12 ? h - 12 : h}${h >= 12 ? 'p' : 'a'}`
          return (
            <g key={h}>
              <line
                x1={x1.toFixed(1)}
                y1={y1.toFixed(1)}
                x2={x2.toFixed(1)}
                y2={y2.toFixed(1)}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              <text
                x={lx.toFixed(1)}
                y={ly.toFixed(1)}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="7"
                fill="rgba(255,255,255,0.3)"
                fontFamily="sans-serif"
                fontWeight="bold"
              >
                {label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ===========================================================================
// MonthCalendar
// ===========================================================================

interface MonthCalendarProps {
  year: number
  month: number // 1-indexed
  days: CalendarDay[]
  onPrev: () => void
  onNext: () => void
}

function MonthCalendar({
  year,
  month,
  days,
  onPrev,
  onNext,
}: MonthCalendarProps) {
  const today = new Date()
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  // Monday-first grid: how many empty cells before day 1
  const startDow = firstDay.getDay() // 0=Sun
  const offsetCells = startDow === 0 ? 6 : startDow - 1

  const dayMap = new Map<string, CalendarBook[]>()
  for (const d of days) dayMap.set(d.date, d.books)

  const cells: { day: number | null; dateKey: string | null }[] = []
  for (let i = 0; i < offsetCells; i++) cells.push({ day: null, dateKey: null })
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ day: d, dateKey: key })
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, dateKey: null })

  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() + 1 === month
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '1px',
    backgroundColor: 'rgba(255,255,255,0.07)',
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-black uppercase tracking-widest">
          Monthly Reading
        </h3>
        <div className="flex items-center gap-1 text-xs font-bold uppercase">
          <button
            onClick={onPrev}
            className="text-white/40 hover:text-white transition-colors p-1"
            aria-label="Previous month"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-white/70 w-20 text-center">{monthLabel}</span>
          <button
            onClick={onNext}
            className="text-white/40 hover:text-white transition-colors p-1"
            aria-label="Next month"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Day-of-week headers */}
      <div style={gridStyle} className="mb-px">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div
            key={i}
            className="bg-black py-2 text-center text-[10px] font-bold text-white/30"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div
        style={gridStyle}
        className="border border-white/5"
        data-testid="calendar-grid"
      >
        {cells.map((cell, i) => {
          const isToday = isCurrentMonth && cell.day === today.getDate()
          const books = cell.dateKey ? (dayMap.get(cell.dateKey) ?? []) : []
          return (
            <div
              key={i}
              className={`bg-black p-1 ${isToday ? 'border border-primary/50' : ''} ${cell.day === null ? 'opacity-20' : ''}`}
              style={{ minHeight: 72 }}
            >
              {cell.day !== null && (
                <>
                  <span
                    className={`text-[10px] font-bold ${isToday ? 'text-primary' : 'text-white/40'}`}
                  >
                    {cell.day}
                  </span>
                  <div className="mt-0.5 space-y-0.5">
                    {books.slice(0, 3).map((book, bi) => {
                      const ci = bookColorIdx(book.book_id)
                      return (
                        <div
                          key={bi}
                          className={`h-3 rounded-full px-1.5 text-[7px] flex items-center truncate ${BOOK_COLOR_CLASSES[ci]} ${BOOK_TEXT_CLASSES[ci]}`}
                          title={`${book.title} — ${fmtSec(book.duration)}`}
                        >
                          {book.title}
                        </div>
                      )
                    })}
                    {books.length > 3 && (
                      <div className="text-[7px] text-white/30 font-bold pl-1">
                        +{books.length - 3} more
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend hint */}
      <div className="mt-3 flex items-center gap-3">
        <span className="text-[9px] font-bold text-white/25 uppercase">
          Books read today shown as pills
        </span>
      </div>
    </div>
  )
}

// ===========================================================================
// Overview tab
// ===========================================================================

interface OverviewTabProps {
  overview: StatsOverview | null
  avgSpeed: number | null
  readingTime: TimeSeriesEntry[]
  granularity: Granularity
  setGranularity: (g: Granularity) => void
  calYear: number
  calMonth: number
  calendarDays: CalendarDay[]
  onCalPrev: () => void
  onCalNext: () => void
  streaks: StreakData | null
  completed: CompletedBook[]
  byAuthor: AuthorEntry[]
  authorMax: number
  distribution: DistributionData | null
}

function OverviewTab({
  overview,
  avgSpeed,
  readingTime,
  granularity,
  setGranularity,
  calYear,
  calMonth,
  calendarDays,
  onCalPrev,
  onCalNext,
  streaks,
  completed,
  byAuthor,
  authorMax,
  distribution,
}: OverviewTabProps) {
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(12, 1fr)',
    gap: '1px',
    backgroundColor: 'rgba(255,255,255,0.05)',
  }

  const metrics = [
    {
      label: 'Total Books',
      value: overview !== null ? String(overview.books_owned) : null,
      sub: overview ? `${overview.books_read} completed` : undefined,
    },
    {
      label: 'Total Time',
      value:
        overview !== null ? fmtSec(overview.total_reading_time_seconds) : null,
      sub: overview
        ? `${fmtSec(Math.round(overview.total_reading_time_seconds / 52))} avg/week`
        : undefined,
    },
    {
      label: 'Total Pages',
      value:
        overview !== null ? overview.total_pages_read.toLocaleString() : null,
      sub: 'pages read',
    },
    {
      label: 'Avg Speed',
      value:
        avgSpeed !== null ? `${avgSpeed} p/h` : overview !== null ? '—' : null,
      sub: 'pages per hour',
    },
  ]

  return (
    <div style={gridStyle} className="border border-white/5">
      {/* Key metrics */}
      {metrics.map(({ label, value, sub }, i) => (
        <div
          key={i}
          className="bg-black p-6"
          style={{ gridColumn: 'span 3' }}
          data-testid="metric-card"
        >
          <p className="text-[10px] font-black tracking-widest text-white/40 mb-1">
            {label}
          </p>
          <h2 className="text-4xl font-black tracking-tighter">
            {value ?? '—'}
          </h2>
          {sub && (
            <p className="mt-3 text-xs text-white/30 font-bold normal-case">
              {sub}
            </p>
          )}
        </div>
      ))}

      {/* Reading time bar chart */}
      <div className="bg-black p-6" style={{ gridColumn: 'span 8' }}>
        <div className="flex justify-between items-end mb-6">
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest mb-1">
              Reading Time
            </h3>
            <p className="text-xs text-white/30 normal-case">
              Duration per {granularity}
            </p>
          </div>
          <GranularityToggle value={granularity} onChange={setGranularity} />
        </div>
        <BarChart
          data={readingTime}
          granularity={granularity}
          height={200}
          data-testid="reading-time-chart"
        />
      </div>

      {/* Monthly calendar */}
      <div className="bg-black p-6" style={{ gridColumn: 'span 4' }}>
        <MonthCalendar
          year={calYear}
          month={calMonth}
          days={calendarDays}
          onPrev={onCalPrev}
          onNext={onCalNext}
        />
      </div>

      {/* Streaks row */}
      <div className="bg-black p-6" style={{ gridColumn: 'span 12' }}>
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-6">
          <div className="flex gap-12">
            <div>
              <p className="text-[10px] font-black tracking-widest text-white/40 mb-1">
                Current Streak
              </p>
              <p className="text-4xl font-black">
                {streaks !== null ? `${streaks.current} Days` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-black tracking-widest text-white/40 mb-1">
                Longest Streak
              </p>
              <p className="text-4xl font-black">
                {streaks !== null ? `${streaks.longest} Days` : '—'}
              </p>
            </div>
          </div>
          {streaks && streaks.current > 0 && (
            <div className="text-[10px] font-black tracking-widest text-primary flex items-center gap-2">
              <Flame size={14} />
              {streaks.current} Day Streak Active
            </div>
          )}
        </div>
      </div>

      {/* Books completed */}
      {completed.length > 0 && (
        <div className="bg-black p-6" style={{ gridColumn: 'span 12' }}>
          <h3 className="text-sm font-black uppercase tracking-widest mb-6">
            Books Completed
          </h3>
          <div
            className="flex gap-4 overflow-x-auto pb-2"
            style={{ scrollbarWidth: 'none' }}
          >
            {completed.map((book) => (
              <Link
                key={book.book_id}
                to={`/books/${book.book_id}`}
                className="min-w-[110px] group"
              >
                <div className="aspect-[2/3] bg-white/5 mb-2 border border-white/10 group-hover:border-primary transition-colors overflow-hidden">
                  <img
                    src={`/api/books/${book.book_id}/cover`}
                    alt={book.title}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                </div>
                <p className="text-[9px] font-black uppercase tracking-tight leading-tight truncate">
                  {book.title}
                </p>
                {book.author && (
                  <p className="text-[9px] text-white/40 normal-case truncate">
                    {book.author}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* By author */}
      <div className="bg-black p-6" style={{ gridColumn: 'span 6' }}>
        <h3 className="text-sm font-black uppercase tracking-widest mb-6">
          Reading by Author
        </h3>
        {byAuthor.length === 0 ? (
          <p className="text-white/20 text-xs normal-case">
            No reading data yet
          </p>
        ) : (
          <div className="space-y-4">
            {byAuthor.map((a) => (
              <HorizontalBar
                key={a.author}
                label={a.author}
                value={a.total_seconds}
                max={authorMax}
              />
            ))}
          </div>
        )}
      </div>

      {/* Time of day */}
      <div className="bg-black p-6" style={{ gridColumn: 'span 6' }}>
        <h3 className="text-sm font-black uppercase tracking-widest mb-6">
          Time of Day
        </h3>
        {distribution ? (
          <TimeOfDayHistogram data={distribution.by_hour} />
        ) : (
          <p className="text-white/20 text-xs normal-case">Loading…</p>
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// Reading Time tab
// ===========================================================================

function ReadingTimeTab({
  readingTime,
  pagesData,
  granularity,
  setGranularity,
}: {
  readingTime: TimeSeriesEntry[]
  pagesData: TimeSeriesEntry[]
  granularity: Granularity
  setGranularity: (g: Granularity) => void
}) {
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(12, 1fr)',
    gap: '1px',
    backgroundColor: 'rgba(255,255,255,0.05)',
  }

  return (
    <div style={gridStyle} className="border border-white/5">
      <div className="bg-black p-6" style={{ gridColumn: 'span 12' }}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest mb-1">
              Reading Time
            </h3>
            <p className="text-xs text-white/30 normal-case">
              Reading duration per {granularity}
            </p>
          </div>
          <GranularityToggle value={granularity} onChange={setGranularity} />
        </div>
      </div>

      <div className="bg-black p-6" style={{ gridColumn: 'span 12' }}>
        <BarChart
          data={readingTime}
          granularity={granularity}
          height={240}
          data-testid="reading-time-chart-big"
        />
      </div>

      <div className="bg-black p-6" style={{ gridColumn: 'span 6' }}>
        <h3 className="text-sm font-black uppercase tracking-widest mb-6">
          Pages Read Progress
        </h3>
        <LineChart
          data={pagesData}
          granularity={granularity}
          cumulative
          data-testid="pages-chart"
        />
      </div>

      <div className="bg-black p-6" style={{ gridColumn: 'span 6' }}>
        <h3 className="text-sm font-black uppercase tracking-widest mb-6">
          Reading Time Trend
        </h3>
        <LineChart
          data={readingTime}
          granularity={granularity}
          data-testid="speed-chart"
        />
      </div>
    </div>
  )
}

// ===========================================================================
// Calendar tab
// ===========================================================================

function CalendarTab({
  calYear,
  calMonth,
  calendarDays,
  onPrev,
  onNext,
}: {
  calYear: number
  calMonth: number
  calendarDays: CalendarDay[]
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className="border border-white/5">
      <div className="p-6 bg-black border-b border-white/10">
        <h2 className="text-sm font-black uppercase tracking-widest mb-1">
          Activity Calendar
        </h2>
        <p className="text-xs text-white/30 normal-case">
          Books read each day of the month
        </p>
      </div>
      <div className="bg-black p-6 max-w-3xl">
        <MonthCalendar
          year={calYear}
          month={calMonth}
          days={calendarDays}
          onPrev={onPrev}
          onNext={onNext}
        />
      </div>
    </div>
  )
}

// ===========================================================================
// Books & Authors tab
// ===========================================================================

function BooksAuthorsTab({
  byAuthor,
  byTag,
  authorMax,
  tagMax,
  completed,
}: {
  byAuthor: AuthorEntry[]
  byTag: TagEntry[]
  authorMax: number
  tagMax: number
  completed: CompletedBook[]
}) {
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(12, 1fr)',
    gap: '1px',
    backgroundColor: 'rgba(255,255,255,0.05)',
  }

  return (
    <div style={gridStyle} className="border border-white/5">
      <div className="bg-black p-6" style={{ gridColumn: 'span 6' }}>
        <h3 className="text-sm font-black uppercase tracking-widest mb-6">
          Reading by Author
        </h3>
        {byAuthor.length === 0 ? (
          <p className="text-white/20 text-xs normal-case">
            No reading data yet
          </p>
        ) : (
          <div className="space-y-4">
            {byAuthor.slice(0, 15).map((a) => (
              <HorizontalBar
                key={a.author}
                label={a.author}
                value={a.total_seconds}
                max={authorMax}
              />
            ))}
          </div>
        )}
      </div>

      <div className="bg-black p-6" style={{ gridColumn: 'span 6' }}>
        <h3 className="text-sm font-black uppercase tracking-widest mb-6">
          Reading by Tag
        </h3>
        {byTag.length === 0 ? (
          <p className="text-white/20 text-xs normal-case">
            No tagged books with reading data
          </p>
        ) : (
          <div className="space-y-4">
            {byTag.slice(0, 15).map((t) => (
              <HorizontalBar
                key={t.tag}
                label={t.tag}
                value={t.total_seconds}
                max={tagMax}
              />
            ))}
          </div>
        )}
      </div>

      {completed.length > 0 && (
        <div className="bg-black p-6" style={{ gridColumn: 'span 12' }}>
          <h3 className="text-sm font-black uppercase tracking-widest mb-6">
            Completed Books — Timeline
          </h3>
          <div
            className="flex gap-5 overflow-x-auto pb-2"
            style={{ scrollbarWidth: 'none' }}
          >
            {completed.map((book) => (
              <Link
                key={book.book_id}
                to={`/books/${book.book_id}`}
                className="min-w-[100px] group"
              >
                <div className="aspect-[2/3] bg-white/5 mb-2 border border-white/10 group-hover:border-primary transition-colors overflow-hidden">
                  <img
                    src={`/api/books/${book.book_id}/cover`}
                    alt={book.title}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                </div>
                <p className="text-[9px] font-black uppercase tracking-tight leading-tight truncate">
                  {book.title}
                </p>
                {book.completed_at && (
                  <p className="text-[9px] text-white/30 normal-case mt-0.5">
                    {new Date(book.completed_at).toLocaleDateString('en-US', {
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// Streaks & Distribution tab
// ===========================================================================

function StreaksTab({
  streaks,
  heatmap,
  distribution,
}: {
  streaks: StreakData | null
  heatmap: HeatmapEntry[]
  distribution: DistributionData | null
}) {
  const CURRENT_YEAR = new Date().getFullYear()

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(12, 1fr)',
    gap: '1px',
    backgroundColor: 'rgba(255,255,255,0.05)',
  }

  return (
    <div style={gridStyle} className="border border-white/5">
      {/* Streak summary cards */}
      <div className="bg-black p-6" style={{ gridColumn: 'span 4' }}>
        <p className="text-[10px] font-black tracking-widest text-white/40 mb-1">
          Current Streak
        </p>
        <p className="text-5xl font-black tracking-tighter">
          {streaks?.current ?? 0}
        </p>
        <p className="text-[10px] text-white/30 font-bold mt-1">days</p>
        {(streaks?.current ?? 0) > 0 && (
          <div className="mt-3 flex items-center gap-2 text-primary text-[10px] font-black">
            <Flame size={12} />
            Keep it up!
          </div>
        )}
      </div>

      <div className="bg-black p-6" style={{ gridColumn: 'span 4' }}>
        <p className="text-[10px] font-black tracking-widest text-white/40 mb-1">
          Longest Streak
        </p>
        <p className="text-5xl font-black tracking-tighter">
          {streaks?.longest ?? 0}
        </p>
        <p className="text-[10px] text-white/30 font-bold mt-1">days</p>
      </div>

      <div className="bg-black p-6" style={{ gridColumn: 'span 4' }}>
        <p className="text-[10px] font-black tracking-widest text-white/40 mb-1">
          Last Read
        </p>
        <p className="text-xl font-black tracking-tight">
          {streaks?.last_read_date
            ? new Date(streaks.last_read_date + 'T00:00:00').toLocaleDateString(
                'en-US',
                {
                  month: 'long',
                  day: 'numeric',
                }
              )
            : '—'}
        </p>
        {streaks && streaks.history.length > 0 && (
          <p className="text-[10px] text-white/30 font-bold mt-1 normal-case">
            {streaks.history.length} reading run
            {streaks.history.length !== 1 ? 's' : ''} total
          </p>
        )}
      </div>

      {/* Annual heatmap */}
      <div className="bg-black p-6" style={{ gridColumn: 'span 12' }}>
        <ReadingHeatmap
          data={heatmap}
          year={CURRENT_YEAR}
          streak={streaks?.current ?? 0}
        />
      </div>

      {/* Radial clock */}
      <div className="bg-black p-6" style={{ gridColumn: 'span 4' }}>
        <h3 className="text-sm font-black uppercase tracking-widest mb-4">
          Reading Clock
        </h3>
        {distribution ? (
          <RadialClock data={distribution.by_hour} />
        ) : (
          <p className="text-white/20 text-xs normal-case">Loading…</p>
        )}
      </div>

      {/* Time of day histogram */}
      <div className="bg-black p-6" style={{ gridColumn: 'span 4' }}>
        <h3 className="text-sm font-black uppercase tracking-widest mb-4">
          Time of Day
        </h3>
        {distribution ? (
          <TimeOfDayHistogram data={distribution.by_hour} />
        ) : (
          <p className="text-white/20 text-xs normal-case">Loading…</p>
        )}
      </div>

      {/* Day of week */}
      <div className="bg-black p-6" style={{ gridColumn: 'span 4' }}>
        <h3 className="text-sm font-black uppercase tracking-widest mb-4">
          Day of Week
        </h3>
        {distribution ? (
          <DayOfWeekChart data={distribution.by_weekday} />
        ) : (
          <p className="text-white/20 text-xs normal-case">Loading…</p>
        )}
      </div>

      {/* Streak history badges */}
      {streaks && streaks.history.length > 0 && (
        <div className="bg-black p-6" style={{ gridColumn: 'span 12' }}>
          <h3 className="text-sm font-black uppercase tracking-widest mb-4">
            Streak History
          </h3>
          <div className="flex gap-2 flex-wrap">
            {[...streaks.history]
              .sort((a, b) => b.days - a.days)
              .slice(0, 24)
              .map((run, i) => {
                const isMax = run.days === streaks.longest
                return (
                  <div
                    key={i}
                    className={`px-3 py-2 border ${isMax ? 'border-primary text-primary' : 'border-white/10 text-white/50'}`}
                  >
                    <p className="text-sm font-black">{run.days}d</p>
                    <p className="text-[9px] font-bold text-white/30 normal-case">
                      {new Date(run.start + 'T00:00:00').toLocaleDateString(
                        'en-US',
                        {
                          month: 'short',
                          day: 'numeric',
                        }
                      )}
                      {' – '}
                      {new Date(run.end + 'T00:00:00').toLocaleDateString(
                        'en-US',
                        {
                          month: 'short',
                          day: 'numeric',
                        }
                      )}
                    </p>
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// Main Stats page
// ===========================================================================

const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1

export default function Stats() {
  const [tab, setTab] = useState<Tab>('overview')
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [preset, setPreset] = useState<DatePreset>('30d')
  const [calYear, setCalYear] = useState(CURRENT_YEAR)
  const [calMonth, setCalMonth] = useState(CURRENT_MONTH)

  const fromParam = useMemo(() => buildFromParam(preset), [preset])

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: overview } = useApi<StatsOverview>('/api/stats/overview')
  const { data: readingTime } = useApi<TimeSeriesEntry[]>(
    `/api/stats/reading-time?granularity=${granularity}${fromParam}`
  )
  const { data: pagesData } = useApi<TimeSeriesEntry[]>(
    `/api/stats/pages?granularity=${granularity}${fromParam}`
  )
  const { data: streaks } = useApi<StreakData>('/api/stats/streaks')
  const { data: heatmap } = useApi<HeatmapEntry[]>(
    `/api/stats/heatmap?year=${CURRENT_YEAR}`
  )
  const { data: distribution } = useApi<DistributionData>(
    '/api/stats/distribution'
  )
  const { data: byAuthor } = useApi<AuthorEntry[]>('/api/stats/by-author')
  const { data: byTag } = useApi<TagEntry[]>('/api/stats/by-tag')
  const { data: completed } = useApi<CompletedBook[]>(
    '/api/stats/books-completed'
  )
  const { data: calendarDays } = useApi<CalendarDay[]>(
    `/api/stats/calendar?year=${calYear}&month=${calMonth}`
  )

  // ── Calendar navigation ───────────────────────────────────────────────────
  const handleCalPrev = useCallback(() => {
    if (calMonth === 1) {
      setCalYear((y) => y - 1)
      setCalMonth(12)
    } else {
      setCalMonth((m) => m - 1)
    }
  }, [calMonth])

  const handleCalNext = useCallback(() => {
    if (calMonth === 12) {
      setCalYear((y) => y + 1)
      setCalMonth(1)
    } else {
      setCalMonth((m) => m + 1)
    }
  }, [calMonth])

  // ── Derived ───────────────────────────────────────────────────────────────
  const avgSpeed = useMemo((): number | null => {
    if (!overview?.total_reading_time_seconds || !overview?.total_pages_read)
      return null
    return Math.round(
      (overview.total_pages_read / overview.total_reading_time_seconds) * 3600
    )
  }, [overview])

  const authorMax = useMemo(
    () => Math.max(...(byAuthor ?? []).map((a) => a.total_seconds), 1),
    [byAuthor]
  )
  const tagMax = useMemo(
    () => Math.max(...(byTag ?? []).map((t) => t.total_seconds), 1),
    [byTag]
  )

  return (
    <div className="min-h-screen">
      {/* Page header */}
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 border-b border-white/10 sticky top-0 bg-black/90 backdrop-blur-md z-40">
        <h1
          className="text-3xl font-black tracking-tighter"
          data-testid="stats-heading"
        >
          Reading Stats
        </h1>
        <div className="flex items-center gap-0.5 bg-white/5 p-0.5">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              data-testid={`preset-${p.id}`}
              className={`px-4 py-1.5 text-[10px] font-black tracking-widest uppercase transition-colors ${
                preset === p.id
                  ? 'bg-primary text-black'
                  : 'text-white/50 hover:text-white hover:bg-white/10'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {/* Tab navigation */}
      <nav
        className="flex border-b border-white/10 overflow-x-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-testid={`tab-${t.id}`}
            className={`px-8 py-4 text-[10px] font-black tracking-widest uppercase border-b-2 whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-white/40 hover:text-white/70'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className="p-6 lg:p-10">
        {tab === 'overview' && (
          <OverviewTab
            overview={overview}
            avgSpeed={avgSpeed}
            readingTime={readingTime ?? []}
            granularity={granularity}
            setGranularity={setGranularity}
            calYear={calYear}
            calMonth={calMonth}
            calendarDays={calendarDays ?? []}
            onCalPrev={handleCalPrev}
            onCalNext={handleCalNext}
            streaks={streaks}
            completed={completed ?? []}
            byAuthor={(byAuthor ?? []).slice(0, 8)}
            authorMax={authorMax}
            distribution={distribution}
          />
        )}
        {tab === 'reading-time' && (
          <ReadingTimeTab
            readingTime={readingTime ?? []}
            pagesData={pagesData ?? []}
            granularity={granularity}
            setGranularity={setGranularity}
          />
        )}
        {tab === 'calendar' && (
          <CalendarTab
            calYear={calYear}
            calMonth={calMonth}
            calendarDays={calendarDays ?? []}
            onPrev={handleCalPrev}
            onNext={handleCalNext}
          />
        )}
        {tab === 'books-authors' && (
          <BooksAuthorsTab
            byAuthor={byAuthor ?? []}
            byTag={byTag ?? []}
            authorMax={authorMax}
            tagMax={tagMax}
            completed={completed ?? []}
          />
        )}
        {tab === 'streaks' && (
          <StreaksTab
            streaks={streaks}
            heatmap={heatmap ?? []}
            distribution={distribution}
          />
        )}
      </div>

      {/* Status footer */}
      <div className="mx-6 lg:mx-10 pb-8">
        <div className="border-t-2 border-primary pt-4 flex justify-between items-center">
          <span className="text-[10px] font-black tracking-widest text-white/30">
            {overview
              ? `Calculated from ${overview.books_owned} books · ${overview.books_read} completed`
              : 'Loading stats…'}
          </span>
          <div className="text-[10px] font-black tracking-widest text-primary flex items-center gap-2">
            <span className="block w-2 h-2 rounded-full bg-primary animate-pulse" />
            Live Analytics
          </div>
        </div>
      </div>
    </div>
  )
}
