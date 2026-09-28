import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  LayoutList,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  X,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { prefersMotion, useCountUp } from '../hooks/useCountUp'
import { usePersistedState } from '../hooks/usePersistedState'
import { getBookCoverUrl } from '../utils/bookCover'
import { GOAL_STATUS } from '../types/goals'
import type { GoalProgress } from '../types/goals'
import {
  bookInsights,
  fmtHours,
  goalInsights,
  highlightInsights,
  monthInsights,
  mostReadInsights,
  plural,
  yearInsights,
} from './yearInsights'

interface ReviewBook {
  id: string
  title: string
  author: string | null
  cover_path: string | null
  completed_at: string
  rating: number | null
  page_count: number | null
  days_to_read: number | null
}

interface Ranked {
  name: string
  books: number
}

export interface YearReview {
  year: number
  goal: GoalProgress
  totals: {
    books: number
    pages: number
    seconds: number
    sessions: number
    reading_days: number
    longest_streak: number
  }
  months: { month: number; books: number; seconds: number; pages: number }[]
  books: ReviewBook[]
  top_authors: Ranked[]
  top_genres: Ranked[]
  highlights: {
    longest_book: ReviewBook | null
    shortest_book: ReviewBook | null
    fastest_read: ReviewBook | null
    top_rated: ReviewBook | null
    busiest_day: { date: string; seconds: number } | null
    favourite_time: string | null
  }
  average_rating: number | null
  average_days_to_read: number | null
}

const MONTHS = [
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

function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, opts)
}

// ---------------------------------------------------------------------------
// Motion: on in the walkthrough, off when everything is shown at once
// ---------------------------------------------------------------------------

const Motion = createContext(false)

/** Stagger delay for the i-th animated item. */
function delay(i: number, stepMs = 70, startMs = 150): React.CSSProperties {
  return { animationDelay: `${startMs + i * stepMs}ms` }
}

function CountUp({
  value,
  format = (n: number) => n.toLocaleString(),
}: {
  value: number
  format?: (n: number) => string
}) {
  const animate = useContext(Motion)
  const shown = useCountUp(value, 1100, animate)
  return <>{format(shown ?? value)}</>
}

/** Observations about a chapter, one per line. */
function Insights({ lines }: { lines: string[] }) {
  const animate = useContext(Motion)
  if (lines.length === 0) return null
  return (
    <ul
      className="mb-8 max-w-3xl space-y-2 border-l-2 border-primary pl-4"
      data-testid="insights"
    >
      {lines.map((line, i) => (
        <li
          key={line}
          className={`text-base leading-relaxed text-white/80 sm:text-lg ${animate ? 'animate-fade-up' : ''}`}
          style={animate ? delay(i, 450, 350) : undefined}
        >
          {line}
        </li>
      ))}
    </ul>
  )
}

function SectionTitle({
  index,
  children,
}: {
  index: number
  children: React.ReactNode
}) {
  return (
    <div className="mb-5 flex items-baseline gap-3 border-t-2 border-white pt-3">
      <span className="text-xs font-semibold tabular-nums text-white/40">
        {String(index).padStart(2, '0')}
      </span>
      <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
        {children}
      </h2>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Goal
// ---------------------------------------------------------------------------

function GoalForm({
  initial,
  saving,
  onSave,
  onCancel,
  autoFocus = false,
}: {
  initial: number | null
  saving: boolean
  onSave: (books: number) => void
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const [value, setValue] = useState(initial ? String(initial) : '')
  const books = Number(value)
  const valid = Number.isInteger(books) && books >= 1 && books <= 1000
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSave(books)
      }}
    >
      <label className="flex items-center gap-2 text-sm text-white/70">
        Read
        <input
          type="number"
          min={1}
          max={1000}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-20 border border-white/25 bg-transparent px-2 py-1.5 text-sm font-semibold tabular-nums text-white focus:border-primary focus:outline-none"
          aria-label="Books to read"
          data-testid="goal-input"
          autoFocus={autoFocus}
        />
        books
      </label>
      <button
        type="submit"
        disabled={!valid || saving}
        className="bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-40"
        data-testid="goal-save"
      >
        {saving ? 'Saving…' : 'Save goal'}
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1.5 text-xs font-semibold text-white/50 hover:text-white"
        >
          Cancel
        </button>
      )}
    </form>
  )
}

