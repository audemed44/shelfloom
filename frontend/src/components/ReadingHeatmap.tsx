import { useMemo, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Flame } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeatmapEntry {
  date: string
  seconds: number
}

interface HeatmapCell {
  date: string
  seconds: number
  level: 0 | 1 | 2 | 3 | 4
  inYear: boolean
}

interface TooltipState {
  x: number
  y: number
  cell: HeatmapCell
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CELL_PX = 12
const GAP_PX = 3
const CELL_TOTAL = CELL_PX + GAP_PX
const DAY_LABEL_W = 36

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SHOW_DAY_INDICES = new Set([1, 3, 5]) // Mon, Wed, Fri

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtSec(s: number): string {
  if (!s) return '0m'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmtDateShort(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function toLevel(seconds: number, maxSec: number): 0 | 1 | 2 | 3 | 4 {
  if (!seconds || !maxSec) return 0
  const r = seconds / maxSec
  if (r <= 0.25) return 1
  if (r <= 0.5) return 2
  if (r <= 0.75) return 3
  return 4
}

function cellClass(level: 0 | 1 | 2 | 3 | 4, inYear: boolean): string {
  if (!inYear) return 'opacity-0 pointer-events-none'
  if (!level) return 'bg-white/5 border border-white/10'
  if (level === 1) return 'bg-primary/25'
  if (level === 2) return 'bg-primary/45'
  if (level === 3) return 'bg-primary/70'
  return 'bg-primary'
}

// ---------------------------------------------------------------------------
// Grid builder
// ---------------------------------------------------------------------------

function buildCells(data: HeatmapEntry[], year: number): HeatmapCell[][] {
  const dayMap = new Map<string, number>()
  for (const d of data) dayMap.set(d.date, d.seconds)

  const maxSec = data.length ? Math.max(...data.map((d) => d.seconds)) : 0

  const jan1 = new Date(year, 0, 1)
  const startDay = new Date(jan1)
  startDay.setDate(jan1.getDate() - jan1.getDay())

  const weeks: HeatmapCell[][] = []
  const cursor = new Date(startDay)

  while (weeks.length < 53) {
    const week: HeatmapCell[] = []
    for (let d = 0; d < 7; d++) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      const seconds = dayMap.get(key) ?? 0
      const inYear = cursor.getFullYear() === year
      week.push({ date: key, seconds, level: toLevel(seconds, maxSec), inYear })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

function getMonthLabels(
  weeks: HeatmapCell[][]
): { label: string; col: number }[] {
  const labels: { label: string; col: number }[] = []
  let lastMonth = -1

  weeks.forEach((week, wi) => {
    for (const cell of week) {
      if (!cell.inYear) continue
      const month = new Date(cell.date + 'T00:00:00').getMonth()
      if (month !== lastMonth) {
        labels.push({
          label: new Date(cell.date + 'T00:00:00').toLocaleDateString('en-US', {
            month: 'short',
          }),
          col: wi,
        })
        lastMonth = month
      }
      break
    }
  })

  return labels
}

// ---------------------------------------------------------------------------
// Year stats (derived from heatmap data, no extra fetch)
// ---------------------------------------------------------------------------

interface YearStats {
  daysRead: number
  totalSeconds: number
  bestDate: string
  bestSeconds: number
  avgSeconds: number
}

function computeYearStats(data: HeatmapEntry[]): YearStats {
  const active = data.filter((d) => d.seconds > 0)
  const totalSeconds = active.reduce((s, d) => s + d.seconds, 0)
  const daysRead = active.length
  const best = active.reduce((b, d) => (d.seconds > b.seconds ? d : b), {
    date: '',
    seconds: 0,
  })
  const avgSeconds = daysRead > 0 ? Math.round(totalSeconds / daysRead) : 0
  return {
    daysRead,
    totalSeconds,
    bestDate: best.date,
    bestSeconds: best.seconds,
    avgSeconds,
  }
}

// ---------------------------------------------------------------------------
// Tooltip portal
// ---------------------------------------------------------------------------

function Tooltip({ state }: { state: TooltipState }) {
  return createPortal(
    <div
      className="fixed z-[200] bg-black border border-white/20 px-3 py-2 pointer-events-none whitespace-nowrap"
      style={{
        left: state.x,
        top: state.y - 8,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <p className="text-white/50 text-[10px] font-bold">
        {fmtDate(state.cell.date)}
      </p>
      <p className="text-white text-xs font-black mt-0.5">
        {state.cell.seconds > 0
          ? `${fmtSec(state.cell.seconds)} reading`
          : 'No reading'}
      </p>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ReadingHeatmapProps {
  data: HeatmapEntry[]
  year: number
  streak: number
}

export function ReadingHeatmap({ data, year, streak }: ReadingHeatmapProps) {
  const weeks = useMemo(() => buildCells(data, year), [data, year])
  const monthLabels = useMemo(() => getMonthLabels(weeks), [weeks])
  const yearStats = useMemo(() => computeYearStats(data), [data])
  const hasData = yearStats.daysRead > 0

  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, cell: HeatmapCell) => {
      if (!cell.inYear) return
      const rect = e.currentTarget.getBoundingClientRect()
      setTooltip({ x: rect.left + rect.width / 2, y: rect.top, cell })
    },
    []
  )

  const handleMouseLeave = useCallback(() => setTooltip(null), [])

  const gridWidth = weeks.length * CELL_TOTAL - GAP_PX

  return (
    <div className="bg-white/5 border border-white/10 px-8 pt-6 pb-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-6 shrink-0">
        <div>
          <h4 className="text-xl font-black tracking-widest text-white">
            Reading Activity
          </h4>
          <p className="text-white/40 text-xs font-bold tracking-wider mt-1">
            {year} Activity Heatmap
          </p>
        </div>
        <div className="bg-primary text-white text-[10px] font-black px-3 py-1 tracking-widest flex items-center gap-1.5">
          <Flame size={11} />
          {streak > 0 ? `${streak} Day Streak` : 'No Streak Yet'}
        </div>
      </div>

      {/* Scrollable grid — pb-3 gives the scrollbar room to breathe */}
      <div className="overflow-x-auto pb-3 shrink-0">
        <div
          className="inline-flex flex-col"
          style={{ minWidth: gridWidth + DAY_LABEL_W }}
        >
          {/* Month labels */}
          <div
            className="relative h-5 shrink-0"
            style={{ marginLeft: DAY_LABEL_W, width: gridWidth }}
          >
            {monthLabels.map((m, i) => (
              <span
                key={i}
                className="absolute text-[10px] text-white/40 font-bold"
                style={{ left: m.col * CELL_TOTAL }}
              >
                {m.label}
              </span>
            ))}
          </div>

          {/* Day labels + cells */}
          <div className="flex">
            <div
              className="flex flex-col shrink-0"
              style={{ width: DAY_LABEL_W, gap: GAP_PX }}
            >
              {DAY_LABELS.map((d, i) => (
                <div
                  key={i}
                  className="flex items-center justify-end pr-2"
                  style={{ height: CELL_PX }}
                >
                  {SHOW_DAY_INDICES.has(i) ? (
                    <span className="text-[9px] text-white/35 font-bold">
                      {d}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            <div
              className="inline-grid grid-rows-7 grid-flow-col"
              style={{ gap: GAP_PX }}
            >
              {weeks.flatMap((week, wi) =>
                week.map((cell, di) => (
                  <div
                    key={`${wi}-${di}`}
                    className={`cursor-default transition-opacity hover:ring-1 hover:ring-white/30 ${cellClass(cell.level, cell.inYear)}`}
                    style={{ width: CELL_PX, height: CELL_PX }}
                    onMouseEnter={(e) => handleMouseEnter(e, cell)}
                    onMouseLeave={handleMouseLeave}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Year at a Glance — fills remaining height */}
      <div className="flex-1 flex flex-col justify-center border-t border-white/10 pt-5 mt-1">
        {hasData ? (
          <>
            <p className="text-[10px] font-black tracking-widest text-white/30 mb-4">
              {year} At A Glance
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5">
              <div>
                <p className="text-[10px] font-black tracking-widest text-white/30">
                  Days Read
                </p>
                <p className="text-2xl font-black text-white leading-tight mt-0.5">
                  {yearStats.daysRead}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black tracking-widest text-white/30">
                  Total Time
                </p>
                <p className="text-2xl font-black text-white leading-tight mt-0.5">
                  {fmtSec(yearStats.totalSeconds)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black tracking-widest text-white/30">
                  Best Day
                </p>
                <p className="text-2xl font-black text-white leading-tight mt-0.5">
                  {fmtSec(yearStats.bestSeconds)}
                </p>
                <p className="text-[10px] text-white/30 normal-case mt-0.5">
                  {fmtDateShort(yearStats.bestDate)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black tracking-widest text-white/30">
                  Avg / Active Day
                </p>
                <p className="text-2xl font-black text-white leading-tight mt-0.5">
                  {fmtSec(yearStats.avgSeconds)}
                </p>
              </div>
            </div>
          </>
        ) : (
          <p className="text-white/25 text-[10px] font-bold italic normal-case">
            No reading data yet — sync your KOReader to see activity.
          </p>
        )}
      </div>

      {tooltip && <Tooltip state={tooltip} />}
    </div>
  )
}
