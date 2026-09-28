import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import YearInReview from '../pages/YearInReview'
import type { YearReview } from '../pages/YearInReview'
import { TestMemoryRouter } from '../test-utils/router'

const BOOK = {
  id: 'b1',
  title: 'The Hound of the Baskervilles',
  author: 'Arthur Conan Doyle',
  cover_path: null,
  completed_at: '2025-03-14T20:00:00',
  rating: 4,
  page_count: 256,
  days_to_read: 5,
}

function review(overrides: Partial<YearReview> = {}): YearReview {
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    books: i === 2 ? 1 : 0,
    seconds: i === 2 ? 7200 : i === 3 ? 3600 : 0,
    pages: i === 2 ? 120 : 0,
  }))
  return {
    year: 2025,
    goal: {
      year: 2025,
      target: null,
      completed: 1,
      expected_by_now: null,
      status: null,
      remaining: null,
      per_month_needed: null,
    },
    totals: {
      books: 1,
      pages: 120,
      seconds: 10800,
      sessions: 4,
      reading_days: 3,
      longest_streak: 2,
    },
    months,
    books: [BOOK],
    top_authors: [{ name: 'Arthur Conan Doyle', books: 1 }],
    top_genres: [{ name: 'Mystery', books: 1 }],
    highlights: {
      longest_book: BOOK,
      shortest_book: BOOK,
      fastest_read: BOOK,
      top_rated: BOOK,
      busiest_day: { date: '2025-03-10', seconds: 5400 },
      favourite_time: 'evening',
    },
    average_rating: 4,
    average_days_to_read: 5,
    ...overrides,
  }
}

let data: YearReview
let calls: { url: string; method: string; body: unknown }[]

function mockFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  calls.push({ url, method, body })
  let payload: unknown = null
  let status = 200
  if (url.includes('/api/stats/years')) payload = [2026, 2025, 2023]
  else if (url.includes('/api/stats/year/')) payload = data
  else if (url.includes('/api/stats/goal/') && method === 'PUT')
    payload = {
      ...data.goal,
      target: (body as { books: number }).books,
      status: 'missed',
      remaining: (body as { books: number }).books - 1,
      expected_by_now: (body as { books: number }).books,
    }
  else if (url.includes('/api/stats/goal/') && method === 'DELETE') status = 204
  return Promise.resolve({
    ok: true,
    status,
    json: () => Promise.resolve(payload),
  } as Response)
}

function renderPage(year = '2025') {
  render(
    <TestMemoryRouter initialEntries={[`/stats/year/${year}`]}>
      <Routes>
        <Route path="/stats/year/:year" element={<YearInReview />} />
      </Routes>
    </TestMemoryRouter>
  )
}

