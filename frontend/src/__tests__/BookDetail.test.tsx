import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import BookDetail from '../pages/BookDetail'

const BOOK = {
  id: 1,
  title: 'The Way of Kings',
  author: 'Brandon Sanderson',
  format: 'epub',
  shelf_id: 10,
  shelf_name: 'Main Library',
  page_count: 1007,
  language: 'en',
  publisher: 'Tor Books',
  date_published: '2010',
  description: 'An epic fantasy novel.',
  isbn: null,
  file_path: 'way-of-kings.epub',
  shelfloom_id: null,
  created_at: '2024-01-15T00:00:00',
  updated_at: '2024-01-15T00:00:00',
}

const SHELVES = [
  {
    id: 10,
    name: 'Main Library',
    book_count: 5,
    path: '/books',
    is_default: true,
    is_sync_target: false,
  },
  {
    id: 20,
    name: 'Kobo',
    book_count: 2,
    path: '/kobo',
    is_default: false,
    is_sync_target: true,
  },
]

const SUMMARY = {
  total_sessions: 3,
  total_time_seconds: 7200,
  percent_finished: 42 as number | null,
}

const SESSIONS = {
  items: [
    {
      id: 1,
      book_id: 1,
      started_at: '2024-06-01T20:00:00',
      start_time: '2024-06-01T20:00:00',
      duration_seconds: 3600,
      duration: 3600,
      pages_read: 60,
      device: 'Kobo Libra',
      source: 'sdr',
      dismissed: false,
    },
    {
      id: 2,
      book_id: 1,
      started_at: '2024-06-03T21:00:00',
      start_time: '2024-06-03T21:00:00',
      duration_seconds: 1800,
      duration: 1800,
      pages_read: 30,
      device: null,
      source: 'sdr',
      dismissed: false,
    },
  ],
  total: 2,
  page: 1,
  per_page: 5,
}

const HIGHLIGHTS = {
  items: [
    {
      id: 1,
      book_id: 1,
      text: 'Life before death.',
      note: 'First ideal',
      chapter: 'Prologue',
      created_at: '2024-06-01T20:30:00',
    },
  ],
  total: 1,
  page: 1,
  per_page: 5,
}

const SERIES = [
  {
    series_id: 1,
    series_name: 'Stormlight Archive',
    sequence: 1,
    prev_book: null,
    next_book: { id: 2, title: 'Words of Radiance' },
  },
]

interface MockFetchOptions {
  book?: typeof BOOK
  shelves?: typeof SHELVES
  summary?: typeof SUMMARY
  sessions?: typeof SESSIONS
  highlights?: typeof HIGHLIGHTS
  series?: typeof SERIES
}

function mockFetch({
  book = BOOK,
  shelves = SHELVES,
  summary = SUMMARY,
  sessions = SESSIONS,
  highlights = HIGHLIGHTS,
  series = SERIES,
}: MockFetchOptions = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.includes('/api/shelves'))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => shelves,
      }) as Promise<Response>
    if (u.includes('/reading-summary'))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => summary,
      }) as Promise<Response>
    if (u.includes('/sessions'))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => sessions,
      }) as Promise<Response>
    if (u.includes('/highlights'))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => highlights,
      }) as Promise<Response>
    if (u.match(/\/api\/books\/[^/]+\/series/))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => series,
      }) as Promise<Response>
    if (u.match(/\/api\/books\/[^/]+$/))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => book,
      }) as Promise<Response>
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Promise<Response>
  })
}

