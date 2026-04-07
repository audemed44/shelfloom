import { useState, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Flame, ChevronLeft, ChevronRight } from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { ReadingHeatmap } from '../components/ReadingHeatmap'
import type { HeatmapEntry } from '../components/ReadingHeatmap'
import { getBookCoverUrl } from '../utils/bookCover'

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
  cover_path: string | null
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
  const [hovered, setHovered] = useState<number | null>(null)
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

  const yTicks = [1, 0.67, 0.33, 0].map((t) => max * t)

  return (
    <div data-testid={testId} className="flex gap-3">
      {/* Y-axis */}
      <div
        className="flex flex-col justify-between shrink-0 pb-8"
        style={{ height: height + 8 }}
      >
        {yTicks.map((v, i) => (
          <span
            key={i}
            className="text-[8px] text-white/25 font-bold text-right leading-none"
            style={{ width: 36 }}
          >
            {valueFormatter(v)}
          </span>
        ))}
      </div>
      {/* Chart body */}
      <div className="flex-1 min-w-0">
        <div className="h-6 mb-1 flex items-center">
          {hovered !== null && limited[hovered] && (
            <span className="text-[10px] font-bold">
              <span className="text-white/40">
                {fmtBucket(limited[hovered].date, granularity)}
              </span>
              {' — '}
              <span className="text-primary">
                {valueFormatter(limited[hovered].value)}
              </span>
            </span>
          )}
        </div>
        <div
          className="flex items-end gap-px border-l border-b border-white/10"
          style={{ height }}
        >
          {limited.map((d, i) => {
            const pct = (d.value / max) * 100
            const isHov = hovered === i
            return (
              <div
                key={i}
                className="flex-1 relative cursor-default"
                style={{ height: '100%' }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <div
                  className={`absolute bottom-0 w-full transition-colors ${isHov ? 'bg-primary' : 'bg-primary/30 hover:bg-primary/60'}`}
                  style={{ height: `${Math.max(pct, 1)}%` }}
                />
              </div>
            )
          })}
        </div>
        <div className="flex justify-between mt-1 pt-1 border-t border-white/5">
          {limited.map((d, i) => (
            <span
              key={i}
              className={`text-[9px] font-bold flex-1 text-center truncate transition-colors ${hovered === i ? 'text-white/60' : 'text-white/20'}`}
            >
              {i % showEvery === 0 ? fmtBucket(d.date, granularity) : ''}
            </span>
          ))}
        </div>
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
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

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

  const pts = processed.map((d, i) => ({
    x: processed.length > 1 ? (i / (processed.length - 1)) * W : W / 2,
    y: H - (d.value / maxVal) * H * 0.88,
    d,
  }))
  const ptStr = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaD = `M ${ptStr.replace(/ /g, ' L ')} L ${W},${H} L 0,${H} Z`

  const indices = [
    0,
    Math.floor(processed.length / 3),
    Math.floor((processed.length * 2) / 3),
    processed.length - 1,
  ].filter((i) => i >= 0 && i < processed.length)

  const hovPt = hoverIdx !== null ? pts[hoverIdx] : null
  const hovData = hoverIdx !== null ? processed[hoverIdx] : null
  const yTicks = [1, 0.5, 0].map((t) => maxVal * t)

  return (
    <div className="flex gap-3" data-testid={testId}>
      {/* Y-axis */}
      <div
        className="flex flex-col justify-between shrink-0 pb-6"
        style={{ height: 128 + 8 }}
      >
        {yTicks.map((v, i) => (
          <span
            key={i}
            className="text-[8px] text-white/25 font-bold text-right leading-none"
            style={{ width: 36 }}
          >
            {fmtSec(v)}
          </span>
        ))}
      </div>
      {/* Chart area */}
      <div className="flex-1 min-w-0">
        <div className="h-5 mb-1 flex items-center">
          {hovData && (
            <span className="text-[10px] font-bold">
              <span className="text-white/40">
                {fmtBucket(hovData.date, granularity)}
              </span>
              {' — '}
              <span className="text-primary">{fmtSec(hovData.value)}</span>
            </span>
          )}
        </div>
        <div className="border-l border-b border-white/10">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            style={{ height: 128, display: 'block' }}
            preserveAspectRatio="none"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const frac = (e.clientX - rect.left) / rect.width
              const idx = Math.round(frac * (processed.length - 1))
              setHoverIdx(Math.max(0, Math.min(processed.length - 1, idx)))
            }}
            onMouseLeave={() => setHoverIdx(null)}
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
                  points={ptStr}
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
            {hovPt && (
              <>
                <line
                  x1={hovPt.x.toFixed(1)}
                  y1="0"
                  x2={hovPt.x.toFixed(1)}
                  y2={H}
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                />
                <circle
                  cx={hovPt.x.toFixed(1)}
                  cy={hovPt.y.toFixed(1)}
                  r="4"
                  fill="#258cf4"
                  stroke="#000"
                  strokeWidth="2"
                />
              </>
            )}
          </svg>
        </div>
        <div className="flex justify-between mt-1 pt-1">
          {indices.map((i) => (
            <span
              key={i}
              className={`text-[9px] font-bold uppercase transition-colors ${hoverIdx === i ? 'text-white/60' : 'text-white/25'}`}
            >
              {fmtBucket(processed[i].date, granularity)}
            </span>
          ))}
        </div>
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
  const [tip, setTip] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
  const max = Math.max(...data.map((d) => d.seconds), 1)
  return (
    <div className="relative">
      {tip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1.5 bg-black border border-white/20 text-[10px] font-bold text-white/90 whitespace-nowrap"
          style={{ left: tip.x + 12, top: tip.y - 8 }}
        >
          {tip.text}
        </div>
      )}
      <div className="flex gap-2">
        <div
          className="flex flex-col justify-between shrink-0 pb-6"
          style={{ height: 160 + 8 }}
        >
          {[max, max * 0.5, 0].map((v, i) => (
            <span
              key={i}
              className="text-[8px] text-white/25 font-bold text-right leading-none"
              style={{ width: 28 }}
            >
              {fmtSec(Math.round(v))}
            </span>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="h-40 flex items-end gap-px border-l border-b border-white/10">
            {data.map((d) => {
              const pct = Math.max(
                (d.seconds / max) * 100,
                d.seconds > 0 ? 2 : 0
              )
              return (
                <div
                  key={d.hour}
                  className={`flex-1 cursor-default ${intensityClass(d.seconds, max)}`}
                  style={{ height: `${pct}%` }}
                  onMouseMove={(e) =>
                    setTip({
                      x: e.clientX,
                      y: e.clientY,
                      text: `${d.hour}:00 — ${fmtSec(d.seconds)}`,
                    })
                  }
                  onMouseLeave={() => setTip(null)}
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
  const [tip, setTip] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
  // SQLite weekday: 0=Sun … 6=Sat → render Mon-Sun
  const ordered = [1, 2, 3, 4, 5, 6, 0]
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const max = Math.max(...data.map((d) => d.seconds), 1)
  return (
    <div className="relative">
      {tip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1.5 bg-black border border-white/20 text-[10px] font-bold text-white/90 whitespace-nowrap"
          style={{ left: tip.x + 12, top: tip.y - 8 }}
        >
          {tip.text}
        </div>
      )}
      <div className="flex gap-2">
        <div
          className="flex flex-col justify-between shrink-0 pb-6"
          style={{ height: 96 + 8 }}
        >
          {[max, max * 0.5, 0].map((v, i) => (
            <span
              key={i}
              className="text-[8px] text-white/25 font-bold text-right leading-none"
              style={{ width: 28 }}
            >
              {fmtSec(Math.round(v))}
            </span>
          ))}
        </div>
        <div className="flex-1 min-w-0 flex items-end gap-2">
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
                    className={`w-full transition-all cursor-default ${intensityClass(val, max)}`}
                    style={{ height: `${Math.max(pct, 2)}%` }}
                    onMouseMove={(e) =>
                      setTip({
                        x: e.clientX,
                        y: e.clientY,
                        text: `${labels[i]}: ${fmtSec(val)}`,
                      })
                    }
                    onMouseLeave={() => setTip(null)}
                  />
                </div>
                <span className="text-[9px] font-bold text-white/30 uppercase">
                  {labels[i].slice(0, 2)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// RadialClock — creative time-of-day chart
// ===========================================================================

function RadialClock({ data }: { data: { hour: number; seconds: number }[] }) {
  const [tip, setTip] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
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
    <div className="relative">
      {tip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1.5 bg-black border border-white/20 text-[10px] font-bold text-white/90 whitespace-nowrap"
          style={{ left: tip.x + 12, top: tip.y - 8 }}
        >
          {tip.text}
        </div>
      )}
      <p className="text-[9px] font-bold text-white/30 mb-2 normal-case">
        Radial view — midnight at top, clockwise
      </p>
      <svg viewBox="0 0 200 200" className="w-full max-w-[200px] mx-auto">
        {sectors.map((s, i) => (
          <path
            key={i}
            d={s.path}
            fill="#258cf4"
            fillOpacity={s.opacity}
            style={{ cursor: 'default' }}
            onMouseMove={(e) =>
              setTip({
                x: e.clientX,
                y: e.clientY,
                text: `${s.hour}:00 — ${fmtSec(s.seconds)}`,
              })
            }
            onMouseLeave={() => setTip(null)}
          />
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
// RadarChart — reading profile (5 axes)
// ===========================================================================

function RadarChart({
  speed,
  consistency,
  volume,
  completion,
  diversity,
}: {
  speed: number
  consistency: number
  volume: number
  completion: number
  diversity: number
}) {
  const [tip, setTip] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
  const cx = 110,
    cy = 110,
    R = 72
  const axes = [
    { label: 'Speed', value: Math.min(speed, 100) },
    { label: 'Consistency', value: Math.min(consistency, 100) },
    { label: 'Volume', value: Math.min(volume, 100) },
    { label: 'Completion', value: Math.min(completion, 100) },
    { label: 'Diversity', value: Math.min(diversity, 100) },
  ]
  const n = axes.length
  const toXY = (idx: number, r: number) => {
    const a = (idx * 2 * Math.PI) / n - Math.PI / 2
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  }
  const gridLevels = [0.25, 0.5, 0.75, 1]
  const dataPoints = axes.map((a, i) => toXY(i, (a.value / 100) * R))
  const dataPoly = dataPoints
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')
  return (
    <div className="relative">
      {tip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1.5 bg-black border border-white/20 text-[10px] font-bold text-white/90 whitespace-nowrap"
          style={{ left: tip.x + 12, top: tip.y - 8 }}
        >
          {tip.text}
        </div>
      )}
      <svg viewBox="0 0 220 220" className="w-full max-w-xs mx-auto">
        {gridLevels.map((l) => {
          const pts = axes
            .map((_, i) => {
              const p = toXY(i, R * l)
              return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
            })
            .join(' ')
          return (
            <polygon
              key={l}
              points={pts}
              fill="none"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="1"
            />
          )
        })}
        {axes.map((_, i) => {
          const p = toXY(i, R)
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={p.x.toFixed(1)}
              y2={p.y.toFixed(1)}
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="1"
            />
          )
        })}
        <polygon
          points={dataPoly}
          fill="#258cf4"
          fillOpacity="0.15"
          stroke="#258cf4"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {dataPoints.map((p, i) => (
          <circle
            key={i}
            cx={p.x.toFixed(1)}
            cy={p.y.toFixed(1)}
            r="5"
            fill="#258cf4"
            style={{ cursor: 'default' }}
            onMouseMove={(e) =>
              setTip({
                x: e.clientX,
                y: e.clientY,
                text: `${axes[i].label}: ${Math.round(axes[i].value)}%`,
              })
            }
            onMouseLeave={() => setTip(null)}
          />
        ))}
        {axes.map((a, i) => {
          const p = toXY(i, R + 18)
          return (
            <text
              key={i}
              x={p.x.toFixed(1)}
              y={p.y.toFixed(1)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="7.5"
              fill="rgba(255,255,255,0.45)"
              fontFamily="sans-serif"
              fontWeight="bold"
            >
              {a.label.toUpperCase()}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

// ===========================================================================
// SunburstChart — reading time by quarter (inner) → month (outer)
// ===========================================================================

function SunburstChart({ monthlyData }: { monthlyData: TimeSeriesEntry[] }) {
  const monthTotals = Array.from({ length: 12 }, () => 0)
  for (const d of monthlyData) {
    const parts = d.date.split('-')
    const m = parseInt(parts[1] ?? '0', 10) - 1
    if (m >= 0 && m < 12) monthTotals[m] += d.value
  }
  const total = monthTotals.reduce((a, b) => a + b, 0)
  if (!total) {
    return (
      <div className="h-40 flex items-center justify-center text-white/20 text-xs normal-case">
        No data for this period
      </div>
    )
  }
  const quarterTotals = [0, 1, 2, 3].map((q) =>
    monthTotals.slice(q * 3, q * 3 + 3).reduce((a, b) => a + b, 0)
  )
  const cx = 100,
    cy = 100
  const innerR = 28,
    midR = 52,
    outerR = 76
  const QCOLORS = ['#258cf4', '#1e7ae0', '#1668c7', '#0e58b0']

  const arcPath = (
    r1: number,
    r2: number,
    startDeg: number,
    endDeg: number
  ) => {
    const toRad = (d: number) => ((d - 90) * Math.PI) / 180
    const s = toRad(startDeg),
      e = toRad(endDeg)
    const large = endDeg - startDeg > 180 ? 1 : 0
    const x1 = cx + r1 * Math.cos(s),
      y1 = cy + r1 * Math.sin(s)
    const x2 = cx + r2 * Math.cos(s),
      y2 = cy + r2 * Math.sin(s)
    const x3 = cx + r2 * Math.cos(e),
      y3 = cy + r2 * Math.sin(e)
    const x4 = cx + r1 * Math.cos(e),
      y4 = cy + r1 * Math.sin(e)
    return `M ${x1.toFixed(2)},${y1.toFixed(2)} L ${x2.toFixed(2)},${y2.toFixed(2)} A ${r2} ${r2} 0 ${large} 1 ${x3.toFixed(2)},${y3.toFixed(2)} L ${x4.toFixed(2)},${y4.toFixed(2)} A ${r1} ${r1} 0 ${large} 0 ${x1.toFixed(2)},${y1.toFixed(2)} Z`
  }

  let qAngle = 0
  const quarterArcs = quarterTotals
    .map((v, i) => {
      const sweep = (v / total) * 360
      const arc = { start: qAngle, end: qAngle + sweep, value: v, q: i }
      qAngle += sweep
      return arc
    })
    .filter((a) => a.value > 0)

  let mAngle = 0
  const monthArcs = monthTotals
    .map((v, i) => {
      const sweep = (v / total) * 360
      const arc = { start: mAngle, end: mAngle + sweep, value: v, m: i }
      mAngle += sweep
      return arc
    })
    .filter((a) => a.value > 0)

  const maxMonthVal = Math.max(...monthTotals, 1)

  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-[200px] mx-auto">
      {quarterArcs.map((a, i) => (
        <path
          key={i}
          d={arcPath(innerR, midR, a.start, a.end)}
          fill={QCOLORS[a.q]}
          fillOpacity="0.85"
          stroke="#000"
          strokeWidth="1.5"
        >
          <title>
            Q{a.q + 1}: {fmtSec(a.value)}
          </title>
        </path>
      ))}
      {monthArcs.map((a, i) => {
        const qIdx = Math.floor(a.m / 3)
        const opacity = 0.3 + (a.value / maxMonthVal) * 0.55
        return (
          <path
            key={i}
            d={arcPath(midR + 2, outerR, a.start, a.end)}
            fill={QCOLORS[qIdx]}
            fillOpacity={opacity}
            stroke="#000"
            strokeWidth="1"
          >
            <title>
              {MONTH_NAMES[a.m]}: {fmtSec(a.value)}
            </title>
          </path>
        )
      })}
      <circle
        cx={cx}
        cy={cy}
        r={innerR}
        fill="#000"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="1"
      />
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontSize="7"
        fill="rgba(255,255,255,0.5)"
        fontFamily="sans-serif"
        fontWeight="bold"
      >
        TOTAL
      </text>
      <text
        x={cx}
        y={cy + 7}
        textAnchor="middle"
        fontSize="6.5"
        fill="rgba(255,255,255,0.35)"
        fontFamily="sans-serif"
      >
        {fmtSec(total)}
      </text>
    </svg>
  )
}

// ===========================================================================
// AlluvialChart — reading time flowing from source to top authors
// ===========================================================================

function AlluvialChart({ byAuthor }: { byAuthor: AuthorEntry[] }) {
  const [tip, setTip] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)

  if (byAuthor.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-white/20 text-xs normal-case">
        No reading data yet
      </div>
    )
  }
  const top = byAuthor.slice(0, 8)
  const total = top.reduce((s, a) => s + a.total_seconds, 0)
  const W = 520,
    H = 260
  const srcX = 24,
    nodeW = 14,
    srcH = H * 0.82
  const srcY = (H - srcH) / 2
  const dstX = 260
  const mx = srcX + nodeW + (dstX - srcX - nodeW) / 2

  // Right-side node y positions
  const totalBarH = top.reduce(
    (s, a) => s + (a.total_seconds / total) * srcH,
    0
  )
  const gaps = Math.max((srcH - totalBarH) / (top.length + 1), 5)
  let ry = srcY + gaps
  const rightNodes = top.map((a) => {
    const h = (a.total_seconds / total) * srcH
    const y = ry
    ry += h + gaps
    return { ...a, y, h }
  })

  // Left-side flow slices (same proportions)
  let srcOffset = srcY
  const flowSlices = top.map((a) => {
    const h = (a.total_seconds / total) * srcH
    const y = srcOffset
    srcOffset += h
    return { srcY: y, srcH: h }
  })

  return (
    <div className="relative">
      {tip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1.5 bg-black border border-white/20 text-[10px] font-bold text-white/90 whitespace-nowrap"
          style={{ left: tip.x + 12, top: tip.y - 8 }}
        >
          {tip.text}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 220 }}>
        <rect
          x={srcX}
          y={srcY.toFixed(1)}
          width={nodeW}
          height={srcH.toFixed(1)}
          fill="#258cf4"
          fillOpacity="0.7"
          rx="2"
          style={{ cursor: 'default' }}
          onMouseMove={(e) =>
            setTip({
              x: e.clientX,
              y: e.clientY,
              text: `Total: ${fmtSec(total)} across ${top.length} authors`,
            })
          }
          onMouseLeave={() => setTip(null)}
        />
        <text
          x={srcX + nodeW + 5}
          y={(srcY + srcH / 2).toFixed(1)}
          fontSize="7"
          fill="rgba(255,255,255,0.45)"
          fontFamily="sans-serif"
          fontWeight="bold"
          dominantBaseline="middle"
        >
          ALL
        </text>
        {flowSlices.map((f, i) => {
          const rn = rightNodes[i]
          const d = `M ${srcX + nodeW},${f.srcY.toFixed(1)} C ${mx},${f.srcY.toFixed(1)} ${mx},${rn.y.toFixed(1)} ${dstX},${rn.y.toFixed(1)} L ${dstX},${(rn.y + rn.h).toFixed(1)} C ${mx},${(rn.y + rn.h).toFixed(1)} ${mx},${(f.srcY + f.srcH).toFixed(1)} ${srcX + nodeW},${(f.srcY + f.srcH).toFixed(1)} Z`
          const pct = Math.round((rn.total_seconds / total) * 100)
          return (
            <path
              key={i}
              d={d}
              fill="#258cf4"
              fillOpacity={0.06 + (rn.h / srcH) * 0.22}
              style={{ cursor: 'default' }}
              onMouseMove={(e) =>
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  text: `${rn.author} · ${fmtSec(rn.total_seconds)} · ${pct}% of total`,
                })
              }
              onMouseLeave={() => setTip(null)}
            />
          )
        })}
        {rightNodes.map((n, i) => (
          <g key={i}>
            <rect
              x={dstX}
              y={n.y.toFixed(1)}
              width={nodeW}
              height={n.h.toFixed(1)}
              fill="#258cf4"
              fillOpacity={0.4 + (n.total_seconds / total) * 0.5}
              rx="2"
              style={{ cursor: 'default' }}
              onMouseMove={(e) =>
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  text: `${n.author} · ${fmtSec(n.total_seconds)} · ${n.session_count} sessions`,
                })
              }
              onMouseLeave={() => setTip(null)}
            />
            <text
              x={dstX + nodeW + 5}
              y={(n.y + n.h * 0.38).toFixed(1)}
              fontSize="7.5"
              fill="rgba(255,255,255,0.65)"
              fontFamily="sans-serif"
              fontWeight="bold"
              dominantBaseline="middle"
            >
              {n.author.length > 26 ? n.author.slice(0, 26) + '…' : n.author}
            </text>
            <text
              x={dstX + nodeW + 5}
              y={(n.y + n.h * 0.38 + 10).toFixed(1)}
              fontSize="6.5"
              fill="rgba(255,255,255,0.3)"
              fontFamily="sans-serif"
              dominantBaseline="middle"
            >
              {fmtSec(n.total_seconds)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ===========================================================================
// ScatterChart — author bubbles (X=sessions, Y=avg duration, size=total time)
// ===========================================================================

function ScatterChart({ byAuthor }: { byAuthor: AuthorEntry[] }) {
  const [tip, setTip] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)

  if (byAuthor.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-white/20 text-xs normal-case">
        No reading data yet
      </div>
    )
  }
  const points = byAuthor.map((a) => ({
    author: a.author,
    x: a.session_count,
    y: a.session_count > 0 ? a.total_seconds / a.session_count : 0,
    r: a.total_seconds,
  }))
  const maxX = Math.max(...points.map((p) => p.x), 1)
  const maxY = Math.max(...points.map((p) => p.y), 1)
  const maxR = Math.max(...points.map((p) => p.r), 1)
  const W = 340,
    H = 200
  const pad = { t: 12, r: 12, b: 28, l: 38 }
  const pw = W - pad.l - pad.r,
    ph = H - pad.t - pad.b

  return (
    <div className="relative">
      {tip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1.5 bg-black border border-white/20 text-[10px] font-bold text-white/90 whitespace-nowrap"
          style={{ left: tip.x + 12, top: tip.y - 8 }}
        >
          {tip.text}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 180 }}>
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={`h${t}`}
            x1={pad.l}
            y1={(pad.t + ph * (1 - t)).toFixed(1)}
            x2={pad.l + pw}
            y2={(pad.t + ph * (1 - t)).toFixed(1)}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="1"
          />
        ))}
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={`v${t}`}
            x1={(pad.l + pw * t).toFixed(1)}
            y1={pad.t}
            x2={(pad.l + pw * t).toFixed(1)}
            y2={pad.t + ph}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="1"
          />
        ))}
        {[0, 0.5, 1].map((t) => (
          <text
            key={t}
            x={pad.l - 3}
            y={(pad.t + ph * (1 - t)).toFixed(1)}
            textAnchor="end"
            fontSize="6"
            fill="rgba(255,255,255,0.25)"
            fontFamily="sans-serif"
            dominantBaseline="middle"
          >
            {fmtSec(Math.round(maxY * t))}
          </text>
        ))}
        {[0, 0.5, 1].map((t) => (
          <text
            key={t}
            x={(pad.l + pw * t).toFixed(1)}
            y={pad.t + ph + 10}
            textAnchor="middle"
            fontSize="6"
            fill="rgba(255,255,255,0.25)"
            fontFamily="sans-serif"
          >
            {Math.round(maxX * t)}
          </text>
        ))}
        {points.map((p, i) => {
          const bx = pad.l + (p.x / maxX) * pw
          const by = pad.t + ph - (p.y / maxY) * ph
          const br = 4 + (p.r / maxR) * 14
          return (
            <g key={i}>
              <circle
                cx={bx.toFixed(1)}
                cy={by.toFixed(1)}
                r={br.toFixed(1)}
                fill="#258cf4"
                fillOpacity={0.12 + (p.r / maxR) * 0.45}
                stroke="#258cf4"
                strokeWidth="1"
                strokeOpacity="0.35"
                style={{ cursor: 'default' }}
                onMouseMove={(e) =>
                  setTip({
                    x: e.clientX,
                    y: e.clientY,
                    text: `${p.author} · ${p.x} sessions · avg ${fmtSec(Math.round(p.y))} · ${fmtSec(p.r)} total`,
                  })
                }
                onMouseLeave={() => setTip(null)}
              />
              {p.r / maxR > 0.15 && (
                <text
                  x={bx.toFixed(1)}
                  y={(by - br - 2).toFixed(1)}
                  textAnchor="middle"
                  fontSize="5.5"
                  fill="rgba(255,255,255,0.4)"
                  fontFamily="sans-serif"
                  fontWeight="bold"
                >
                  {p.author.split(' ').slice(-1)[0]}
                </text>
              )}
            </g>
          )
        })}
        <text
          x={pad.l + pw / 2}
          y={H - 2}
          textAnchor="middle"
          fontSize="7"
          fill="rgba(255,255,255,0.25)"
          fontFamily="sans-serif"
          fontWeight="bold"
        >
          SESSIONS
        </text>
        <text
          x={9}
          y={pad.t + ph / 2}
          textAnchor="middle"
          fontSize="7"
          fill="rgba(255,255,255,0.25)"
          fontFamily="sans-serif"
          fontWeight="bold"
          transform={`rotate(-90,9,${pad.t + ph / 2})`}
        >
          AVG SESSION
        </text>
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
  const [tip, setTip] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
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
    <div className="relative">
      {tip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1.5 bg-black border border-white/20 text-[10px] font-bold text-white/90 whitespace-nowrap"
          style={{ left: tip.x + 12, top: tip.y - 8 }}
        >
          {tip.text}
        </div>
      )}
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
              style={{ height: 80, overflow: 'hidden' }}
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
                          className={`h-3 rounded-full px-1.5 text-[7px] flex items-center truncate cursor-default ${BOOK_COLOR_CLASSES[ci]} ${BOOK_TEXT_CLASSES[ci]}`}
                          onMouseMove={(e) =>
                            setTip({
                              x: e.clientX,
                              y: e.clientY,
                              text: `${book.title} — ${fmtSec(book.duration)}`,
                            })
                          }
                          onMouseLeave={() => setTip(null)}
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
// CompletedBooksCarousel
// ===========================================================================

function fmtCompletedDate(val: string): string {
  if (!val) return ''
  // Handle "2026-03-01 10:30:00" (SQLite space-separated) as well as ISO
  const d = new Date(val.replace(' ', 'T'))
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function CompletedBooksCarousel({ books }: { books: CompletedBook[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scroll = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 300, behavior: 'smooth' })
  }
  if (books.length === 0) return null
  return (
    <div className="flex items-start gap-2">
      <button
        onClick={() => scroll(-1)}
        className="shrink-0 mt-[52px] p-2 border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-colors"
        aria-label="Scroll left"
      >
        <ChevronLeft size={14} />
      </button>
      <div
        ref={scrollRef}
        className="flex-1 flex gap-4 overflow-x-auto pb-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {books.map((book) => (
          <Link
            key={book.book_id}
            to={`/books/${book.book_id}`}
            className="shrink-0 w-[96px] group"
          >
            <div className="w-[96px] h-[144px] bg-white/5 mb-2 border border-white/10 group-hover:border-primary transition-colors overflow-hidden">
              <img
                src={getBookCoverUrl(book.book_id, book.cover_path)}
                alt={book.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </div>
            <p className="text-[9px] font-black uppercase tracking-tight leading-tight truncate w-[96px]">
              {book.title}
            </p>
            {book.author && (
              <p className="text-[9px] text-white/40 normal-case truncate w-[96px]">
                {book.author}
              </p>
            )}
            {book.completed_at && (
              <p className="text-[9px] text-primary/60 font-bold normal-case mt-0.5">
                {fmtCompletedDate(book.completed_at)}
              </p>
            )}
          </Link>
        ))}
      </div>
      <button
        onClick={() => scroll(1)}
        className="shrink-0 mt-[52px] p-2 border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-colors"
        aria-label="Scroll right"
      >
        <ChevronRight size={14} />
      </button>
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
          className="bg-black p-6 col-span-6 lg:col-span-3"
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

      {/* Reading time bar chart — full row */}
      <div className="bg-black p-6 col-span-12">
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

      {/* Monthly calendar — full row */}
      <div className="bg-black p-6 col-span-12">
        <MonthCalendar
          year={calYear}
          month={calMonth}
          days={calendarDays}
          onPrev={onCalPrev}
          onNext={onCalNext}
        />
      </div>

      {/* Streaks row */}
      <div className="bg-black p-6 col-span-12">
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
        <div className="bg-black p-6 col-span-12">
          <h3 className="text-sm font-black uppercase tracking-widest mb-6">
            Books Completed
          </h3>
          <CompletedBooksCarousel books={completed} />
        </div>
      )}

      {/* By author */}
      <div className="bg-black p-6 col-span-12 md:col-span-6 lg:col-span-4">
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

      {/* Reading profile radar */}
      <div className="bg-black p-6 col-span-12 md:col-span-6 lg:col-span-4">
        <h3 className="text-sm font-black uppercase tracking-widest mb-4">
          Reading Profile
        </h3>
        <RadarChart
          speed={avgSpeed !== null ? Math.min((avgSpeed / 100) * 100, 100) : 0}
          consistency={
            streaks !== null ? Math.min((streaks.current / 30) * 100, 100) : 0
          }
          volume={
            overview !== null
              ? Math.min((overview.total_pages_read / 5000) * 100, 100)
              : 0
          }
          completion={
            overview !== null && overview.books_owned > 0
              ? Math.min(
                  (overview.books_read / overview.books_owned) * 100,
                  100
                )
              : 0
          }
          diversity={Math.min((byAuthor.length / 20) * 100, 100)}
        />
      </div>

      {/* Time of day */}
      <div className="bg-black p-6 col-span-12 md:col-span-6 lg:col-span-4">
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
  monthlyData,
  granularity,
  setGranularity,
}: {
  readingTime: TimeSeriesEntry[]
  pagesData: TimeSeriesEntry[]
  monthlyData: TimeSeriesEntry[]
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
      <div className="bg-black p-6 col-span-12">
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

      <div className="bg-black p-6 col-span-12">
        <BarChart
          data={readingTime}
          granularity={granularity}
          height={240}
          data-testid="reading-time-chart-big"
        />
      </div>

      <div className="bg-black p-6 col-span-12 md:col-span-6">
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

      <div className="bg-black p-6 col-span-12 md:col-span-6">
        <h3 className="text-sm font-black uppercase tracking-widest mb-6">
          Reading Time Trend
        </h3>
        <LineChart
          data={readingTime}
          granularity={granularity}
          data-testid="speed-chart"
        />
      </div>

      {/* Sunburst: quarter → month breakdown */}
      <div className="bg-black p-6 col-span-12 md:col-span-6">
        <h3 className="text-sm font-black uppercase tracking-widest mb-4">
          Quarterly Breakdown
        </h3>
        <p className="text-[10px] text-white/30 font-bold normal-case mb-4">
          Inner ring = quarters · outer ring = months
        </p>
        <SunburstChart monthlyData={monthlyData} />
      </div>

      <div className="bg-black p-6 col-span-12 md:col-span-6">
        <h3 className="text-sm font-black uppercase tracking-widest mb-4">
          By Quarter
        </h3>
        {(() => {
          const monthTotals = Array.from({ length: 12 }, () => 0)
          for (const d of monthlyData) {
            const m = parseInt(d.date.split('-')[1] ?? '0', 10) - 1
            if (m >= 0 && m < 12) monthTotals[m] += d.value
          }
          const quarters = [0, 1, 2, 3].map((q) => ({
            label: `Q${q + 1}`,
            value: monthTotals
              .slice(q * 3, q * 3 + 3)
              .reduce((a, b) => a + b, 0),
          }))
          const qMax = Math.max(...quarters.map((q) => q.value), 1)
          return (
            <div className="space-y-4">
              {quarters.map((q) => (
                <HorizontalBar
                  key={q.label}
                  label={q.label}
                  value={q.value}
                  max={qMax}
                />
              ))}
            </div>
          )
        })()}
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
      <div className="bg-black p-6">
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
      {/* Row 1: Author bars + Tag bars (same height, top 8) */}
      <div className="bg-black p-6 col-span-12 md:col-span-6">
        <h3 className="text-sm font-black uppercase tracking-widest mb-6">
          Reading by Author
        </h3>
        {byAuthor.length === 0 ? (
          <p className="text-white/20 text-xs normal-case">
            No reading data yet
          </p>
        ) : (
          <div className="space-y-4">
            {byAuthor.slice(0, 8).map((a) => (
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

      <div className="bg-black p-6 col-span-12 md:col-span-6">
        <h3 className="text-sm font-black uppercase tracking-widest mb-6">
          Reading by Tag
        </h3>
        {byTag.length === 0 ? (
          <p className="text-white/20 text-xs normal-case">
            No tagged books with reading data
          </p>
        ) : (
          <div className="space-y-4">
            {byTag.slice(0, 8).map((t) => (
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

      {/* Row 2: Time flow + Author engagement map */}
      <div className="bg-black p-6 col-span-12 md:col-span-6">
        <h3 className="text-sm font-black uppercase tracking-widest mb-2">
          Time Flow by Author
        </h3>
        <p className="text-[10px] text-white/30 font-bold normal-case mb-4">
          Reading time flowing from total to individual authors
        </p>
        <AlluvialChart byAuthor={byAuthor} />
      </div>

      <div className="bg-black p-6 col-span-12 md:col-span-6">
        <h3 className="text-sm font-black uppercase tracking-widest mb-2">
          Author Engagement Map
        </h3>
        <p className="text-[10px] text-white/30 font-bold normal-case mb-4">
          X = sessions · Y = avg session length · size = total time
        </p>
        <ScatterChart byAuthor={byAuthor} />
      </div>

      {completed.length > 0 && (
        <div className="bg-black p-6 col-span-12">
          <h3 className="text-sm font-black uppercase tracking-widest mb-6">
            Completed Books — Timeline
          </h3>
          <CompletedBooksCarousel books={completed} />
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// StreakHistoryBadges — paginated 2-row grid
// ===========================================================================

function StreakHistoryBadges({
  history,
  longest,
}: {
  history: { start: string; end: string; days: number }[]
  longest: number
}) {
  const [page, setPage] = useState(0)
  const PER_PAGE = 14
  const sorted = useMemo(
    () => [...history].sort((a, b) => b.days - a.days),
    [history]
  )
  const totalPages = Math.ceil(sorted.length / PER_PAGE)
  const items = sorted.slice(page * PER_PAGE, (page + 1) * PER_PAGE)

  const fmtRunDate = (s: string) =>
    new Date(s + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })

  return (
    <div className="bg-black p-6 col-span-12">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-black uppercase tracking-widest">
          Streak History
        </h3>
        {totalPages > 1 && (
          <div className="flex items-center gap-1 text-[10px] font-bold text-white/40">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 hover:text-white disabled:opacity-20 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="p-1 hover:text-white disabled:opacity-20 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {items.map((run, i) => {
          const isMax = run.days === longest
          return (
            <div
              key={i}
              className={`px-3 py-2 border ${isMax ? 'border-primary text-primary' : 'border-white/10 text-white/50'}`}
            >
              <p className="text-sm font-black">{run.days}d</p>
              <p className="text-[9px] font-bold text-white/30 normal-case">
                {fmtRunDate(run.start)} – {fmtRunDate(run.end)}
              </p>
            </div>
          )
        })}
      </div>
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
      <div className="bg-black p-6 col-span-12 sm:col-span-4">
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

      <div className="bg-black p-6 col-span-12 sm:col-span-4">
        <p className="text-[10px] font-black tracking-widest text-white/40 mb-1">
          Longest Streak
        </p>
        <p className="text-5xl font-black tracking-tighter">
          {streaks?.longest ?? 0}
        </p>
        <p className="text-[10px] text-white/30 font-bold mt-1">days</p>
      </div>

      <div className="bg-black p-6 col-span-12 sm:col-span-4">
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
      <div className="bg-black p-6 col-span-12">
        <ReadingHeatmap
          data={heatmap}
          year={CURRENT_YEAR}
          streak={streaks?.current ?? 0}
        />
      </div>

      {/* Radial clock */}
      <div className="bg-black p-6 col-span-12 sm:col-span-4">
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
      <div className="bg-black p-6 col-span-12 sm:col-span-4">
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
      <div className="bg-black p-6 col-span-12 sm:col-span-4">
        <h3 className="text-sm font-black uppercase tracking-widest mb-4">
          Day of Week
        </h3>
        {distribution ? (
          <DayOfWeekChart data={distribution.by_weekday} />
        ) : (
          <p className="text-white/20 text-xs normal-case">Loading…</p>
        )}
      </div>

      {/* Streak history badges — paginated */}
      {streaks && streaks.history.length > 0 && (
        <StreakHistoryBadges
          history={streaks.history}
          longest={streaks.longest}
        />
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
  const { data: overview } = useApi<StatsOverview>(
    `/api/stats/overview${fromParam ? `?${fromParam.slice(1)}` : ''}`
  )
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
    `/api/stats/books-completed${fromParam ? `?${fromParam.slice(1)}` : ''}`
  )
  const { data: calendarDays } = useApi<CalendarDay[]>(
    `/api/stats/calendar?year=${calYear}&month=${calMonth}`
  )
  const { data: monthlyData } = useApi<TimeSeriesEntry[]>(
    '/api/stats/reading-time?granularity=month'
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
      <header className="flex flex-wrap items-center justify-between gap-4 px-4 md:px-6 py-4 md:py-5 border-b border-white/10 sticky top-0 bg-black/90 backdrop-blur-md z-40">
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
      <div className="p-4 md:p-6 lg:p-10 min-w-0">
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
            monthlyData={monthlyData ?? []}
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
        </div>
      </div>
    </div>
  )
}
