import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Home from '../pages/Home'
import { TestMemoryRouter } from '../test-utils/router'

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

const MOCK_SERIALS_DASHBOARD = [
  {
    id: 7,
    title: 'The Wandering Inn',
    author: 'pirateaba',
    cover_path: null,
    status: 'ongoing',
    total_chapters: 20,
    live_chapter_count: 20,
    stubbed_chapter_count: 0,
    fetched_count: 12,
    new_chapter_count: 2,
    latest_chapter_title: 'Chapter 20',
    latest_chapter_date: '2026-03-10T00:00:00Z',
    last_checked_at: '2026-03-10T00:00:00Z',
    fetch_state: 'idle',
  },
]

const MOCK_BATCH_STATUS = {
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

function mockFetch(url: string, init?: RequestInit): Promise<Response> {
  let data: unknown = null
  const method = init?.method?.toUpperCase() ?? 'GET'

  if (url.includes('/api/books')) data = MOCK_BOOKS_RESPONSE
  else if (url.includes('/api/stats/overview')) data = MOCK_OVERVIEW
  else if (url.includes('/api/stats/heatmap')) data = MOCK_HEATMAP
  else if (url.includes('/api/stats/reading-time')) data = MOCK_TIME_SERIES
  else if (url.includes('/api/stats/pages')) data = MOCK_PAGES_SERIES
  else if (url.includes('/api/stats/recent-sessions'))
    data = MOCK_RECENT_SESSIONS
  else if (url.includes('/api/serials/fetch-pending-status'))
    data = MOCK_BATCH_STATUS
  else if (url.includes('/api/serials/dashboard')) data = MOCK_SERIALS_DASHBOARD
  else if (url.includes('/api/serials/fetch-pending') && method === 'POST')
    data = { ...MOCK_BATCH_STATUS, state: 'running', total_serials: 1 }
  else if (url.includes('/chapters/fetch-pending') && method === 'POST')
    data = {
      status: 'started',
      new_chapters: 0,
      pending_count: 3,
      job: {
        serial_id: 7,
        state: 'running',
        start: 13,
        end: 15,
        total: 3,
        started_at: '2026-03-10T00:00:00Z',
      },
    }

  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as Response)
}

async function renderHome() {
  render(
    <TestMemoryRouter>
      <Home />
    </TestMemoryRouter>
  )

  await screen.findByText('25 books in library')
  await screen.findByText('1h 30m')
  await waitFor(() => {
    expect(
      screen.queryByTestId('currently-reading-card') ??
        screen.queryByText(/nothing in progress/i)
    ).not.toBeNull()
  })
}

describe('Home', () => {
  let fetchSpy: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fetchSpy = vi.fn((url: unknown, init?: RequestInit) =>
      mockFetch(String(url), init)
    )
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('renders the dashboard heading', async () => {
    await renderHome()
    expect(
      screen.getByRole('heading', { name: /dashboard/i })
    ).toBeInTheDocument()
  })

  it('shows currently reading card when book is in progress', async () => {
    await renderHome()
    await waitFor(() => {
      expect(screen.getByTestId('currently-reading-card')).toBeInTheDocument()
      expect(screen.getAllByText('The Way of Kings').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Brandon Sanderson').length).toBeGreaterThan(0)
      expect(screen.getByText('42%')).toBeInTheDocument()
    })
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

    await renderHome()
    await waitFor(() =>
      expect(screen.getByText(/nothing in progress/i)).toBeInTheDocument()
    )
  })

  it('shows streak from overview', async () => {
    await renderHome()
    await waitFor(() =>
      expect(screen.getByText('7 Day Streak')).toBeInTheDocument()
    )
  })

  it('shows library totals in status row', async () => {
    await renderHome()
    await waitFor(() => {
      expect(screen.getByText('25 books in library')).toBeInTheDocument()
      expect(screen.getByText('8 completed')).toBeInTheDocument()
    })
  })

  it('shows recent activity feed', async () => {
    await renderHome()
    await waitFor(() => {
      expect(screen.getAllByTestId('activity-item').length).toBeGreaterThan(0)
      expect(screen.getByText('Mistborn')).toBeInTheDocument()
    })
  })

  it('shows this week stat cards', async () => {
    await renderHome()
    await waitFor(() =>
      expect(screen.getAllByText('This Week').length).toBeGreaterThan(0)
    )
    // 5400 seconds = 1h 30m
    expect(await screen.findByText('1h 30m')).toBeInTheDocument()
    // 120 pages
    expect(await screen.findByText('120')).toBeInTheDocument()
  })

  it('starts the dashboard pending batch from the header action', async () => {
    await renderHome()
    fireEvent.click(screen.getByRole('button', { name: /fetch all pending/i }))

    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/api/serials/fetch-pending') &&
            (init as RequestInit | undefined)?.method === 'POST'
        )
      ).toBe(true)
    )
  })

  it('starts a per-serial pending fetch from the dashboard card', async () => {
    await renderHome()
    fireEvent.click(screen.getByRole('button', { name: /fetch pending/i }))

    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/api/serials/7/chapters/fetch-pending') &&
            (init as RequestInit | undefined)?.method === 'POST'
        )
      ).toBe(true)
    )
  })
})
