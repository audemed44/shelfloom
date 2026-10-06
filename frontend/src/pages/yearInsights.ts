/**
 * Plain-language observations about a year of reading, for the year in
 * review. Pure functions of the review data so they're easy to test and
 * never claim more than the numbers show.
 */

import type { YearReview } from './YearInReview'
import { plural } from '../utils/plural'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function fmtHours(s: number): string {
  if (!s) return '0h'
  const h = s / 3600
  if (h < 1) return `${Math.round(s / 60)}m`
  return h < 10 ? `${h.toFixed(1).replace(/\.0$/, '')}h` : `${Math.round(h)}h`
}

export { plural }

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Days of `year` that have happened by `today` (all of them for a past year). */
export function elapsedDays(year: number, today: Date): number {
  const total = isLeap(year) ? 366 : 365
  if (year < today.getFullYear()) return total
  if (year > today.getFullYear()) return 0
  const start = new Date(year, 0, 1)
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((now.getTime() - start.getTime()) / 86400000) + 1
}

/** Months of `year` that have started by `today`. */
function elapsedMonths(year: number, today: Date): number {
  if (year < today.getFullYear()) return 12
  if (year > today.getFullYear()) return 0
  return today.getMonth() + 1
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

// ── chapters ─────────────────────────────────────────────────────────────────

export function yearInsights(
  r: YearReview,
  prev: YearReview | null,
  today = new Date()
): string[] {
  const t = r.totals
  const current = r.year === today.getFullYear()
  if (!t.seconds && !t.books) {
    return [
      current
        ? `Nothing recorded yet in ${r.year}. Sessions from KOReader or the web reader will show up here.`
        : `No reading was recorded in ${r.year}.`,
    ]
  }
  const out: string[] = []
  const days = elapsedDays(r.year, today)

  if (t.seconds >= 86400) {
    const full = t.seconds / 86400
    out.push(
      `${fmtHours(t.seconds)} of reading is ${full >= 10 ? Math.round(full) : full.toFixed(1)} whole days spent with a book.`
    )
  } else if (days >= 7) {
    out.push(
      `That's about ${fmtHours(Math.round((t.seconds / days) * 7))} a week${current ? ' so far' : ''}.`
    )
  }

  if (days > 0 && t.reading_days > 0) {
    const share = pct(t.reading_days, days)
    const tone =
      share >= 70
        ? 'almost every day'
        : share >= 40
          ? 'more days than not, some weeks'
          : share >= 15
            ? 'in bursts rather than daily'
            : 'now and then'
    out.push(
      `You read on ${t.reading_days} of ${days} days (${share}%) — ${tone}.`
    )
  }

  if (t.longest_streak >= 5)
    out.push(`Your longest run was ${t.longest_streak} days in a row.`)

  if (t.sessions > 0) {
    const avg = t.seconds / t.sessions
    out.push(
      `A typical sitting lasted ${fmtHours(Math.round(avg))}${avg >= 3600 ? ' — long, unhurried sessions' : avg < 900 ? ' — lots of short dips' : ''}.`
    )
  }

  if (prev && prev.totals.seconds > 0) {
    const change = (t.seconds - prev.totals.seconds) / prev.totals.seconds
    const books = t.books - prev.totals.books
    const bookText =
      books === 0
        ? 'the same number of books'
        : `${plural(Math.abs(books), 'book')} ${books > 0 ? 'more' : 'fewer'}`
    if (Math.abs(change) < 0.05) {
      out.push(
        `About as much time as ${prev.year}${current ? ' already' : ''}, with ${bookText}.`
      )
    } else {
      out.push(
        `${Math.abs(Math.round(change * 100))}% ${change > 0 ? 'more' : 'less'} reading time than ${prev.year}${current && change < 0 ? ' so far' : ''}, and ${bookText}.`
      )
    }
  }
  return out
}

export function goalInsights(r: YearReview, today = new Date()): string[] {
  const g = r.goal
  const current = r.year === today.getFullYear()
  if (g.target == null) {
    return [
      r.year >= today.getFullYear()
        ? 'No goal yet. Set one and this page will track whether you’re on pace.'
        : `No goal was set for ${r.year}.`,
    ]
  }
  const left = 12 - today.getMonth() - 1
  switch (g.status) {
    case 'done': {
      const extra = g.completed - g.target
      const parts = [`Goal reached: ${g.completed} of ${g.target} books.`]
      if (extra > 0)
        parts.push(`That’s ${plural(extra, 'book')} more than planned.`)
      if (current && left > 0)
        parts.push(
          `With ${plural(left, 'month')} still to go, a bigger goal might be in reach.`
        )
      return parts
    }
    case 'ahead':
      return [
        `Ahead of pace: ${g.completed} done when an even pace would have you at ${g.expected_by_now}.`,
        `${plural(g.remaining ?? 0, 'book')} to go.`,
      ]
    case 'on_track':
      return [
        `Right on pace with ${g.completed} of ${g.target}.`,
        g.per_month_needed
          ? `Keep to about ${g.per_month_needed} a month and you’ll make it.`
          : `${plural(g.remaining ?? 0, 'book')} to go.`,
      ]
    case 'behind':
      return [
        `Behind pace: ${g.completed} done, where an even pace would be ${g.expected_by_now}.`,
        g.per_month_needed
          ? `About ${g.per_month_needed} a month from here would still get you to ${g.target}.`
          : `${plural(g.remaining ?? 0, 'book')} to go.`,
      ]
    case 'missed':
      return [
        `${g.completed} of ${g.target} books — ${pct(g.completed, g.target)}% of the goal.`,
      ]
    default:
      return []
  }
}

export function monthInsights(r: YearReview, today = new Date()): string[] {
  const months = r.months
  const total = months.reduce((s, m) => s + m.seconds, 0)
  if (!total) return ['No reading time to break down by month yet.']
  const out: string[] = []
  const best = months.reduce((a, b) => (b.seconds > a.seconds ? b : a))
  out.push(
    `${MONTHS[best.month - 1]} was your biggest month: ${fmtHours(best.seconds)}, ${pct(best.seconds, total)}% of the year’s reading.`
  )

  const elapsed = months.slice(0, elapsedMonths(r.year, today))
  const quiet = elapsed.filter((m) => m.seconds === 0)
  if (quiet.length === 1)
    out.push(
      `${MONTHS[quiet[0].month - 1]} was the only month without any reading.`
    )
  else if (quiet.length > 1 && quiet.length < elapsed.length)
    out.push(`${quiet.length} months went by without any reading.`)

  if (elapsed.length >= 6) {
    const recent = elapsed.slice(-3)
    const before = elapsed.slice(0, -3)
    const avg = (xs: typeof months) =>
      xs.reduce((s, m) => s + m.seconds, 0) / xs.length
    const a = avg(recent)
    const b = avg(before)
    if (b > 0 && a / b >= 1.5)
      out.push(
        `Reading picked up lately: the last three months averaged ${fmtHours(Math.round(a))} a month, against ${fmtHours(Math.round(b))} before.`
      )
    else if (b > 0 && a / b <= 0.6)
      out.push(
        `Things slowed down lately: ${fmtHours(Math.round(a))} a month over the last three, down from ${fmtHours(Math.round(b))}.`
      )
  }

  const mostBooks = months.reduce((a, b) => (b.books > a.books ? b : a))
  if (mostBooks.books >= 2)
    out.push(
      `You finished the most books in ${MONTHS[mostBooks.month - 1]} (${mostBooks.books}).`
    )
  return out
}

export function bookInsights(r: YearReview, today = new Date()): string[] {
  const books = r.books
  const current = r.year === today.getFullYear()
  if (books.length === 0)
    return [
      current
        ? 'No books finished yet this year.'
        : `No books finished in ${r.year}.`,
    ]
  const out: string[] = []
  const days = elapsedDays(r.year, today)
  if (books.length === 1) {
    out.push(`One book finished: ${books[0].title}.`)
  } else {
    out.push(
      `${books.length} books — one every ${Math.max(1, Math.round(days / books.length))} days on average.`
    )
  }
  if (r.average_days_to_read && books.length > 1) {
    const f = r.highlights.fastest_read
    out.push(
      `A book took ${plural(r.average_days_to_read, 'day')} on average from first session to finish` +
        (f?.days_to_read
          ? `; ${f.title} went quickest, in ${plural(f.days_to_read, 'day')}.`
          : '.')
    )
  }
  const rated = books.filter((b) => b.rating)
  if (rated.length >= 2 && r.average_rating) {
    const fives = rated.filter((b) => (b.rating ?? 0) >= 5).length
    out.push(
      `You rated ${rated.length} of them, ${r.average_rating} stars on average` +
        (fives ? `, with ${plural(fives, 'five-star read')}.` : '.')
    )
  }
  return out
}

const TIME_OF_DAY: Record<string, string> = {
  morning: 'An early reader: most of your reading happened in the morning.',
  afternoon: 'Afternoons were your reading time.',
  evening: 'An evening reader: most of your time with books came after 5pm.',
  night: 'A night owl: most of your reading happened after 10pm.',
}

export function highlightInsights(r: YearReview): string[] {
  const h = r.highlights
  const out: string[] = []
  if (h.favourite_time && TIME_OF_DAY[h.favourite_time])
    out.push(TIME_OF_DAY[h.favourite_time])
  if (h.busiest_day && h.busiest_day.seconds >= 3600) {
    const d = new Date(`${h.busiest_day.date}T00:00:00`)
    const day = d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
    out.push(
      `Your biggest day was ${day}, with ${fmtHours(h.busiest_day.seconds)} of reading.`
    )
  }
  if (
    h.longest_book?.page_count &&
    h.shortest_book?.page_count &&
    h.longest_book.id !== h.shortest_book.id
  ) {
    out.push(
      `From ${h.shortest_book.title} (${h.shortest_book.page_count} pages) to ${h.longest_book.title} (${h.longest_book.page_count.toLocaleString()}).`
    )
  }
  return out
}

export function mostReadInsights(r: YearReview): string[] {
  const out: string[] = []
  const total = r.books.length
  const [top, second] = r.top_authors
  if (top) {
    if (top.books >= 2) {
      out.push(
        `${top.name} led the year with ${top.books} of your ${total} books` +
          (second && second.books === top.books
            ? `, tied with ${second.name}.`
            : '.')
      )
    } else if (total >= 3) {
      out.push(`${total} books and no author twice — a year of variety.`)
    }
  }
  const genre = r.top_genres[0]
  if (genre && total > 0 && genre.books >= 2)
    out.push(
      `${genre.name} was the most read genre, in ${pct(genre.books, total)}% of finished books.`
    )
  return out
}
