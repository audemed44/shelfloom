import { describe, it, expect } from 'vitest'
import {
  bookInsights,
  elapsedDays,
  goalInsights,
  monthInsights,
  mostReadInsights,
  yearInsights,
} from '../pages/yearInsights'
import type { YearReview } from '../pages/YearInReview'

const TODAY = new Date(2026, 8, 28) // 28 Sep 2026

function months(seconds: number[], books: number[] = []) {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    seconds: seconds[i] ?? 0,
    books: books[i] ?? 0,
    pages: 0,
  }))
}

function review(overrides: Partial<YearReview> = {}): YearReview {
  return {
    year: 2026,
    goal: {
      year: 2026,
      target: null,
      completed: 0,
      expected_by_now: null,
      status: null,
      remaining: null,
      per_month_needed: null,
    },
    totals: {
      books: 0,
      pages: 0,
      seconds: 0,
      sessions: 0,
      reading_days: 0,
      longest_streak: 0,
    },
    months: months([]),
    books: [],
    top_authors: [],
    top_genres: [],
    highlights: {
      longest_book: null,
      shortest_book: null,
      fastest_read: null,
      top_rated: null,
      busiest_day: null,
      favourite_time: null,
    },
    average_rating: null,
    average_days_to_read: null,
    ...overrides,
  }
}

const book = (id: string, extra = {}) => ({
  id,
  title: `Book ${id}`,
  author: 'A',
  cover_path: null,
  completed_at: '2026-03-01T00:00:00',
  rating: null,
  page_count: null,
  days_to_read: null,
  ...extra,
})

describe('yearInsights', () => {
  it('counts days elapsed in the current year', () => {
    expect(elapsedDays(2026, TODAY)).toBe(271)
    expect(elapsedDays(2024, TODAY)).toBe(366)
    expect(elapsedDays(2027, TODAY)).toBe(0)
  })

  it('describes time, frequency, streaks and change from last year', () => {
    const r = review({
      totals: {
        books: 17,
        pages: 7000,
        seconds: 142 * 3600,
        sessions: 157,
        reading_days: 109,
        longest_streak: 12,
      },
    })
    const prev = review({
      year: 2025,
      totals: { ...r.totals, books: 12, seconds: 100 * 3600 },
    })
    const lines = yearInsights(r, prev, TODAY)
    expect(lines[0]).toBe(
      '142h of reading is 5.9 whole days spent with a book.'
    )
    expect(lines[1]).toBe(
      'You read on 109 of 271 days (40%) — more days than not, some weeks.'
    )
    expect(lines[2]).toBe('Your longest run was 12 days in a row.')
    expect(lines[3]).toMatch(/^A typical sitting lasted 54m\.$/)
    expect(lines[4]).toBe('42% more reading time than 2025, and 5 books more.')
  })

  it('says when nothing was read', () => {
    expect(yearInsights(review({ year: 2024 }), null, TODAY)).toEqual([
      'No reading was recorded in 2024.',
    ])
  })

  it('explains the goal pace', () => {
    const behind = review({
      goal: {
        year: 2026,
        target: 24,
        completed: 12,
        expected_by_now: 17.8,
        status: 'behind',
        remaining: 12,
        per_month_needed: 3,
      },
    })
    expect(goalInsights(behind, TODAY)).toEqual([
      'Behind pace: 12 done, where an even pace would be 17.8.',
      'About 3 a month from here would still get you to 24.',
    ])
    const done = review({
      goal: { ...behind.goal, completed: 26, status: 'done', remaining: 0 },
    })
    expect(goalInsights(done, TODAY)).toEqual([
      'Goal reached: 26 of 24 books.',
      'That’s 2 books more than planned.',
      'With 3 months still to go, a bigger goal might be in reach.',
    ])
    expect(goalInsights(review(), TODAY)[0]).toMatch(/^No goal yet/)
  })

  it('finds the best month, gaps and a recent pick-up', () => {
    const h = 3600
    const r = review({
      months: months(
        [h, 0, h, h, h, h, 4 * h, 5 * h, 6 * h],
        [0, 0, 2, 0, 0, 0, 1, 1, 3]
      ),
    })
    const lines = monthInsights(r, TODAY)
    expect(lines[0]).toBe(
      'September was your biggest month: 6h, 30% of the year’s reading.'
    )
    expect(lines[1]).toBe('February was the only month without any reading.')
    expect(lines[2]).toMatch(/^Reading picked up lately/)
    expect(lines[3]).toBe('You finished the most books in September (3).')
  })

  it('summarises books, pace and ratings', () => {
    const r = review({
      books: [
        book('1', { rating: 5, days_to_read: 3 }),
        book('2', { rating: 4, days_to_read: 9 }),
        book('3'),
      ],
      average_rating: 4.5,
      average_days_to_read: 6,
      highlights: {
        ...review().highlights,
        fastest_read: book('1', { days_to_read: 3 }),
      },
    })
    expect(bookInsights(r, TODAY)).toEqual([
      '3 books — one every 90 days on average.',
      'A book took 6 days on average from first session to finish; Book 1 went quickest, in 3 days.',
      'You rated 2 of them, 4.5 stars on average, with 1 five-star read.',
    ])
  })

  it('names the top author, or the variety', () => {
    const books = [book('1'), book('2'), book('3')]
    expect(
      mostReadInsights(
        review({
          books,
          top_authors: [
            { name: 'Le Guin', books: 2 },
            { name: 'Gibson', books: 1 },
          ],
          top_genres: [{ name: 'Science fiction', books: 2 }],
        })
      )
    ).toEqual([
      'Le Guin led the year with 2 of your 3 books.',
      'Science fiction was the most read genre, in 67% of finished books.',
    ])
    expect(
      mostReadInsights(
        review({ books, top_authors: [{ name: 'A', books: 1 }] })
      )
    ).toEqual(['3 books and no author twice — a year of variety.'])
  })
})
