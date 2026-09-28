import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader2, Pencil, X } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { getBookCoverUrl } from '../utils/bookCover'
import { GOAL_STATUS } from '../types/goals'
import type { GoalProgress } from '../types/goals'

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

function fmtHours(s: number): string {
  if (!s) return '0h'
  const h = s / 3600
  if (h < 1) return `${Math.round(s / 60)}m`
  return h < 10 ? `${h.toFixed(1).replace(/\.0$/, '')}h` : `${Math.round(h)}h`
}

function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, opts)
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
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
}: {
  initial: number | null
  saving: boolean
  onSave: (books: number) => void
  onCancel?: () => void
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
          autoFocus
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
            {goal.completed}
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
          className="absolute inset-y-0 left-0 bg-primary"
          style={{ width: `${pct}%` }}
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
              className={`w-full transition-colors ${hovered === i ? 'bg-white' : 'bg-primary'}`}
              style={{
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
  return (
    <ol
      className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8"
      data-testid="year-books"
    >
      {books.map((b, i) => (
        <li key={b.id} className="min-w-0">
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
      className="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="highlights"
    >
      {items}
    </div>
  )
}

function RankedList({ title, items }: { title: string; items: Ranked[] }) {
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
                  className="h-full bg-primary"
                  style={{ width: `${(item.books / max) * 100}%` }}
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

  const { data: years } = useApi<number[]>('/api/stats/years')
  const { data, loading, error } = useApi<YearReview>(`/api/stats/year/${year}`)
  const review = data && data.year === year ? data : null
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
  let n = 0
  const idx = () => ++n

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
      </header>

      {error && !review && (
        <p className="text-sm text-white/60">Could not load {year}.</p>
      )}
      {!review && loading && (
        <p className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      )}

      {review && t && (
        <div className="space-y-14">
          <section className="grid grid-cols-12 gap-6">
            <div className="col-span-12 lg:col-span-5">
              {goal && (
                <GoalBlock
                  goal={goal}
                  isFuture={year > thisYear}
                  onChange={setEdited}
                />
              )}
            </div>
            <dl
              className="col-span-12 grid grid-cols-2 gap-x-6 gap-y-5 self-start sm:grid-cols-3 lg:col-span-7"
              data-testid="year-totals"
            >
              {[
                ['BOOKS', t.books.toLocaleString()],
                ['HOURS', fmtHours(t.seconds)],
                ['PAGES', t.pages.toLocaleString()],
                ['READING DAYS', t.reading_days.toLocaleString()],
                ['LONGEST STREAK', plural(t.longest_streak, 'day')],
                ['SESSIONS', t.sessions.toLocaleString()],
              ].map(([label, value]) => (
                <div key={label} className="border-t border-white/[0.14] pt-3">
                  <dt className="text-[10px] font-semibold tracking-widest text-white/45">
                    {label}
                  </dt>
                  <dd className="mt-1 text-3xl font-extrabold tracking-tighter tabular-nums text-white sm:text-4xl">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <SectionTitle index={idx()}>Month by month</SectionTitle>
            <MonthChart months={review.months} />
          </section>

          {review.books.length > 0 && (
            <section>
              <SectionTitle index={idx()}>
                Finished in {year}
                <span className="ml-3 text-base font-semibold tabular-nums text-white/40">
                  {review.books.length}
                </span>
              </SectionTitle>
              <BookGrid books={review.books} />
            </section>
          )}

          {(review.books.length > 0 || t.seconds > 0) && (
            <section>
              <SectionTitle index={idx()}>Highlights</SectionTitle>
              <Highlights review={review} />
            </section>
          )}

          {(review.top_authors.length > 0 || review.top_genres.length > 0) && (
            <section>
              <SectionTitle index={idx()}>Most read</SectionTitle>
              <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
                <RankedList title="AUTHORS" items={review.top_authors} />
                <RankedList title="GENRES" items={review.top_genres} />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
