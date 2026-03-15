import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from '../pages/Home'

const MOCK_BOOKS_RESPONSE = {
  items: [
    {
      id: 'book-1',
      title: 'The Way of Kings',
      author: 'Brandon Sanderson',
      format: 'epub',
      page_count: 1007,
      shelf_id: 1,
      shelf_name: 'Library',
      file_path: 'way-of-kings.epub',
      shelfloom_id: null,
      publisher: null,
      language: null,
      isbn: null,
      date_published: null,
      description: null,
      created_at: '',
      updated_at: '',
      reading_progress: 42,
    },
  ],
  total: 1,
  page: 1,
  per_page: 5,
  pages: 1,
}

const MOCK_OVERVIEW = {
  books_owned: 25,
  books_read: 8,
  total_reading_time_seconds: 360000,
  total_pages_read: 5000,
  current_streak_days: 7,
}

const MOCK_HEATMAP = Array.from({ length: 365 }, (_, i) => {
  const d = new Date(new Date().getFullYear(), 0, i + 1)
  return {
    date: d.toISOString().slice(0, 10),
    seconds: i % 7 === 0 ? 3600 : 0,
  }
})

const MOCK_TIME_SERIES = [{ date: '2026-03-10', value: 5400 }]
const MOCK_PAGES_SERIES = [{ date: '2026-03-10', value: 120 }]

const MOCK_RECENT_SESSIONS = [
  {
    book_id: 'book-1',
    title: 'The Way of Kings',
    author: 'Brandon Sanderson',
    duration: 3600,
    pages_read: 40,
    start_time: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    book_id: 'book-2',
    title: 'Mistborn',
    author: 'Brandon Sanderson',
    duration: 1800,
    pages_read: 20,
    start_time: new Date(Date.now() - 86400_000).toISOString(),
  },
]

function mockFetch(url: string): Promise<Response> {
  let data: unknown = null

  if (url.includes('/api/books')) data = MOCK_BOOKS_RESPONSE
  else if (url.includes('/api/stats/overview')) data = MOCK_OVERVIEW
  else if (url.includes('/api/stats/heatmap')) data = MOCK_HEATMAP
  else if (url.includes('/api/stats/reading-time')) data = MOCK_TIME_SERIES
  else if (url.includes('/api/stats/pages')) data = MOCK_PAGES_SERIES
  else if (url.includes('/api/stats/recent-sessions'))
    data = MOCK_RECENT_SESSIONS

  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as Response)
}

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  )
}

describe('Home', () => {
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

  it('renders the dashboard heading', () => {
    renderHome()
    expect(
      screen.getByRole('heading', { name: /dashboard/i })
    ).toBeInTheDocument()
  })

  it('shows currently reading card when book is in progress', async () => {
    renderHome()
    await waitFor(() =>
      expect(screen.getByTestId('currently-reading-card')).toBeInTheDocument()
    )
    expect(screen.getAllByText('The Way of Kings').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Brandon Sanderson').length).toBeGreaterThan(0)
    expect(screen.getByText('42% Complete')).toBeInTheDocument()
  })

  it('shows empty state when no books in progress', async () => {
    fetchSpy.mockImplementation((url) => {
      if (String(url).includes('/api/books')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              items: [],
              total: 0,
              page: 1,
              per_page: 5,
              pages: 0,
            }),
        } as Response)
      }
      return mockFetch(String(url))
    })

    renderHome()
    await waitFor(() =>
      expect(screen.getByText(/nothing in progress/i)).toBeInTheDocument()
    )
  })

  it('shows streak from overview', async () => {
    renderHome()
    await waitFor(() =>
      expect(screen.getByText('7 Day Streak')).toBeInTheDocument()
    )
  })

  it('shows library totals in status row', async () => {
    renderHome()
    await waitFor(() =>
      expect(screen.getByText('25 books in library')).toBeInTheDocument()
    )
    expect(screen.getByText('8 completed')).toBeInTheDocument()
  })

  it('shows recent activity feed', async () => {
    renderHome()
    await waitFor(() =>
      expect(screen.getAllByTestId('activity-item').length).toBeGreaterThan(0)
    )
    expect(screen.getByText('Mistborn')).toBeInTheDocument()
  })

  it('shows this week stat cards', async () => {
    renderHome()
    await waitFor(() =>
      expect(screen.getAllByText('This Week').length).toBeGreaterThan(0)
    )
    // 5400 seconds = 1h 30m
    expect(screen.getByText('1h 30m')).toBeInTheDocument()
    // 120 pages
    expect(screen.getByText('120')).toBeInTheDocument()
  })
})
