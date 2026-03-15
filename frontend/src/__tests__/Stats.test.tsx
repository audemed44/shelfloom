import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Stats from '../pages/Stats'

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_OVERVIEW = {
  books_owned: 42,
  books_read: 18,
  total_reading_time_seconds: 662400,
  total_pages_read: 12400,
  current_streak_days: 7,
}

const MOCK_READING_TIME = [
  { date: '2026-03-01', value: 3600 },
  { date: '2026-03-02', value: 1800 },
  { date: '2026-03-03', value: 5400 },
]

const MOCK_PAGES = [
  { date: '2026-03-01', value: 45 },
  { date: '2026-03-02', value: 20 },
]

const MOCK_STREAKS = {
  current: 7,
  longest: 21,
  last_read_date: '2026-03-14',
  history: [
    { start: '2026-03-08', end: '2026-03-14', days: 7 },
    { start: '2026-02-01', end: '2026-02-21', days: 21 },
  ],
}

const MOCK_HEATMAP = Array.from({ length: 365 }, (_, i) => {
  const d = new Date(new Date().getFullYear(), 0, i + 1)
  return { date: d.toISOString().slice(0, 10), seconds: i % 7 === 0 ? 3600 : 0 }
})

const MOCK_DISTRIBUTION = {
  by_hour: Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    seconds: i >= 20 ? 1800 : 0,
  })),
  by_weekday: Array.from({ length: 7 }, (_, i) => ({
    weekday: i,
    seconds: i < 5 ? 3600 : 600,
  })),
}

const MOCK_BY_AUTHOR = [
  { author: 'Brandon Sanderson', total_seconds: 7200, session_count: 4 },
  { author: 'Ted Chiang', total_seconds: 3600, session_count: 2 },
]

const MOCK_BY_TAG = [{ tag: 'fantasy', total_seconds: 7200, session_count: 4 }]

const MOCK_COMPLETED = [
  {
    book_id: 'b1',
    title: 'The Way of Kings',
    author: 'Brandon Sanderson',
    completed_at: '2026-03-01T00:00:00',
  },
]

const MOCK_CALENDAR: unknown[] = []

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(url: string): Promise<Response> {
  let data: unknown = null
  if (url.includes('/api/stats/overview')) data = MOCK_OVERVIEW
  else if (url.includes('/api/stats/reading-time')) data = MOCK_READING_TIME
  else if (url.includes('/api/stats/pages')) data = MOCK_PAGES
  else if (url.includes('/api/stats/streaks')) data = MOCK_STREAKS
  else if (url.includes('/api/stats/heatmap')) data = MOCK_HEATMAP
  else if (url.includes('/api/stats/distribution')) data = MOCK_DISTRIBUTION
  else if (url.includes('/api/stats/by-author')) data = MOCK_BY_AUTHOR
  else if (url.includes('/api/stats/by-tag')) data = MOCK_BY_TAG
  else if (url.includes('/api/stats/books-completed')) data = MOCK_COMPLETED
  else if (url.includes('/api/stats/calendar')) data = MOCK_CALENDAR
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as Response)
}

function renderStats() {
  return render(
    <MemoryRouter>
      <Stats />
    </MemoryRouter>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stats', () => {
  let fetchSpy: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fetchSpy = vi.fn((url: unknown) => mockFetch(String(url)))
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('renders heading and all tab buttons', () => {
    renderStats()
    expect(screen.getByTestId('stats-heading')).toBeInTheDocument()
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument()
    expect(screen.getByTestId('tab-reading-time')).toBeInTheDocument()
    expect(screen.getByTestId('tab-calendar')).toBeInTheDocument()
    expect(screen.getByTestId('tab-books-authors')).toBeInTheDocument()
    expect(screen.getByTestId('tab-streaks')).toBeInTheDocument()
  })

  it('shows metric cards when overview data loads', async () => {
    renderStats()
    await waitFor(() =>
      expect(
        screen.getAllByTestId('metric-card').length
      ).toBeGreaterThanOrEqual(4)
    )
    // books_owned = 42
    expect(screen.getByText('42')).toBeInTheDocument()
    // books_read = 18
    expect(screen.getByText('18 completed')).toBeInTheDocument()
  })

  it('renders empty states when no data is returned', async () => {
    fetchSpy.mockImplementation((url) => {
      const u = String(url)
      let data: unknown = null
      if (u.includes('/api/stats/overview'))
        data = {
          books_owned: 0,
          books_read: 0,
          total_reading_time_seconds: 0,
          total_pages_read: 0,
          current_streak_days: 0,
        }
      else if (u.includes('/api/stats/reading-time')) data = []
      else if (u.includes('/api/stats/pages')) data = []
      else if (u.includes('/api/stats/streaks'))
        data = { current: 0, longest: 0, last_read_date: null, history: [] }
      else if (u.includes('/api/stats/heatmap')) data = []
      else if (u.includes('/api/stats/distribution'))
        data = {
          by_hour: Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            seconds: 0,
          })),
          by_weekday: Array.from({ length: 7 }, (_, i) => ({
            weekday: i,
            seconds: 0,
          })),
        }
      else if (u.includes('/api/stats/by-author')) data = []
      else if (u.includes('/api/stats/by-tag')) data = []
      else if (u.includes('/api/stats/books-completed')) data = []
      else if (u.includes('/api/stats/calendar')) data = []
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(data),
      } as Response)
    })

    renderStats()
    await waitFor(() =>
      expect(screen.getByText('No data for this period')).toBeInTheDocument()
    )
  })

  it('date range preset changes the API call', async () => {
    const user = userEvent.setup()
    renderStats()

    // Wait for initial load
    await waitFor(() => screen.getByTestId('preset-30d'))

    // Click "Last Year"
    await user.click(screen.getByTestId('preset-1y'))

    // The reading-time API should be re-called with a from= param
    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map((c) => String(c[0]))
      const withFrom = calls.filter(
        (u) => u.includes('/api/stats/reading-time') && u.includes('from=')
      )
      expect(withFrom.length).toBeGreaterThan(0)
    })
  })

  it('granularity toggle updates bar chart title', async () => {
    const user = userEvent.setup()
    renderStats()

    await waitFor(() => screen.getByTestId('gran-day'))

    // Click Weekly
    await user.click(screen.getByTestId('gran-week'))

    // The reading-time API should have been called with granularity=week
    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map((c) => String(c[0]))
      const weekCalls = calls.filter(
        (u) =>
          u.includes('/api/stats/reading-time') &&
          u.includes('granularity=week')
      )
      expect(weekCalls.length).toBeGreaterThan(0)
    })
  })

  it('switching to calendar tab shows the calendar grid', async () => {
    const user = userEvent.setup()
    renderStats()

    await user.click(screen.getByTestId('tab-calendar'))

    // Calendar tab should render the grid
    await waitFor(() =>
      expect(screen.getByTestId('calendar-grid')).toBeInTheDocument()
    )
  })

  it('switching to books-authors tab shows author bars', async () => {
    const user = userEvent.setup()
    renderStats()

    await user.click(screen.getByTestId('tab-books-authors'))

    await waitFor(() =>
      expect(
        screen.getAllByText('Brandon Sanderson').length
      ).toBeGreaterThanOrEqual(1)
    )
    expect(screen.getAllByText('Ted Chiang').length).toBeGreaterThanOrEqual(1)
  })
})