function GoalBlock({
  goal,
  isFuture,
  onChange,
}: {
  goal: GoalProgress
  isFuture: boolean
  onChange: (goal: GoalProgress) => void
}) {
  const animate = useContext(Motion)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = goal.target

  const save = async (books: number) => {
    setSaving(true)
    setError(null)
    try {
      const res = await api.put<GoalProgress>(`/api/stats/goal/${goal.year}`, {
        books,
      })
      if (res) onChange(res)
      setEditing(false)
    } catch {
      setError('Could not save the goal')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.delete(`/api/stats/goal/${goal.year}`)
      onChange({
        ...goal,
        target: null,
        status: null,
        expected_by_now: null,
        remaining: null,
        per_month_needed: null,
      })
      setEditing(false)
    } catch {
      setError('Could not remove the goal')
    } finally {
      setSaving(false)
    }
  }

  if (target == null) {
    return (
      <div className="border border-white/[0.14] p-4 sm:p-6" data-testid="goal">
        <p className="text-[10px] font-semibold tracking-widest text-white/45">
          READING GOAL
        </p>
        <p className="mt-1 mb-4 text-sm text-white/60">
          {isFuture
            ? `Set how many books you want to read in ${goal.year}.`
            : `No goal set for ${goal.year}. Set one to track your pace.`}
        </p>
        <GoalForm initial={null} saving={saving} onSave={save} />
        {error && <p className="mt-2 text-xs text-accent">{error}</p>}
      </div>
    )
  }

  const pct = Math.min(100, (goal.completed / target) * 100)
  const expectedPct =
    goal.expected_by_now != null
      ? Math.min(100, (goal.expected_by_now / target) * 100)
      : null
  const behind = goal.status === 'behind' || goal.status === 'missed'

  return (
    <div className="border border-white/[0.14] p-4 sm:p-6" data-testid="goal">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-white/45">
            READING GOAL
          </p>
          <p className="mt-1 text-5xl font-extrabold leading-none tracking-tighter tabular-nums text-white sm:text-7xl">
            <CountUp value={goal.completed} />
            <span className="text-2xl font-bold text-white/40 sm:text-4xl">
              /{target}
            </span>
          </p>
        </div>
        <div className="text-right">
          {goal.status && (
            <p
              className={`text-sm font-bold ${behind ? 'text-accent' : 'text-primary-400'}`}
              data-testid="goal-status"
            >
              {GOAL_STATUS[goal.status]}
            </p>
          )}
          <p className="mt-0.5 text-xs text-white/50">
            {goal.status === 'done'
              ? `${plural(goal.completed, 'book')} read`
              : goal.status === 'missed'
                ? `${plural(goal.remaining ?? 0, 'book')} short`
                : `${plural(goal.remaining ?? 0, 'book')} to go${
                    goal.per_month_needed
                      ? ` · about ${goal.per_month_needed} a month`
                      : ''
                  }`}
          </p>
        </div>
      </div>

      <div className="relative mt-5 h-2 bg-white/15" data-testid="goal-bar">
        <div
          className={`absolute inset-y-0 left-0 origin-left bg-primary ${animate ? 'animate-grow-x' : ''}`}
          style={{ width: `${pct}%`, ...(animate ? delay(0, 0, 300) : {}) }}
        />
        {expectedPct != null && expectedPct > 0 && expectedPct < 100 && (
          <div
            className="absolute -top-1 -bottom-1 w-0.5 bg-white"
            style={{ left: `${expectedPct}%` }}
            title={`Pace: ${goal.expected_by_now} by today`}
          />
        )}
      </div>
      {expectedPct != null && expectedPct > 0 && expectedPct < 100 && (
        <p className="mt-2 text-[11px] text-white/40">
          White mark: where you&apos;d be on an even pace (
          {goal.expected_by_now} books by today)
        </p>
      )}

      <div className="mt-5 border-t border-white/[0.08] pt-4">
        {editing ? (
          <GoalForm
            initial={target}
            saving={saving}
            onSave={save}
            onCancel={() => setEditing(false)}
            autoFocus
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 border border-white/25 px-3 py-1.5 text-xs font-semibold text-white/80 transition-colors hover:bg-white hover:text-black"
              data-testid="goal-edit"
            >
              <Pencil size={11} /> Change goal
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Remove the ${goal.year} reading goal?`))
                  void remove()
              }}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white/50 transition-colors hover:text-white disabled:opacity-40"
            >
              <X size={11} /> Remove
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-accent">{error}</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

function MonthChart({ months }: { months: YearReview['months'] }) {
  const animate = useContext(Motion)
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(...months.map((m) => m.seconds), 1)
  const active = hovered != null ? months[hovered] : null
  const busiest = months.reduce((a, b) => (b.seconds > a.seconds ? b : a))
  return (
    <div data-testid="month-chart">
      <p className="mb-2 h-5 text-xs font-semibold">
        {active ? (
          <>
            <span className="text-white/50">{MONTHS[active.month - 1]} — </span>
            <span className="text-primary-400">{fmtHours(active.seconds)}</span>
            <span className="text-white/50">
              {' · '}
              {plural(active.books, 'book')} finished
              {active.pages ? ` · ${active.pages.toLocaleString()} pages` : ''}
            </span>
          </>
        ) : busiest.seconds ? (
          <span className="text-white/40">
            Most reading in {MONTHS[busiest.month - 1]}:{' '}
            {fmtHours(busiest.seconds)}
          </span>
        ) : (
          <span className="text-white/40">No reading time recorded</span>
        )}
      </p>
      <div className="flex h-44 items-end gap-1 border-b border-white/25 sm:h-56 sm:gap-2">
        {months.map((m, i) => (
          <div
            key={m.month}
            className="relative flex h-full flex-1 items-end"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setHovered(hovered === i ? null : i)}
            aria-label={`${MONTHS[i]}: ${fmtHours(m.seconds)}, ${plural(m.books, 'book')}`}
          >
            <div
              className={`w-full origin-bottom transition-colors ${hovered === i ? 'bg-white' : 'bg-primary'} ${animate ? 'animate-grow-y' : ''}`}
              style={{
                ...(animate ? delay(i, 80, 200) : {}),
                height: m.seconds
                  ? `${Math.max(2, (m.seconds / max) * 100)}%`
                  : 0,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1 sm:gap-2">
        {months.map((m, i) => (
          <div key={m.month} className="flex-1 text-center">
            <p
              className={`text-[10px] font-semibold ${hovered === i ? 'text-white' : 'text-white/40'}`}
            >
              <span className="sm:hidden">{MONTHS[i][0]}</span>
              <span className="hidden sm:inline">{MONTHS[i]}</span>
            </p>
            <p
              className={`text-xs font-bold tabular-nums ${m.books ? 'text-white' : 'text-white/15'}`}
            >
              {m.books}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-1 text-right text-[10px] text-white/35">
        Bars: hours read · Numbers: books finished
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Books and highlights
// ---------------------------------------------------------------------------

function BookGrid({ books }: { books: ReviewBook[] }) {
  const animate = useContext(Motion)
  return (
    <ol
      className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8"
      data-testid="year-books"
    >
      {books.map((b, i) => (
        <li
          key={b.id}
          className={`min-w-0 ${animate ? 'animate-fade-up' : ''}`}
          style={animate ? delay(i, 90, 200) : undefined}
        >
          <Link to={`/books/${b.id}`} className="group block">
            <div className="relative">
              <img
                src={getBookCoverUrl(b.id, b.cover_path)}
                alt=""
                loading="lazy"
                className="aspect-[2/3] w-full bg-white/5 object-cover"
              />
              <span className="absolute left-0 top-0 bg-black px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs font-semibold leading-snug text-white group-hover:underline">
              {b.title}
            </p>
          </Link>
          <p className="mt-0.5 truncate text-[11px] text-white/45">
            {fmtDate(b.completed_at, { month: 'short', day: 'numeric' })}
            {b.days_to_read ? ` · ${plural(b.days_to_read, 'day')}` : ''}
          </p>
          {b.rating ? (
            <p className="text-[11px] font-semibold text-primary-400">
              {'★'.repeat(Math.round(b.rating))}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function Highlight({
  label,
  value,
  detail,
  to,
}: {
  label: string
  value: string
  detail?: string | null
  to?: string
}) {
  const body = (
    <>
      <p className="text-[10px] font-semibold tracking-widest text-white/45">
        {label}
      </p>
      <p className="mt-2 line-clamp-2 text-lg font-extrabold leading-tight tracking-tight text-white group-hover:underline">
        {value}
      </p>
      {detail && <p className="mt-1 text-xs text-white/50">{detail}</p>}
    </>
  )
  const cls = 'block border-t border-white/[0.14] pt-3'
  return to ? (
    <Link to={to} className={`group ${cls}`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function Highlights({ review }: { review: YearReview }) {
  const animate = useContext(Motion)
  const h = review.highlights
  const items: React.ReactNode[] = []
  if (h.longest_book)
    items.push(
      <Highlight
        key="longest"
        label="LONGEST BOOK"
        value={h.longest_book.title}
        detail={`${h.longest_book.page_count?.toLocaleString()} pages`}
        to={`/books/${h.longest_book.id}`}
      />
    )
  if (h.fastest_read)
    items.push(
      <Highlight
        key="fastest"
        label="QUICKEST READ"
        value={h.fastest_read.title}
        detail={plural(h.fastest_read.days_to_read ?? 0, 'day')}
        to={`/books/${h.fastest_read.id}`}
      />
    )
  if (h.top_rated)
    items.push(
      <Highlight
        key="rated"
        label="TOP RATED"
        value={h.top_rated.title}
        detail={'★'.repeat(Math.round(h.top_rated.rating ?? 0))}
        to={`/books/${h.top_rated.id}`}
      />
    )
  if (h.busiest_day)
    items.push(
      <Highlight
        key="busiest"
        label="BIGGEST DAY"
        value={fmtDate(h.busiest_day.date, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
        detail={`${fmtHours(h.busiest_day.seconds)} of reading`}
      />
    )
  if (h.favourite_time)
    items.push(
      <Highlight
        key="time"
        label="FAVOURITE TIME"
        value={`In the ${h.favourite_time}`}
        detail="When most of your reading happened"
      />
    )
  if (review.average_days_to_read)
    items.push(
      <Highlight
        key="avg-days"
        label="AVERAGE BOOK"
        value={plural(review.average_days_to_read, 'day')}
        detail={
          review.average_rating
            ? `from first session to finish · rated ${review.average_rating} on average`
            : 'from first session to finish'
        }
      />
    )
  if (items.length === 0) return null
  return (
    <div
      className={`grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 ${animate ? 'stagger' : ''}`}
      data-testid="highlights"
    >
      {items}
    </div>
  )
}

function RankedList({ title, items }: { title: string; items: Ranked[] }) {
  const animate = useContext(Motion)
  if (items.length === 0) return null
  const max = Math.max(...items.map((i) => i.books), 1)
  return (
    <div>
      <p className="mb-3 text-[10px] font-semibold tracking-widest text-white/45">
        {title}
      </p>
      <ol className="space-y-2.5">
        {items.map((item, i) => (
          <li key={item.name} className="flex items-center gap-3">
            <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-white/35">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-semibold text-white">
                  {item.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-white/50">
                  {plural(item.books, 'book')}
                </span>
              </div>
              <div className="mt-1 h-1 bg-white/10">
                <div
                  className={`h-full origin-left bg-primary ${animate ? 'animate-grow-x' : ''}`}
                  style={{
                    width: `${(item.books / max) * 100}%`,
                    ...(animate ? delay(i, 120, 250) : {}),
                  }}
                />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

function Totals({ totals: t }: { totals: YearReview['totals'] }) {
  const animate = useContext(Motion)
  const items: [string, number, (n: number) => string][] = [
    ['BOOKS', t.books, (n) => n.toLocaleString()],
    ['HOURS', t.seconds, fmtHours],
    ['PAGES', t.pages, (n) => n.toLocaleString()],
    ['READING DAYS', t.reading_days, (n) => n.toLocaleString()],
    ['LONGEST STREAK', t.longest_streak, (n) => plural(n, 'day')],
    ['SESSIONS', t.sessions, (n) => n.toLocaleString()],
  ]
  return (
    <dl
      className={`grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 ${animate ? 'stagger' : ''}`}
      data-testid="year-totals"
    >
      {items.map(([label, value, format]) => (
        <div key={label} className="border-t border-white/[0.14] pt-3">
          <dt className="text-[10px] font-semibold tracking-widest text-white/45">
            {label}
          </dt>
          <dd className="mt-1 text-3xl font-extrabold tracking-tighter tabular-nums text-white sm:text-5xl">
            <CountUp value={value} format={format} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Chapters: the same content, walked through one at a time or shown at once
// ---------------------------------------------------------------------------

interface Chapter {
  key: string
  title: string
  insights: string[]
  content: React.ReactNode
}

function buildChapters(
  review: YearReview,
  prev: YearReview | null,
  goal: GoalProgress,
  isFuture: boolean,
  onGoalChange: (g: GoalProgress) => void
): Chapter[] {
  const withGoal = { ...review, goal }
  const chapters: Chapter[] = [
    {
      key: 'year',
      title: 'Your year',
      insights: yearInsights(review, prev),
      content: <Totals totals={review.totals} />,
    },
    {
      key: 'goal',
      title: 'The goal',
      insights: goalInsights(withGoal),
      content: (
        <div className="max-w-2xl">
          <GoalBlock goal={goal} isFuture={isFuture} onChange={onGoalChange} />
        </div>
      ),
    },
    {
      key: 'months',
      title: 'Month by month',
      insights: monthInsights(review),
      content: <MonthChart months={review.months} />,
    },
  ]
  if (review.books.length > 0)
    chapters.push({
      key: 'books',
      title: `Finished in ${review.year}`,
      insights: bookInsights(review),
      content: <BookGrid books={review.books} />,
    })
  if (review.books.length > 0 || review.totals.seconds > 0)
    chapters.push({
      key: 'highlights',
      title: 'Highlights',
      insights: highlightInsights(review),
      content: <Highlights review={review} />,
    })
  if (review.top_authors.length > 0 || review.top_genres.length > 0)
    chapters.push({
      key: 'most-read',
      title: 'Most read',
      insights: mostReadInsights(review),
      content: (
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          <RankedList title="AUTHORS" items={review.top_authors} />
          <RankedList title="GENRES" items={review.top_genres} />
        </div>
      ),
    })
  return chapters
}

function AllChapters({ chapters }: { chapters: Chapter[] }) {
  return (
    <Motion.Provider value={false}>
      <div className="space-y-14" data-testid="all-chapters">
        {chapters.map((c, i) => (
          <section key={c.key}>
            <SectionTitle index={i + 1}>{c.title}</SectionTitle>
            <Insights lines={c.insights} />
            {c.content}
          </section>
        ))}
      </div>
    </Motion.Provider>
  )
}

/** One chapter at a time, animated in, with Back/Next and arrow keys. */
function Walkthrough({
  year,
  totals,
  chapters,
  onShowAll,
}: {
  year: number
  totals: YearReview['totals']
  chapters: Chapter[]
  onShowAll: () => void
}) {
  const [step, setStep] = useState(0)
  const top = useRef<HTMLDivElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const n = chapters.length
  const finished = step >= n
  const chapter = chapters[Math.min(step, n - 1)]

  const go = (to: number) => {
    setStep(Math.max(0, Math.min(n, to)))
    const el = top.current
    if (el && el.getBoundingClientRect().top < 0)
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'ArrowRight') setStep((s) => Math.min(n, s + 1))
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n])

  return (
    <Motion.Provider value={true}>
      <div
        ref={top}
        className="scroll-mt-4"
        data-testid="walkthrough"
        // Swipe left or right on a phone to move between chapters.
        onTouchStart={(e) => {
          const t = e.touches[0]
          touch.current = { x: t.clientX, y: t.clientY }
        }}
        onTouchEnd={(e) => {
          const start = touch.current
          touch.current = null
          if (!start) return
          const t = e.changedTouches[0]
          const dx = t.clientX - start.x
          const dy = t.clientY - start.y
          if (Math.abs(dx) > 60 && Math.abs(dy) < 50)
            go(step + (dx < 0 ? 1 : -1))
        }}
      >
        {/* Progress: one segment per chapter; tap one to jump there */}
        <div className="mb-8 flex gap-1" role="tablist" aria-label="Chapters">
          {chapters.map((c, i) => (
            <button
              key={c.key}
              role="tab"
              aria-selected={i === step}
              aria-label={c.title}
              onClick={() => go(i)}
              className="group h-5 flex-1 py-2"
            >
              <span className="block h-1 bg-white/15 group-hover:bg-white/30">
                <span
                  className={`block h-full origin-left bg-primary ${i === step ? 'animate-grow-x' : ''}`}
                  style={{ width: i <= step ? '100%' : '0%' }}
                />
              </span>
            </button>
          ))}
        </div>

        {finished ? (
          <div
            key="end"
            className="py-10 sm:py-16"
            data-testid="walkthrough-end"
          >
            <p className="animate-fade-up text-5xl font-extrabold tracking-tighter text-white sm:text-8xl">
              {year === new Date().getFullYear()
                ? `${year} so far.`
                : `That was ${year}.`}
            </p>
            <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
              {(
                [
                  ['books', totals.books.toLocaleString()],
                  ['hours', Math.round(totals.seconds / 3600).toLocaleString()],
                  ['reading days', totals.reading_days.toLocaleString()],
                ] as const
              ).map(([label, value], i) => (
                <div
                  key={label}
                  className="animate-fade-up"
                  style={delay(i, 150, 250)}
                >
                  <p className="text-4xl font-extrabold tracking-tighter tabular-nums text-primary-400 sm:text-6xl">
                    {value}
                  </p>
                  <p className="text-xs font-semibold tracking-widest text-white/50">
                    {label.toUpperCase()}
                  </p>
                </div>
              ))}
            </div>
            <p
              className="mt-8 max-w-2xl animate-fade-up text-lg text-white/60"
              style={delay(0, 0, 750)}
            >
              {chapters[0].insights[0]}
            </p>
            <div
              className="mt-10 flex animate-fade-up flex-wrap gap-3"
              style={delay(0, 0, 950)}
            >
              <button
                onClick={onShowAll}
                className="flex items-center gap-2 bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-600"
                data-testid="walkthrough-show-all"
              >
                <LayoutList size={14} /> See everything
              </button>
              <button
                onClick={() => go(0)}
                className="flex items-center gap-2 border border-white/25 px-4 py-2.5 text-sm font-semibold text-white/80 hover:bg-white hover:text-black"
              >
                <RotateCcw size={14} /> Start again
              </button>
            </div>
          </div>
        ) : (
          <section key={chapter.key} className="min-h-[50vh]">
            <p className="text-xs font-semibold tabular-nums text-white/40">
              {String(step + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
            </p>
            <h2
              className="mb-5 mt-1 animate-fade-up text-4xl font-extrabold tracking-tighter text-white sm:text-6xl"
              data-testid="walkthrough-title"
            >
              {chapter.title}
            </h2>
            <Insights lines={chapter.insights} />
            {chapter.content}
          </section>
        )}

        {!finished && (
          <nav className="mt-12 flex items-center justify-between gap-3 border-t border-white/[0.14] pt-4">
            <button
              onClick={() => go(step - 1)}
              disabled={step === 0}
              className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white/60 hover:text-white disabled:opacity-25"
            >
              <ArrowLeft size={14} /> Back
            </button>
            <span className="hidden text-[11px] text-white/35 sm:inline">
              Use ← → to move between chapters
            </span>
            <button
              onClick={() => go(step + 1)}
              className="flex items-center gap-2 bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/85"
              data-testid="walkthrough-next"
            >
              {step === n - 1 ? 'Finish' : `Next: ${chapters[step + 1].title}`}
              <ArrowRight size={14} />
            </button>
          </nav>
        )}
      </div>
    </Motion.Provider>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function YearInReview() {
  const params = useParams()
  const thisYear = new Date().getFullYear()
  const parsed = Number(params.year)
  const year =
    Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2200
      ? parsed
      : thisYear

  // Walk through the year chapter by chapter with animations, or show it all
  // at once. Starts off for people who've asked their system for less motion.
  const [walkthrough, setWalkthrough] = usePersistedState(
    'shelfloom:year-review-walkthrough',
    prefersMotion()
  )
  // Finishing a walkthrough shows everything for that year, without turning
  // the walkthrough off for next time.
  const [showAllFor, setShowAllFor] = useState<number | null>(null)

  const { data: years } = useApi<number[]>('/api/stats/years')
  const { data, loading, error } = useApi<YearReview>(`/api/stats/year/${year}`)
  const hasPrev = (years ?? []).includes(year - 1)
  const { data: prevData } = useApi<YearReview>(
    hasPrev ? `/api/stats/year/${year - 1}` : null
  )
  const review = data && data.year === year ? data : null
  const prevReview = prevData && prevData.year === year - 1 ? prevData : null
  // Goal edits update in place without refetching the whole review.
  const [edited, setEdited] = useState<GoalProgress | null>(null)
  const goal = edited?.year === year ? edited : (review?.goal ?? null)

  const known = (years ?? []).filter((y) => y !== year)
  const older = known.filter((y) => y < year).sort((a, b) => b - a)[0]
  const newer = known
    .filter((y) => y > year && y <= thisYear + 1)
    .sort((a, b) => a - b)[0]
  const prev = older ?? (year > thisYear ? thisYear : undefined)
  const next = newer ?? (year < thisYear ? thisYear : undefined)

  const t = review?.totals
  const isCurrent = year === thisYear
  const chapters =
    review && goal
      ? buildChapters(review, prevReview, goal, year > thisYear, setEdited)
      : []
  const walking = walkthrough && showAllFor !== year

  return (
    <div className="mx-auto min-h-screen max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-10">
      <nav className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-white/45">
        <Link to="/stats" className="hover:text-white">
          Stats
        </Link>
        <ChevronRight size={12} />
        <span className="text-white/70">Year in review</span>
      </nav>

      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1
            className="text-7xl font-extrabold leading-[0.85] tracking-tighter text-white sm:text-9xl"
            data-testid="year-heading"
          >
            {year}
          </h1>
          <p className="mt-4 text-base text-white/55 sm:text-lg">
            {t
              ? t.books || t.seconds
                ? `${plural(t.books, 'book')} finished · ${fmtHours(t.seconds)} of reading${
                    isCurrent ? ' so far' : ''
                  }`
                : isCurrent
                  ? 'Nothing finished yet this year.'
                  : `No reading recorded in ${year}.`
              : loading
                ? 'Loading…'
                : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              setWalkthrough(!walkthrough)
              setShowAllFor(null)
            }}
            aria-pressed={walkthrough}
            className="flex items-center gap-2.5 border border-white/25 px-3 py-2 text-xs font-semibold text-white/80 transition-colors hover:border-white"
            data-testid="walkthrough-toggle"
            title={
              walkthrough
                ? 'Show everything at once, without animations'
                : 'Walk through the year chapter by chapter, animated'
            }
          >
            {walkthrough ? <Play size={12} /> : <LayoutList size={12} />}
            Walkthrough
            <span
              className={`relative h-4 w-7 transition-colors ${walkthrough ? 'bg-primary' : 'bg-white/20'}`}
              aria-hidden
            >
              <span
                className={`absolute top-0.5 size-3 bg-white transition-all ${walkthrough ? 'left-3.5' : 'left-0.5'}`}
              />
            </span>
          </button>
          <div className="flex border border-white/25">
            {prev !== undefined ? (
              <Link
                to={`/stats/year/${prev}`}
                className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white hover:text-black"
                data-testid="year-prev"
              >
                <ChevronLeft size={13} /> {prev}
              </Link>
            ) : (
              <span className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-white/20">
                <ChevronLeft size={13} />
              </span>
            )}
            {next !== undefined ? (
              <Link
                to={`/stats/year/${next}`}
                className="flex items-center gap-1 border-l border-white/25 px-3 py-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white hover:text-black"
                data-testid="year-next"
              >
                {next} <ChevronRight size={13} />
              </Link>
            ) : (
              <span className="flex items-center gap-1 border-l border-white/25 px-3 py-2 text-xs font-semibold text-white/20">
                <ChevronRight size={13} />
              </span>
            )}
          </div>
        </div>
      </header>

      {error && !review && (
        <p className="text-sm text-white/60">Could not load {year}.</p>
      )}
      {!review && loading && (
        <p className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      )}

      {chapters.length > 0 &&
        (walking ? (
          <Walkthrough
            key={year}
            year={year}
            totals={review!.totals}
            chapters={chapters}
            onShowAll={() => setShowAllFor(year)}
          />
        ) : (
          <AllChapters chapters={chapters} />
        ))}
    </div>
  )
}
