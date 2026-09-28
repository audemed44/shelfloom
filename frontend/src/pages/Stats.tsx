import { useState, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Flame, ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react'
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
  sessions: number
  reading_days: number
  pages_per_hour: number | null
  first_session_date: string | null
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

// Swiss palette: blues, neutrals and a single red, each with a readable label
const BOOK_COLOR_CLASSES = [
  'bg-primary',
  'bg-white',
  'bg-primary-300',
  'bg-neutral-500',
  'bg-primary-800',
  'bg-accent',
  'bg-neutral-300',
  'bg-primary-500/50',
]

const BOOK_TEXT_CLASSES = [
  'text-white',
  'text-black',
  'text-black',
  'text-white',
  'text-white',
  'text-white',
  'text-black',
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

const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1

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

function daysAgo(isoDate: string): string {
  const then = new Date(`${isoDate}T00:00:00`)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const n = Math.round((now.getTime() - then.getTime()) / 86400000)
  if (n <= 0) return 'Today'
  if (n === 1) return 'Yesterday'
  return `${n} days ago`
}

function fmtDays(n: number): string {
  return `${n} ${n === 1 ? 'Day' : 'Days'}`
}

function bookColorIdx(bookId: string): number {
  let h = 0
  for (let i = 0; i < bookId.length; i++)
    h = (h * 31 + bookId.charCodeAt(i)) & 0xffff
  return h % BOOK_COLOR_CLASSES.length
}

/** `&from=` for the preset: the start of the day 29 (or 364) days ago, so the
 * range is exactly 30 (or 365) days including today. */
function buildFromParam(preset: DatePreset): string {
  if (preset === 'all') return ''
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() - (preset === '30d' ? 29 : 364))
  return `&from=${encodeURIComponent(from.toISOString())}`
}

function parseBucketDate(bucket: string): Date {
  return new Date(`${bucket}T00:00:00`)
}

/** Short axis label for a time-series bucket (days and weeks are ISO dates). */
function fmtBucket(bucket: string, gran: Granularity): string {
  if (gran === 'month') {
    const [y, m] = bucket.split('-')
    return `${MONTH_NAMES[parseInt(m ?? '1', 10) - 1]} '${(y ?? '').slice(2)}`
  }
  const d = parseBucketDate(bucket)
  if (Number.isNaN(d.getTime())) return bucket
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Full label for a bucket, for readouts. */
function fmtBucketLong(bucket: string, gran: Granularity): string {
  if (gran === 'month') {
    const [y, m] = bucket.split('-')
    return `${MONTH_NAMES[parseInt(m ?? '1', 10) - 1]} ${y}`
  }
  const d = parseBucketDate(bucket)
  if (Number.isNaN(d.getTime())) return bucket
  if (gran === 'week')
    return `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

// ===========================================================================
// Axes
// ===========================================================================

type ValueKind = 'time' | 'count'

// Tick steps for durations, in seconds: minutes up to hours up to hundreds of hours.
const TIME_STEPS = [
  60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 18000, 36000, 72000, 180000,
  360000, 720000, 1800000, 3600000,
]

/** A zero-based axis with at most `maxTicks` round steps above zero. */
function niceScale(
  max: number,
  kind: ValueKind,
  maxTicks = 4
): { top: number; ticks: number[] } {
  if (max <= 0) {
    const top = kind === 'time' ? 3600 : 1
    return { top, ticks: [0, top] }
  }
  let step: number
  if (kind === 'time') {
    step =
      TIME_STEPS.find((s) => Math.ceil(max / s) <= maxTicks) ??
      Math.ceil(max / maxTicks / 3600) * 3600
  } else {
    const raw = max / maxTicks
    const mag = 10 ** Math.floor(Math.log10(raw))
    step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!)
  }
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let i = 0; i * step <= top; i++) ticks.push(i * step)
  return { top, ticks }
}

function fmtTick(v: number, kind: ValueKind): string {
  if (kind === 'count')
    return v >= 10000 ? `${Math.round(v / 1000)}k` : v.toLocaleString()
  if (v === 0) return '0'
  if (v < 3600) return `${Math.round(v / 60)}m`
  const h = v / 3600
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}

function fmtValue(v: number, kind: ValueKind): string {
  return kind === 'time' ? fmtSec(v) : Math.round(v).toLocaleString()
}

/** Evenly spaced indices for at most `max` axis labels. */
function pickLabelIndices(n: number, max = 6): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i)
  const step = Math.ceil((n - 1) / (max - 1))
  const out: number[] = []
  for (let i = 0; i < n; i += step) out.push(i)
  // Always label the last bucket: replace the final pick if it's too close.
  if (out[out.length - 1] !== n - 1) {
    if (n - 1 - out[out.length - 1] < step / 2) out.pop()
    out.push(n - 1)
  }
  return out
}

/** Y axis, gridlines and a plot area; tick labels sit exactly on their gridlines. */
function PlotFrame({
  kind,
  scale,
  height,
  below,
  children,
}: {
  kind: ValueKind
  scale: { top: number; ticks: number[] }
  height: number
  below?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-2">
      <div className="relative w-8 shrink-0" style={{ height }} aria-hidden>
        {scale.ticks.map((t) => (
          <span
            key={t}
            className="absolute right-0 translate-y-1/2 whitespace-nowrap text-[9px] font-semibold leading-none tabular-nums text-white/35"
            style={{ bottom: `${(t / scale.top) * 100}%` }}
          >
            {fmtTick(t, kind)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative border-b border-white/25" style={{ height }}>
          {scale.ticks.slice(1).map((t) => (
            <div
              key={t}
              className="pointer-events-none absolute inset-x-0 border-t border-white/[0.07]"
              style={{ bottom: `${(t / scale.top) * 100}%` }}
            />
          ))}
          {children}
        </div>
        {below}
      </div>
    </div>
  )
}

/** Category labels under a plot, centred on their bar and never truncated. */
function XLabels({
  labels,
  count,
  active,
}: {
  labels: { index: number; text: string }[]
  count: number
  active: number | null
}) {
  return (
    <div className="relative mt-1.5 h-3" aria-hidden>
      {labels.map(({ index, text }, k) => {
        const centre = ((index + 0.5) / count) * 100
        const style: React.CSSProperties =
          k === 0 && centre < 10
            ? { left: 0 }
            : k === labels.length - 1 && centre > 90
              ? { right: 0 }
              : { left: `${centre}%`, transform: 'translateX(-50%)' }
        return (
          <span
            key={index}
            className={`absolute whitespace-nowrap text-[9px] font-semibold leading-none ${active === index ? 'text-white' : 'text-white/40'}`}
            style={style}
          >
            {text}
          </span>
        )
      })}
    </div>
  )
}

interface BarItem {
  key: string
  /** Short axis label. */
  label: string
  /** Full label for the readout. */
  detail: string
  value: number
}

/**
 * Single-series bar chart. Hover (or tap) a bar to read it; otherwise the
 * readout names the peak.
 */
function Bars({
  items,
  kind,
  height = 180,
  labelIndices,
  labelText,
  empty = 'No data for this period',
  'data-testid': testId,
}: {
  items: BarItem[]
  kind: ValueKind
  height?: number
  labelIndices?: number[]
  labelText?: (item: BarItem, index: number) => string
  empty?: string
  'data-testid'?: string
}) {
  const [active, setActive] = useState<number | null>(null)
  if (items.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-white/30"
        style={{ height }}
        data-testid={testId}
      >
        {empty}
      </div>
    )
  }
  const max = Math.max(0, ...items.map((i) => i.value))
  const scale = niceScale(max, kind)
  const peak = items.reduce(
    (b, it, i) => (it.value > items[b].value ? i : b),
    0
  )
  const n = items.length
  const gap = n > 45 ? '' : n > 16 ? 'gap-px' : 'gap-1'
  const shown = active !== null ? items[active] : null
  const labels = (labelIndices ?? pickLabelIndices(n)).map((index) => ({
    index,
    text: labelText ? labelText(items[index], index) : items[index].label,
  }))
  return (
    <div data-testid={testId}>
      <p className="mb-2 h-4 truncate text-[11px] font-semibold tabular-nums">
        {shown ? (
          <>
            <span className="text-white/55">{shown.detail} — </span>
            <span className="text-primary-400">
              {fmtValue(shown.value, kind)}
            </span>
          </>
        ) : max > 0 ? (
          <span className="text-white/35">
            Most: {items[peak].detail} — {fmtValue(items[peak].value, kind)}
          </span>
        ) : (
          <span className="text-white/35">Nothing recorded</span>
        )}
      </p>
      <PlotFrame
        kind={kind}
        scale={scale}
        height={height}
        below={<XLabels labels={labels} count={n} active={active} />}
      >
        <div
          className={`absolute inset-0 flex items-end ${gap}`}
          onMouseLeave={() => setActive(null)}
        >
          {items.map((it, i) => (
            <div
              key={it.key}
              className="flex h-full min-w-0 flex-1 cursor-default items-end"
              onMouseEnter={() => setActive(i)}
              onClick={() => setActive(active === i ? null : i)}
              aria-label={`${it.detail}: ${fmtValue(it.value, kind)}`}
            >
              {it.value > 0 && (
                <div
                  className={`w-full transition-colors ${active === i ? 'bg-white' : 'bg-primary'}`}
                  style={{
                    height: `${Math.max(1.5, (it.value / scale.top) * 100)}%`,
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </PlotFrame>
    </div>
  )
}

/** Time-series buckets as bars, merging neighbours when there are too many to draw. */
function seriesItems(
  data: TimeSeriesEntry[],
  granularity: Granularity,
  maxBars = 60
): BarItem[] {
  const chunk = Math.max(1, Math.ceil(data.length / maxBars))
  const out: BarItem[] = []
  for (let i = 0; i < data.length; i += chunk) {
    const part = data.slice(i, i + chunk)
    const first = part[0].date
    const last = part[part.length - 1].date
    out.push({
      key: first,
      label: fmtBucket(first, granularity),
      detail:
        part.length > 1
          ? `${granularity === 'week' ? 'Weeks of ' : ''}${fmtBucket(first, granularity)} – ${fmtBucket(last, granularity)}`
          : fmtBucketLong(first, granularity),
      value: part.reduce((s, d) => s + d.value, 0),
    })
  }
  return out
}

function BarChart({
  data,
  granularity,
  height = 192,
  'data-testid': testId,
}: {
  data: TimeSeriesEntry[]
  granularity: Granularity
  height?: number
  'data-testid'?: string
}) {
  const items = useMemo(
    () => seriesItems(data, granularity),
    [data, granularity]
  )
  return <Bars items={items} kind="time" height={height} data-testid={testId} />
}

// ===========================================================================
// CumulativeChart — running total as a line
// ===========================================================================

function CumulativeChart({
  data,
  granularity,
  kind,
  'data-testid': testId,
}: {
  data: TimeSeriesEntry[]
  granularity: Granularity
  kind: ValueKind
  'data-testid'?: string
}) {
  const [active, setActive] = useState<number | null>(null)
  const points = useMemo(() => {
    let running = 0
    return seriesItems(data, granularity, 120).map((d) => ({
      ...d,
      value: (running += d.value),
    }))
  }, [data, granularity])

  if (points.length === 0 || points[points.length - 1].value === 0) {
    return (
      <div
        className="flex h-32 items-center justify-center text-xs text-white/30"
        data-testid={testId}
      >
        No data for this period
      </div>
    )
  }

  const height = 140
  const scale = niceScale(points[points.length - 1].value, kind)
  const n = points.length
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50)
  const y = (v: number) => 100 - (v / scale.top) * 100
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')
  const shown = active !== null ? points[active] : points[n - 1]

  const pick = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    const frac = (clientX - rect.left) / rect.width
    setActive(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))))
  }

  return (
    <div data-testid={testId}>
      <p className="mb-2 h-4 truncate text-[11px] font-semibold tabular-nums">
        <span className="text-white/55">
          {active !== null ? `By ${shown.detail}` : 'Total'} —{' '}
        </span>
        <span className="text-primary-400">{fmtValue(shown.value, kind)}</span>
      </p>
      <PlotFrame
        kind={kind}
        scale={scale}
        height={height}
        below={
          <div className="relative mt-1.5 h-3" aria-hidden>
            {pickLabelIndices(n, 4).map((i, k, all) => (
              <span
                key={i}
                className="absolute whitespace-nowrap text-[9px] font-semibold leading-none text-white/40"
                style={
                  k === 0
                    ? { left: 0 }
                    : k === all.length - 1
                      ? { right: 0 }
                      : { left: `${x(i)}%`, transform: 'translateX(-50%)' }
                }
              >
                {points[i].label}
              </span>
            ))}
          </div>
        }
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full touch-none"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget as never)}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget as never)}
          onPointerLeave={() => setActive(null)}
        >
          <polygon
            points={`0,100 ${line} 100,100`}
            fill="#2563ff"
            fillOpacity="0.15"
          />
          <polyline
            points={line}
            fill="none"
            stroke="#2563ff"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
          {active !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1="0"
              y2="100"
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </PlotFrame>
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
    <div className="flex border border-white/25">
      {(['day', 'week', 'month'] as Granularity[]).map((g) => (
        <button
          key={g}
          onClick={() => onChange(g)}
          data-testid={`gran-${g}`}
          aria-pressed={value === g}
          className={`px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
            value === g
              ? 'bg-white text-black'
              : 'text-white/55 hover:bg-white/[0.06] hover:text-white'
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

const HOUR_LABELS: Record<number, string> = {
  0: '12am',
  6: '6am',
  12: '12pm',
  18: '6pm',
}

function TimeOfDayHistogram({
  data,
}: {
  data: { hour: number; seconds: number }[]
}) {
  const items: BarItem[] = data.map((d) => ({
    key: String(d.hour),
    label: HOUR_LABELS[d.hour] ?? '',
    detail: `${String(d.hour).padStart(2, '0')}:00–${String((d.hour + 1) % 24).padStart(2, '0')}:00`,
    value: d.seconds,
  }))
  return (
    <Bars
      items={items}
      kind="time"
      height={150}
      labelIndices={[0, 6, 12, 18]}
      data-testid="time-of-day"
    />
  )
}

// ===========================================================================
// DayOfWeekChart
// ===========================================================================

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

function DayOfWeekChart({
  data,
}: {
  data: { weekday: number; seconds: number }[]
}) {
  // SQLite weekday: 0=Sun … 6=Sat → render Mon-Sun
  const items: BarItem[] = [1, 2, 3, 4, 5, 6, 0].map((w) => ({
    key: String(w),
    label: WEEKDAYS[w].slice(0, 3),
    detail: WEEKDAYS[w],
    value: data.find((d) => d.weekday === w)?.seconds ?? 0,
  }))
  return (
    <Bars items={items} kind="time" height={120} data-testid="day-of-week" />
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
            fill="#2563ff"
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
// ReadingHabits — plain numbers about how you read in the range
// ===========================================================================

function ReadingHabits({
  overview,
  rangeDays,
  authors,
}: {
  overview: StatsOverview | null
  rangeDays: number | null
  authors: number
}) {
  if (!overview) return <p className="text-xs text-white/30">Loading…</p>
  const days = overview.reading_days ?? 0
  const sessions = overview.sessions ?? 0
  const secs = overview.total_reading_time_seconds
  const share = rangeDays ? Math.min(100, (days / rangeDays) * 100) : null
  const rows: { label: string; value: string; sub?: string }[] = [
    {
      label: 'Days read',
      value: rangeDays ? `${days} of ${rangeDays}` : String(days),
      sub: share !== null ? `${Math.round(share)}% of days` : undefined,
    },
    {
      label: 'Per reading day',
      value: days ? fmtSec(Math.round(secs / days)) : '—',
    },
    {
      label: 'Per session',
      value: sessions ? fmtSec(Math.round(secs / sessions)) : '—',
      sub: `${sessions.toLocaleString()} session${sessions === 1 ? '' : 's'}`,
    },
    {
      label: 'Authors read',
      value: String(authors),
    },
  ]
  return (
    <div data-testid="reading-habits">
      {share !== null && (
        <div className="mb-5 h-1.5 bg-white/10" aria-hidden>
          <div className="h-full bg-primary" style={{ width: `${share}%` }} />
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
        {rows.map((r) => (
          <div key={r.label}>
            <dt className="text-[10px] font-semibold tracking-widest text-white/40">
              {r.label.toUpperCase()}
            </dt>
            <dd className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">
              {r.value}
            </dd>
            {r.sub && <dd className="text-[11px] text-white/40">{r.sub}</dd>}
          </div>
        ))}
      </dl>
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
  const QCOLORS = ['#2563ff', '#5783ff', '#0a47f0', '#0638c4']

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
          fill="#2563ff"
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
              fill="#2563ff"
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
              fill="#2563ff"
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
  // Headroom so the largest bubbles aren't cut off at the top and right edges.
  const maxX = Math.max(...points.map((p) => p.x), 1) * 1.12
  const maxY = Math.max(...points.map((p) => p.y), 1) * 1.2
  const labelled = new Set(
    [...points]
      .sort((a, b) => b.r - a.r)
      .slice(0, 5)
      .map((p) => p.author)
  )
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
                fill="#2563ff"
                fillOpacity={0.12 + (p.r / maxR) * 0.45}
                stroke="#2563ff"
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
              {labelled.has(p.author) && (
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
  const [selected, setSelected] = useState<string | null>(null)
  const selectedBooks =
    selected && selected.startsWith(`${year}-${String(month).padStart(2, '0')}`)
      ? (dayMap.get(selected) ?? null)
      : null

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
        <h3 className="text-lg font-bold tracking-tight">Monthly Reading</h3>
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
        className="border border-white/[0.14]"
        data-testid="calendar-grid"
      >
        {cells.map((cell, i) => {
          const isToday = isCurrentMonth && cell.day === today.getDate()
          const books = cell.dateKey ? (dayMap.get(cell.dateKey) ?? []) : []
          const isSelected = cell.dateKey !== null && cell.dateKey === selected
          return (
            <button
              type="button"
              key={i}
              disabled={cell.day === null || books.length === 0}
              onClick={() =>
                setSelected(isSelected ? null : (cell.dateKey as string))
              }
              className={`h-14 overflow-hidden bg-black p-1 text-left sm:h-20 ${
                isSelected
                  ? 'outline outline-2 -outline-offset-2 outline-white'
                  : isToday
                    ? 'outline outline-1 -outline-offset-1 outline-primary'
                    : ''
              } ${cell.day === null ? 'opacity-20' : ''}`}
              aria-label={
                cell.day !== null
                  ? `${monthLabel} ${cell.day}: ${books.length} book${books.length === 1 ? '' : 's'}`
                  : undefined
              }
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
                          className={`flex h-1.5 items-center truncate rounded-full px-1.5 text-[7px] sm:h-3 ${BOOK_COLOR_CLASSES[ci]} ${BOOK_TEXT_CLASSES[ci]}`}
                          onMouseMove={(e) =>
                            setTip({
                              x: e.clientX,
                              y: e.clientY,
                              text: `${book.title} — ${fmtSec(book.duration)}`,
                            })
                          }
                          onMouseLeave={() => setTip(null)}
                        >
                          <span className="hidden sm:inline">{book.title}</span>
                        </div>
                      )
                    })}
                    {books.length > 3 && (
                      <div className="pl-1 text-[7px] font-bold text-white/40">
                        +{books.length - 3}
                        <span className="hidden sm:inline"> more</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </button>
          )
        })}
      </div>

      {selectedBooks ? (
        <div
          className="mt-4 border-t border-white/[0.14] pt-3"
          data-testid="calendar-day"
        >
          <p className="mb-2 text-xs font-semibold text-white/60">
            {new Date(`${selected}T00:00:00`).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
            {' · '}
            {fmtSec(selectedBooks.reduce((t, b) => t + b.duration, 0))}
          </p>
          <ul className="space-y-1.5">
            {selectedBooks.map((b) => {
              const ci = bookColorIdx(b.book_id)
              return (
                <li key={b.book_id} className="flex items-center gap-2 text-sm">
                  <span
                    className={`size-2.5 shrink-0 rounded-full ${BOOK_COLOR_CLASSES[ci]}`}
                  />
                  <Link
                    to={`/books/${b.book_id}`}
                    className="min-w-0 flex-1 truncate font-semibold text-white hover:underline"
                  >
                    {b.title}
                  </Link>
                  <span className="shrink-0 text-xs tabular-nums text-white/50">
                    {fmtSec(b.duration)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-[10px] font-semibold text-white/35">
          Each bar is a book read that day. Tap a day to see them.
        </p>
      )}
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
  rangeDays: number | null
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
  authorCount: number
  distribution: DistributionData | null
}

function OverviewTab({
  overview,
  rangeDays,
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
  authorCount,
  distribution,
}: OverviewTabProps) {
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(12, 1fr)',
    gap: '1px',
    backgroundColor: 'rgba(255,255,255,0.14)',
  }

  const weeks = rangeDays ? Math.max(rangeDays / 7, 1) : null
  const metrics = [
    {
      label: 'Books Finished',
      value: overview !== null ? String(overview.books_read) : null,
      sub: overview ? `${overview.books_owned} in your library` : undefined,
    },
    {
      label: 'Reading Time',
      value:
        overview !== null ? fmtSec(overview.total_reading_time_seconds) : null,
      sub:
        overview && weeks
          ? `${fmtSec(Math.round(overview.total_reading_time_seconds / weeks))} a week`
          : undefined,
    },
    {
      label: 'Pages Read',
      value:
        overview !== null ? overview.total_pages_read.toLocaleString() : null,
      sub:
        overview?.reading_days != null
          ? `on ${overview.reading_days} day${overview.reading_days === 1 ? '' : 's'}`
          : 'pages read',
    },
    {
      label: 'Speed',
      value:
        overview?.pages_per_hour != null
          ? `${Math.round(overview.pages_per_hour)} p/h`
          : overview !== null
            ? '—'
            : null,
      sub: 'pages per hour',
    },
  ]

  return (
    <div style={gridStyle} className="border border-white/[0.14]">
      {/* Key metrics */}
      {metrics.map(({ label, value, sub }, i) => (
        <div
          key={i}
          className="col-span-6 min-w-0 bg-black p-4 sm:p-6 lg:col-span-3"
          data-testid="metric-card"
        >
          <p className="mb-1 text-[10px] font-black tracking-widest text-white/40">
            {label}
          </p>
          <h2 className="truncate text-3xl font-extrabold tracking-tighter tabular-nums sm:text-5xl">
            {value ?? '—'}
          </h2>
          {sub && (
            <p className="mt-2 text-xs font-bold normal-case text-white/35 sm:mt-3">
              {sub}
            </p>
          )}
        </div>
      ))}

      {/* Reading time bar chart — full row */}
      <div className="col-span-12 bg-black p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="mb-1 text-lg font-bold tracking-tight">
              Reading Time
            </h3>
            <p className="text-xs normal-case text-white/35">
              Per {granularity}
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
      <div className="col-span-12 bg-black p-4 sm:p-6">
        <MonthCalendar
          year={calYear}
          month={calMonth}
          days={calendarDays}
          onPrev={onCalPrev}
          onNext={onCalNext}
        />
      </div>

      {/* Streaks row — across all your reading, not just this range */}
      <div className="col-span-12 bg-black p-4 sm:p-6">
        <div className="flex gap-10 sm:gap-12">
          <div>
            <p className="mb-1 text-[10px] font-black tracking-widest text-white/40">
              Current Streak
            </p>
            <p className="text-3xl font-extrabold tracking-tighter tabular-nums sm:text-5xl">
              {streaks !== null ? fmtDays(streaks.current) : '—'}
            </p>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-black tracking-widest text-white/40">
              Longest Streak
            </p>
            <p className="text-3xl font-extrabold tracking-tighter tabular-nums sm:text-5xl">
              {streaks !== null ? fmtDays(streaks.longest) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Books completed */}
      {completed.length > 0 && (
        <div className="col-span-12 bg-black p-4 sm:p-6">
          <h3 className="mb-6 text-lg font-bold tracking-tight">
            Books Finished
          </h3>
          <CompletedBooksCarousel books={completed} />
        </div>
      )}

      {/* By author */}
      <div className="col-span-12 bg-black p-4 sm:p-6 md:col-span-6 lg:col-span-4">
        <h3 className="mb-6 text-lg font-bold tracking-tight">
          Reading by Author
        </h3>
        {byAuthor.length === 0 ? (
          <p className="text-xs normal-case text-white/30">
            No reading in this period
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

      {/* Reading habits */}
      <div className="col-span-12 bg-black p-4 sm:p-6 md:col-span-6 lg:col-span-4">
        <h3 className="mb-6 text-lg font-bold tracking-tight">
          Reading Habits
        </h3>
        <ReadingHabits
          overview={overview}
          rangeDays={rangeDays}
          authors={authorCount}
        />
      </div>

      {/* Time of day */}
      <div className="col-span-12 bg-black p-4 sm:p-6 md:col-span-12 lg:col-span-4">
        <h3 className="mb-4 text-lg font-bold tracking-tight">Time of Day</h3>
        {distribution ? (
          <TimeOfDayHistogram data={distribution.by_hour} />
        ) : (
          <p className="text-xs normal-case text-white/30">Loading…</p>
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
    backgroundColor: 'rgba(255,255,255,0.14)',
  }
  // The quarter charts are always this calendar year, whatever the range.
  const thisYear = monthlyData.filter((d) =>
    d.date.startsWith(`${CURRENT_YEAR}-`)
  )
  const pageItems = useMemo(
    () => seriesItems(pagesData, granularity),
    [pagesData, granularity]
  )

  return (
    <div style={gridStyle} className="border border-white/[0.14]">
      <div className="col-span-12 bg-black p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="mb-1 text-lg font-bold tracking-tight">
              Reading Time
            </h3>
            <p className="text-xs normal-case text-white/35">
              Per {granularity}
            </p>
          </div>
          <GranularityToggle value={granularity} onChange={setGranularity} />
        </div>
        <BarChart
          data={readingTime}
          granularity={granularity}
          height={240}
          data-testid="reading-time-chart-big"
        />
      </div>

      <div className="col-span-12 bg-black p-4 sm:p-6 md:col-span-6">
        <h3 className="mb-1 text-lg font-bold tracking-tight">Pages Read</h3>
        <p className="mb-4 text-xs normal-case text-white/35">
          Per {granularity}
        </p>
        <Bars
          items={pageItems}
          kind="count"
          height={150}
          data-testid="pages-bars"
        />
      </div>

      <div className="col-span-12 bg-black p-4 sm:p-6 md:col-span-6">
        <h3 className="mb-1 text-lg font-bold tracking-tight">
          Pages Read, Running Total
        </h3>
        <p className="mb-4 text-xs normal-case text-white/35">
          Across the period
        </p>
        <CumulativeChart
          data={pagesData}
          granularity={granularity}
          kind="count"
          data-testid="pages-chart"
        />
      </div>

      {/* Sunburst: quarter → month breakdown */}
      <div className="col-span-12 bg-black p-4 sm:p-6 md:col-span-6">
        <h3 className="mb-1 text-lg font-bold tracking-tight">
          {CURRENT_YEAR} by Quarter
        </h3>
        <p className="mb-4 text-xs normal-case text-white/35">
          Inner ring = quarters · outer ring = months
        </p>
        <SunburstChart monthlyData={thisYear} />
      </div>

      <div className="col-span-12 bg-black p-4 sm:p-6 md:col-span-6">
        <h3 className="mb-1 text-lg font-bold tracking-tight">
          Quarters in {CURRENT_YEAR}
        </h3>
        <p className="mb-4 text-xs normal-case text-white/35">Reading time</p>
        {(() => {
          const monthTotals = Array.from({ length: 12 }, () => 0)
          for (const d of thisYear) {
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
    <div className="border border-white/[0.14]">
      <div className="p-6 bg-black border-b border-white/10">
        <h2 className="text-lg font-bold tracking-tight mb-1">
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
    backgroundColor: 'rgba(255,255,255,0.14)',
  }

  return (
    <div style={gridStyle} className="border border-white/[0.14]">
      {/* Row 1: Author bars + Tag bars (same height, top 8) */}
      <div className="bg-black p-6 col-span-12 md:col-span-6">
        <h3 className="text-lg font-bold tracking-tight mb-6">
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
        <h3 className="text-lg font-bold tracking-tight mb-6">
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

      {/* Row 2: Time flow + Author engagement map. The flow's labels are too
          small to read on a phone, and the author bars above show the same. */}
      <div className="col-span-12 hidden bg-black p-6 md:col-span-6 md:block">
        <h3 className="text-lg font-bold tracking-tight mb-2">
          Time Flow by Author
        </h3>
        <p className="text-[10px] text-white/30 font-bold normal-case mb-4">
          Reading time flowing from total to individual authors
        </p>
        <AlluvialChart byAuthor={byAuthor} />
      </div>

      <div className="bg-black p-6 col-span-12 md:col-span-6">
        <h3 className="text-lg font-bold tracking-tight mb-2">
          Author Engagement Map
        </h3>
        <p className="text-[10px] text-white/30 font-bold normal-case mb-4">
          X = sessions · Y = avg session length · size = total time
        </p>
        <ScatterChart byAuthor={byAuthor} />
      </div>

      {completed.length > 0 && (
        <div className="bg-black p-6 col-span-12">
          <h3 className="text-lg font-bold tracking-tight mb-6">
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

  // Runs from other years carry the year, so they can't be mistaken for this one's.
  const thisYear = new Date().getFullYear()
  const fmtRunDate = (s: string) => {
    const d = new Date(s + 'T00:00:00')
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(d.getFullYear() !== thisYear ? { year: 'numeric' } : {}),
    })
  }

  return (
    <div className="bg-black p-6 col-span-12">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold tracking-tight">Streak History</h3>
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
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(12, 1fr)',
    gap: '1px',
    backgroundColor: 'rgba(255,255,255,0.14)',
  }

  return (
    <div style={gridStyle} className="border border-white/[0.14]">
      {/* Streak summary cards */}
      <div className="col-span-4 min-w-0 bg-black p-4 sm:p-6">
        <p className="text-[10px] font-black tracking-widest text-white/40 mb-1">
          Current Streak
        </p>
        <p className="text-3xl font-extrabold tracking-tighter sm:text-5xl">
          {streaks?.current ?? 0}
        </p>
        <p className="text-[10px] text-white/30 font-bold mt-1">
          {streaks?.current === 1 ? 'day' : 'days'}
        </p>
        {(streaks?.current ?? 0) > 0 && (
          <div className="mt-3 flex items-center gap-2 text-primary text-[10px] font-black">
            <Flame size={12} />
            Keep it up!
          </div>
        )}
      </div>

      <div className="col-span-4 min-w-0 bg-black p-4 sm:p-6">
        <p className="text-[10px] font-black tracking-widest text-white/40 mb-1">
          Longest Streak
        </p>
        <p className="text-3xl font-extrabold tracking-tighter sm:text-5xl">
          {streaks?.longest ?? 0}
        </p>
        <p className="text-[10px] text-white/30 font-bold mt-1">
          {streaks?.longest === 1 ? 'day' : 'days'}
        </p>
      </div>

      <div className="col-span-4 min-w-0 bg-black p-4 sm:p-6">
        <p className="text-[10px] font-black tracking-widest text-white/40 mb-1">
          Last Read
        </p>
        <p className="text-lg font-black tracking-tight sm:text-xl">
          {streaks?.last_read_date
            ? new Date(streaks.last_read_date + 'T00:00:00').toLocaleDateString(
                'en-US',
                {
                  month: 'short',
                  day: 'numeric',
                }
              )
            : '—'}
        </p>
        {streaks?.last_read_date && (
          <p className="text-[10px] text-white/30 font-bold mt-1 normal-case">
            {daysAgo(streaks.last_read_date)}
          </p>
        )}
      </div>

      {/* Annual heatmap */}
      <div className="bg-black p-6 col-span-12">
        <h3 className="text-lg font-bold tracking-tight">Reading Activity</h3>
        <ReadingHeatmap
          data={heatmap}
          year={CURRENT_YEAR}
          streak={streaks?.current ?? 0}
          bare
        />
      </div>

      {/* Radial clock */}
      <div className="bg-black p-6 col-span-12 md:col-span-4">
        <h3 className="text-lg font-bold tracking-tight mb-4">Reading Clock</h3>
        {distribution ? (
          <RadialClock data={distribution.by_hour} />
        ) : (
          <p className="text-white/20 text-xs normal-case">Loading…</p>
        )}
      </div>

      {/* Time of day histogram */}
      <div className="bg-black p-6 col-span-12 md:col-span-4">
        <h3 className="text-lg font-bold tracking-tight mb-4">Time of Day</h3>
        {distribution ? (
          <TimeOfDayHistogram data={distribution.by_hour} />
        ) : (
          <p className="text-white/20 text-xs normal-case">Loading…</p>
        )}
      </div>

      {/* Day of week */}
      <div className="bg-black p-6 col-span-12 md:col-span-4">
        <h3 className="text-lg font-bold tracking-tight mb-4">Day of Week</h3>
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

export default function Stats() {
  const [tab, setTab] = useState<Tab>('overview')
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [preset, setPreset] = useState<DatePreset>('30d')
  const [calYear, setCalYear] = useState(CURRENT_YEAR)
  const [calMonth, setCalMonth] = useState(CURRENT_MONTH)

  const fromParam = useMemo(() => buildFromParam(preset), [preset])
  const rangeQuery = fromParam ? `?${fromParam.slice(1)}` : ''

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: overview } = useApi<StatsOverview>(
    `/api/stats/overview${rangeQuery}`
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
    `/api/stats/distribution${rangeQuery}`
  )
  const { data: byAuthor } = useApi<AuthorEntry[]>(
    `/api/stats/by-author${rangeQuery}`
  )
  const { data: byTag } = useApi<TagEntry[]>(`/api/stats/by-tag${rangeQuery}`)
  const { data: completed } = useApi<CompletedBook[]>(
    `/api/stats/books-completed${rangeQuery}`
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
  // Days the range covers, for per-week and days-read figures. "All time"
  // runs from the first recorded session to today.
  const rangeDays = useMemo((): number | null => {
    if (preset === '30d') return 30
    if (preset === '1y') return 365
    if (!overview?.first_session_date) return null
    const first = new Date(`${overview.first_session_date}T00:00:00`)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Math.max(
      1,
      Math.round((today.getTime() - first.getTime()) / 86400000) + 1
    )
  }, [preset, overview])
  const rangeLabel = DATE_PRESETS.find((p) => p.id === preset)?.label ?? ''

  const authorMax = useMemo(
    () => Math.max(...(byAuthor ?? []).map((a) => a.total_seconds), 1),
    [byAuthor]
  )
  const tagMax = useMemo(
    () => Math.max(...(byTag ?? []).map((t) => t.total_seconds), 1),
    [byTag]
  )

  return (
    <div className="mx-auto min-h-screen max-w-[1600px]">
      {/* Page header */}
      <header className="grid grid-cols-12 gap-4 px-4 pb-6 pt-6 sm:px-6 lg:px-10 lg:pt-10">
        <div className="col-span-12 lg:col-span-8">
          <h1
            className="text-5xl font-extrabold leading-[0.9] tracking-tighter sm:text-7xl"
            data-testid="stats-heading"
          >
            Reading Stats
          </h1>
          <p className="mt-3 text-base text-white/50 sm:text-lg">
            {overview
              ? `${rangeLabel}: ${overview.books_read} ${overview.books_read === 1 ? 'book' : 'books'} finished · ${fmtSec(overview.total_reading_time_seconds)} read`
              : 'Loading…'}
          </p>
        </div>
        <div className="col-span-12 flex flex-wrap items-end gap-3 lg:col-span-4 lg:justify-end">
          <Link
            to={`/stats/year/${new Date().getFullYear()}`}
            className="flex items-center gap-2 border border-white/25 px-4 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white hover:text-black"
            data-testid="year-in-review-link"
          >
            Year in review <ArrowRight size={12} />
          </Link>
          <div
            className="flex w-full border border-white/25 sm:w-auto"
            role="group"
            aria-label="Date range"
          >
            {DATE_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                data-testid={`preset-${p.id}`}
                aria-pressed={preset === p.id}
                className={`flex-1 whitespace-nowrap px-4 py-2 text-xs font-semibold transition-colors sm:flex-none ${
                  preset === p.id
                    ? 'bg-primary text-white'
                    : 'text-white/60 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Tab navigation — numbered, sticky while scrolling */}
      <nav
        className="sticky top-0 z-30 flex overflow-x-auto border-y-2 border-white bg-black px-4 no-scrollbar sm:px-6 lg:px-10"
        aria-label="Stats sections"
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-testid={`tab-${t.id}`}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex items-baseline gap-2 whitespace-nowrap border-t-[3px] px-4 pb-3 pt-2.5 text-sm font-semibold transition-colors first:pl-0 -mt-[2px] ${
              tab === t.id
                ? 'border-primary text-white'
                : 'border-transparent text-white/45 hover:text-white'
            }`}
          >
            <span
              className={`text-[11px] tabular-nums ${tab === t.id ? 'text-primary-400' : 'text-white/30'}`}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {tab === 'overview' && (
          <OverviewTab
            overview={overview}
            rangeDays={rangeDays}
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
            authorCount={byAuthor?.length ?? 0}
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
      <div className="px-4 pb-8 sm:px-6 lg:px-10">
        <div className="flex items-center justify-between border-t-2 border-white pt-3">
          <span className="text-xs normal-case text-white/40">
            {rangeLabel}. Streaks, the calendar, the heatmap and the quarters
            aren&apos;t limited to this range. Days and hours are in local time.
          </span>
        </div>
      </div>
    </div>
  )
}
