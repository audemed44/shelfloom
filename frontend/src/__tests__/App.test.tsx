import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

const APP_OVERVIEW = {
  books_owned: 0,
  books_read: 0,
  total_reading_time_seconds: 0,
  total_pages_read: 0,
  current_streak_days: 0,
}

const APP_DISTRIBUTION = {
  by_hour: Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0 })),
  by_weekday: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    seconds: 0,
  })),
}

const EMPTY_BOOKS = {
  items: [],
  total: 0,
  page: 1,
  per_page: 200,
  pages: 0,
}

function mockFetch(url: string): Promise<Response> {
  let data: unknown = null

  if (url.includes('/api/shelves')) data = [{ id: 1, name: 'Library' }]
  else if (url.includes('/api/books?status=reading')) data = EMPTY_BOOKS
  else if (url.includes('/api/stats/overview')) data = APP_OVERVIEW
  else if (url.includes('/api/stats/heatmap')) data = []
  else if (url.includes('/api/stats/reading-time')) data = []
  else if (url.includes('/api/stats/pages')) data = []
  else if (url.includes('/api/stats/streaks'))
    data = { current: 0, longest: 0, last_read_date: null, history: [] }
  else if (url.includes('/api/stats/distribution')) data = APP_DISTRIBUTION
  else if (url.includes('/api/stats/by-author')) data = []
  else if (url.includes('/api/stats/by-tag')) data = []
  else if (url.includes('/api/stats/calendar')) data = []
  else if (url.includes('/api/stats/recent-sessions')) data = []
  else if (url.includes('/api/stats/books-completed')) data = []
  else if (url.includes('/api/serials/fetch-pending-status'))
    data = {
      state: 'idle',
      total_serials: 0,
      processed_serials: 0,
      current_serial_id: null,
      started: 0,
      already_running: 0,
      noop: 0,
      failed: 0,
      new_chapters: 0,
      started_at: null,
      finished_at: null,
      error: null,
    }
  else if (url.includes('/api/serials/dashboard')) data = []
  else data = []

  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as Response)
}

async function renderApp() {
  render(<App />)
  await screen.findByRole('heading', { name: /dashboard/i })
  await screen.findByText('0 books in library')
}

describe('App', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/')
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (url: string | URL | Request) => mockFetch(url.toString())
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders without crashing', async () => {
    await renderApp()
    expect(document.body).toBeTruthy()
  })

  it('shows navigation items (sidebar + bottom nav both render them)', async () => {
    await renderApp()
    // Both Sidebar and BottomNav render the same labels — getAllByText asserts ≥1
    expect(screen.getAllByText('Library').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Stats').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Series').length).toBeGreaterThan(0)
  })

  it('shows dashboard page by default', async () => {
    await renderApp()
    expect(
      screen.getByRole('heading', { name: /dashboard/i })
    ).toBeInTheDocument()
  })

  it('navigates to library page', async () => {
    const user = userEvent.setup()
    await renderApp()
    // Click the first matching nav link (sidebar or bottom nav)
    await user.click(screen.getAllByText('Library')[0])
    expect(
      await screen.findByRole('heading', { name: /library/i })
    ).toBeInTheDocument()
  })

  it('navigates to stats page', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getAllByText('Stats')[0])
    expect(
      await screen.findByRole('heading', { name: /stats/i })
    ).toBeInTheDocument()
  })

  it('navigates to series page', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getAllByText('Series')[0])
    expect(
      await screen.findByRole('heading', { name: /series/i })
    ).toBeInTheDocument()
  })
})