function renderDetail(bookId: string | number = 1) {
  return render(
    <MemoryRouter
      initialEntries={[`/books/${bookId}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/books/:id" element={<BookDetail />} />
        <Route
          path="/library"
          element={<div data-testid="library-page">Library</div>}
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('BookDetail', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = mockFetch()
  })
  afterEach(() => fetchSpy.mockRestore())

  it('renders book title and author', async () => {
    renderDetail()
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'The Way of Kings'
      )
    )
    expect(screen.getByText('Brandon Sanderson')).toBeInTheDocument()
  })

  it('shows format and shelf badges', async () => {
    renderDetail()
    await waitFor(() => screen.getByRole('heading', { level: 1 }))
    const badges = screen.getByTestId('book-badges')
    expect(badges).toHaveTextContent('Epub')
    expect(badges).toHaveTextContent('Main Library')
  })

  it('shows reading progress bar', async () => {
    renderDetail()
    await waitFor(() =>
      expect(screen.getByTestId('reading-progress')).toBeInTheDocument()
    )
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  it('shows series navigation with next book link', async () => {
    renderDetail()
    await waitFor(() =>
      expect(screen.getByTestId('series-nav')).toBeInTheDocument()
    )
    const nextLink = screen.getByTestId('next-book-link')
    expect(nextLink).toHaveAttribute('href', '/books/2')
    expect(nextLink).toHaveTextContent('Words of Radiance')
  })

  it('does not render prev-book-link when there is no previous book', async () => {
    renderDetail()
    await waitFor(() => screen.getByTestId('series-nav'))
    expect(screen.queryByTestId('prev-book-link')).not.toBeInTheDocument()
  })

  it('renders session history', async () => {
    renderDetail()
    await waitFor(() =>
      expect(screen.getByTestId('sessions-section')).toBeInTheDocument()
    )
    expect(screen.getByText('1h 0m')).toBeInTheDocument()
  })

  it('renders highlights', async () => {
    renderDetail()
    await waitFor(() =>
      expect(screen.getByTestId('highlights-section')).toBeInTheDocument()
    )
    expect(screen.getByText(/Life before death/)).toBeInTheDocument()
  })

  it('shows description', async () => {
    renderDetail()
    await waitFor(() =>
      expect(screen.getByText('An epic fantasy novel.')).toBeInTheDocument()
    )
  })

  it('shows not-found state when book returns 404', async () => {
    fetchSpy.mockRestore()
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      if (
        u.match(/\/api\/books\/[^/]+$/) &&
        !u.includes('/series') &&
        !u.includes('/sessions') &&
        !u.includes('/highlights') &&
        !u.includes('/reading-summary')
      ) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ detail: 'Not found' }),
        }) as Promise<Response>
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [],
      }) as Promise<Response>
    })
    renderDetail('missing-id')
    await waitFor(() =>
      expect(screen.getByTestId('not-found')).toBeInTheDocument()
    )
  })

  it('opens edit modal when edit button is clicked', async () => {
    const user = userEvent.setup()
    renderDetail()
    await waitFor(() => screen.getByTestId('edit-btn'))
    await user.click(screen.getByTestId('edit-btn'))
    expect(
      screen.getByRole('heading', { name: /edit book/i })
    ).toBeInTheDocument()
  })

  it('closes edit modal on cancel', async () => {
    const user = userEvent.setup()
    renderDetail()
    await waitFor(() => screen.getByTestId('edit-btn'))
    await user.click(screen.getByTestId('edit-btn'))
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(
      screen.queryByRole('heading', { name: /edit book/i })
    ).not.toBeInTheDocument()
  })

  it('edit modal saves changes via PATCH and updates book', async () => {
    const user = userEvent.setup()
    fetchSpy.mockRestore()
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, _options) => {
      if ((_options as RequestInit)?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ...BOOK, title: 'Updated Title' }),
        }) as Promise<Response>
      }
      return (
        fetchSpy['_impl']?.(url, _options) ??
        (mockFetch() as typeof fetchSpy)['_impl']?.(url, _options)
      )
    })

    renderDetail()
    await waitFor(() => screen.getByTestId('edit-btn'))
    await user.click(screen.getByTestId('edit-btn'))

    const titleInput = screen.getByDisplayValue('The Way of Kings')
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated Title')

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: /edit book/i })
      ).not.toBeInTheDocument()
    )
  })

  it('opens delete modal when delete button is clicked', async () => {
    const user = userEvent.setup()
    renderDetail()
    await waitFor(() => screen.getByTestId('delete-btn'))
    await user.click(screen.getByTestId('delete-btn'))
    expect(
      screen.getByRole('heading', { name: /delete book/i })
    ).toBeInTheDocument()
  })

  it('navigates to library after confirmed delete', async () => {
    const user = userEvent.setup()
    fetchSpy.mockRestore()
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, _options) => {
      const u = url.toString()
      if ((_options as RequestInit)?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          status: 204,
          json: async () => null,
        }) as Promise<Response>
      }
      if (u.includes('/api/shelves'))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SHELVES,
        }) as Promise<Response>
      if (u.includes('/reading-summary'))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SUMMARY,
        }) as Promise<Response>
      if (u.includes('/sessions'))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SESSIONS,
        }) as Promise<Response>
      if (u.includes('/highlights'))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => HIGHLIGHTS,
        }) as Promise<Response>
      if (u.match(/\/api\/books\/[^/]+\/series/))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SERIES,
        }) as Promise<Response>
      if (u.match(/\/api\/books\/[^/]+$/))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => BOOK,
        }) as Promise<Response>
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as Promise<Response>
    })

    renderDetail()
    await waitFor(() => screen.getByTestId('delete-btn'))
    await user.click(screen.getByTestId('delete-btn'))
    await user.click(screen.getByTestId('confirm-delete-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('library-page')).toBeInTheDocument()
    )
  })

  it('shows move shelf dropdown with other shelves', async () => {
    const user = userEvent.setup()
    renderDetail()
    await waitFor(() => screen.getByTestId('move-shelf-btn'))
    await user.click(screen.getByTestId('move-shelf-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('move-shelf-dropdown')).toBeInTheDocument()
    )
    expect(screen.getByText('Kobo')).toBeInTheDocument()
  })

  it('calls move API and updates shelf badge when shelf is selected', async () => {
    const user = userEvent.setup()
    fetchSpy.mockRestore()
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, _options) => {
      const u = url.toString()
      if (u.includes('/move')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ...BOOK, shelf_id: 20 }),
        }) as Promise<Response>
      }
      if (u.includes('/api/shelves'))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SHELVES,
        }) as Promise<Response>
      if (u.includes('/reading-summary'))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SUMMARY,
        }) as Promise<Response>
      if (u.includes('/sessions'))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SESSIONS,
        }) as Promise<Response>
      if (u.includes('/highlights'))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => HIGHLIGHTS,
        }) as Promise<Response>
      if (u.match(/\/api\/books\/[^/]+\/series/))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SERIES,
        }) as Promise<Response>
      if (u.match(/\/api\/books\/[^/]+$/))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => BOOK,
        }) as Promise<Response>
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as Promise<Response>
    })

    renderDetail()
    await waitFor(() => screen.getByTestId('move-shelf-btn'))
    await user.click(screen.getByTestId('move-shelf-btn'))
    await waitFor(() => screen.getByTestId('move-shelf-dropdown'))
    await user.click(screen.getByText('Kobo'))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/move'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('shows no reading progress when summary has no percent', async () => {
    fetchSpy.mockRestore()
    mockFetch({
      summary: {
        total_sessions: 0,
        total_time_seconds: 0,
        percent_finished: null,
      },
    })
    renderDetail()
    await waitFor(() => screen.getByRole('heading', { level: 1 }))
    expect(screen.queryByTestId('reading-progress')).not.toBeInTheDocument()
  })

  it('hides series nav when book has no series', async () => {
    fetchSpy.mockRestore()
    mockFetch({ series: [] })
    renderDetail()
    await waitFor(() => screen.getByRole('heading', { level: 1 }))
    expect(screen.queryByTestId('series-nav')).not.toBeInTheDocument()
  })
})