describe('YearInReview', () => {
  beforeEach(() => {
    localStorage.clear()
    data = review()
    calls = []
    vi.stubGlobal('fetch', vi.fn(mockFetch))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the year, totals, books and highlights', async () => {
    renderPage()
    expect(await screen.findByTestId('year-heading')).toHaveTextContent('2025')
    expect(
      await screen.findByText('1 book finished · 3h of reading')
    ).toBeInTheDocument()
    const totals = screen.getByTestId('year-totals')
    expect(within(totals).getByText('120')).toBeInTheDocument()
    expect(within(totals).getByText('2 days')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('year-books')).getByText(BOOK.title)
    ).toBeInTheDocument()
    expect(screen.getByText('In the evening')).toBeInTheDocument()
    expect(screen.getByText('Mystery')).toBeInTheDocument()
    expect(screen.getByText(/Most reading in Mar/)).toBeInTheDocument()
  })

  it('links to the neighbouring years that have data', async () => {
    renderPage()
    expect(await screen.findByTestId('year-prev')).toHaveAttribute(
      'href',
      '/stats/year/2023'
    )
    expect(screen.getByTestId('year-next')).toHaveAttribute(
      'href',
      '/stats/year/2026'
    )
  })

  it('sets a goal', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = await screen.findByTestId('goal-input')
    await user.type(input, '12')
    await user.click(screen.getByTestId('goal-save'))
    await waitFor(() =>
      expect(screen.getByTestId('goal-status')).toHaveTextContent('Goal missed')
    )
    expect(screen.getByText('11 books short')).toBeInTheDocument()
    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.url).toContain('/api/stats/goal/2025')
    expect(put?.body).toEqual({ books: 12 })
  })

  it('shows progress against an existing goal', async () => {
    data = review({
      year: 2026,
      goal: {
        year: 2026,
        target: 10,
        completed: 1,
        expected_by_now: 7.4,
        status: 'behind',
        remaining: 9,
        per_month_needed: 3,
      },
    })
    renderPage('2026')
    expect(await screen.findByTestId('goal-status')).toHaveTextContent(
      'Behind pace'
    )
    expect(
      screen.getByText('9 books to go · about 3 a month')
    ).toBeInTheDocument()
    expect(screen.getByTestId('goal-edit')).toBeInTheDocument()
  })

  it('says so when a year has no reading', async () => {
    data = review({
      totals: {
        books: 0,
        pages: 0,
        seconds: 0,
        sessions: 0,
        reading_days: 0,
        longest_streak: 0,
      },
      books: [],
      top_authors: [],
      top_genres: [],
      months: review().months.map((m) => ({ ...m, books: 0, seconds: 0 })),
      highlights: {
        longest_book: null,
        shortest_book: null,
        fastest_read: null,
        top_rated: null,
        busiest_day: null,
        favourite_time: null,
      },
    })
    renderPage()
    expect(
      await screen.findByText('No reading recorded in 2025.')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('year-books')).not.toBeInTheDocument()
    expect(screen.queryByTestId('highlights')).not.toBeInTheDocument()
  })

  it('shows an insight under each section when everything is shown at once', async () => {
    renderPage()
    await screen.findByTestId('all-chapters')
    expect(screen.getAllByTestId('insights').length).toBeGreaterThanOrEqual(4)
    expect(
      screen.getByText(/March was your biggest month: 2h, 67% of the year/)
    ).toBeInTheDocument()
    expect(screen.getByText(/An evening reader/)).toBeInTheDocument()
  })

  it('walks through the year chapter by chapter', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByTestId('walkthrough-toggle'))
    expect(localStorage.getItem('shelfloom:year-review-walkthrough')).toBe(
      'true'
    )
    expect(screen.getByTestId('walkthrough-title')).toHaveTextContent(
      'Your year'
    )
    expect(screen.queryByTestId('all-chapters')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('walkthrough-next'))
    expect(screen.getByTestId('walkthrough-title')).toHaveTextContent(
      'The goal'
    )
    await user.keyboard('{ArrowRight}')
    expect(screen.getByTestId('walkthrough-title')).toHaveTextContent(
      'Month by month'
    )
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByTestId('walkthrough-title')).toHaveTextContent(
      'The goal'
    )

    // Jump to the last chapter from the progress bar, then finish.
    await user.click(screen.getByRole('tab', { name: 'Most read' }))
    await user.click(screen.getByTestId('walkthrough-next'))
    expect(screen.getByTestId('walkthrough-end')).toHaveTextContent(
      'That was 2025.'
    )
    await user.click(screen.getByTestId('walkthrough-show-all'))
    expect(screen.getByTestId('all-chapters')).toBeInTheDocument()
    // Seeing everything once doesn't turn the walkthrough off for next time.
    expect(localStorage.getItem('shelfloom:year-review-walkthrough')).toBe(
      'true'
    )
  })

  it('remembers when the walkthrough is turned off', async () => {
    localStorage.setItem('shelfloom:year-review-walkthrough', 'true')
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByTestId('walkthrough')).toBeInTheDocument()
    await user.click(screen.getByTestId('walkthrough-toggle'))
    expect(screen.getByTestId('all-chapters')).toBeInTheDocument()
    expect(localStorage.getItem('shelfloom:year-review-walkthrough')).toBe(
      'false'
    )
  })
})
