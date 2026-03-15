import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  waitFor,
  createEvent,
  fireEvent,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Library from '../pages/Library'

const MOCK_SHELVES = [
  {
    id: 1,
    name: 'Main Library',
    book_count: 3,
    path: '/books',
    is_default: true,
    is_sync_target: false,
  },
]

const MOCK_BOOKS = [
  {
    id: 1,
    title: 'Dune',
    author: 'Frank Herbert',
    format: 'epub',
    page_count: 412,
    shelf_id: 1,
    shelf_name: 'Main Library',
    file_path: null,
    shelfloom_id: null,
    publisher: null,
    language: null,
    isbn: null,
    date_published: null,
    description: null,
    created_at: '',
    updated_at: '',
    reading_progress: null,
    last_read: null,
    series_id: null,
    series_name: null,
    series_sequence: null,
  },
  {
    id: 2,
    title: 'Foundation',
    author: 'Isaac Asimov',
    format: 'epub',
    page_count: 255,
    shelf_id: 1,
    shelf_name: 'Main Library',
    file_path: null,
    shelfloom_id: null,
    publisher: null,
    language: null,
    isbn: null,
    date_published: null,
    description: null,
    created_at: '',
    updated_at: '',
    reading_progress: null,
    last_read: null,
    series_id: null,
    series_name: null,
    series_sequence: null,
  },
  {
    id: 3,
    title: 'Neuromancer',
    author: 'William Gibson',
    format: 'pdf',
    page_count: 271,
    shelf_id: 1,
    shelf_name: 'Main Library',
    file_path: null,
    shelfloom_id: null,
    publisher: null,
    language: null,
    isbn: null,
    date_published: null,
    description: null,
    created_at: '',
    updated_at: '',
    reading_progress: null,
    last_read: null,
    series_id: null,
    series_name: null,
    series_sequence: null,
  },
]

interface MockFetchOptions {
  books?: Record<string, unknown>[]
  total?: number
  shelves?: typeof MOCK_SHELVES
  uploadResponse?: (typeof MOCK_BOOKS)[0] | null
}

function mockFetch({
  books = MOCK_BOOKS,
  total = MOCK_BOOKS.length,
  shelves = MOCK_SHELVES,
  uploadResponse = null,
}: MockFetchOptions = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) => {
    const u = url.toString()
    const method = ((options as RequestInit)?.method ?? 'GET').toUpperCase()
    if (u.includes('/api/shelves')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => shelves,
      }) as Promise<Response>
    }
    if (u.includes('/api/books') && method === 'POST') {
      if (uploadResponse) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => uploadResponse,
        }) as Promise<Response>
      }
      return Promise.resolve({
        ok: false,
        status: 422,
        json: async () => ({ detail: 'Upload failed' }),
      }) as Promise<Response>
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ items: books, total, page: 1, per_page: 24 }),
    }) as Promise<Response>
  })
}

function renderLibrary() {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Library />
    </MemoryRouter>
  )
}

describe('Library', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = mockFetch()
  })
  afterEach(() => fetchSpy.mockRestore())

  it('renders the library heading', () => {
    renderLibrary()
    expect(
      screen.getByRole('heading', { name: /library/i })
    ).toBeInTheDocument()
  })

  it('shows loading skeletons while fetching', () => {
    // Don't resolve fetch — stay in loading state
    fetchSpy.mockReturnValue(new Promise(() => {}))
    renderLibrary()
    expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThan(0)
  })

  it('renders the correct number of book cards', async () => {
    renderLibrary()
    await waitFor(() =>
      expect(screen.getAllByTestId('book-card')).toHaveLength(3)
    )
  })

  it('renders book titles', async () => {
    renderLibrary()
    await waitFor(() => {
      expect(screen.getByText('Dune')).toBeInTheDocument()
      expect(screen.getByText('Foundation')).toBeInTheDocument()
      expect(screen.getByText('Neuromancer')).toBeInTheDocument()
    })
  })

  it('shows empty state when no books', async () => {
    fetchSpy.mockRestore()
    mockFetch({ books: [], total: 0 })
    renderLibrary()
    await waitFor(() =>
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    )
  })

  it('shows empty state when search has no results', async () => {
    fetchSpy.mockRestore()
    mockFetch({ books: [], total: 0 })
    renderLibrary()
    await waitFor(() =>
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    )
  })

  it('switches to list view when list toggle is clicked', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() =>
      expect(screen.getAllByTestId('book-card')).toHaveLength(3)
    )

    await user.click(screen.getByLabelText('List view'))
    await waitFor(() =>
      expect(screen.getAllByTestId('book-row')).toHaveLength(3)
    )
    expect(screen.queryByTestId('book-card')).not.toBeInTheDocument()
  })

  it('switches back to grid view from list', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    await user.click(screen.getByLabelText('List view'))
    await user.click(screen.getByLabelText('Grid view'))
    await waitFor(() =>
      expect(screen.getAllByTestId('book-card')).toHaveLength(3)
    )
  })

  it('renders shelf tabs when shelves exist', async () => {
    renderLibrary()
    await waitFor(() =>
      expect(screen.getByText('Main Library')).toBeInTheDocument()
    )
    expect(screen.getByTestId('shelf-tab-all')).toBeInTheDocument()
  })

  it('passes shelf_id param when shelf tab is selected', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getByText('Main Library'))
    await user.click(screen.getByText('Main Library'))

    await waitFor(() => {
      const booksCall = fetchSpy.mock.calls.find(
        ([url]: [string]) =>
          url.includes('/api/books') && url.includes('shelf_id=1')
      )
      expect(booksCall).toBeTruthy()
    })
  })

  it('passes sort param when sort is changed', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    await user.selectOptions(screen.getByTestId('sort-select'), 'title')

    await waitFor(() => {
      const booksCall = fetchSpy.mock.calls.find(
        ([url]: [string]) =>
          url.includes('/api/books') && url.includes('sort=title')
      )
      expect(booksCall).toBeTruthy()
    })
  })

  it('does not show pagination when total <= per_page', async () => {
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument()
  })

  it('shows pagination when total exceeds per_page', async () => {
    fetchSpy.mockRestore()
    mockFetch({ total: 50 })
    renderLibrary()
    await waitFor(() =>
      expect(screen.getByLabelText('Next page')).toBeInTheDocument()
    )
  })

  it('renders group-by-series toggle button', async () => {
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))
    expect(screen.getByTestId('group-by-series-toggle')).toBeInTheDocument()
  })

  it('sends sort=series when group-by-series is toggled on', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    await user.click(screen.getByTestId('group-by-series-toggle'))

    await waitFor(() => {
      const booksCall = fetchSpy.mock.calls.find(
        ([url]: [string]) =>
          url.includes('/api/books') && url.includes('sort=series')
      )
      expect(booksCall).toBeTruthy()
    })
  })

  it('shows series group headers when grouping is on', async () => {
    const seriesBooks = [
      {
        ...MOCK_BOOKS[0],
        series_id: 1,
        series_name: 'Dune Saga',
        series_sequence: 1,
      },
      {
        ...MOCK_BOOKS[1],
        series_id: 2,
        series_name: 'Foundation Series',
        series_sequence: 1,
      },
      {
        ...MOCK_BOOKS[2],
      },
    ]
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({ books: seriesBooks, total: 3 })
    localStorage.setItem('shelfloom:groupBySeries', 'true')
    renderLibrary()

    await waitFor(() => {
      expect(screen.getAllByTestId('series-group-header')).toHaveLength(3)
    })
    expect(screen.getByText('Dune Saga')).toBeInTheDocument()
    expect(screen.getByText('Foundation Series')).toBeInTheDocument()
    expect(screen.getByText('Ungrouped')).toBeInTheDocument()
    localStorage.removeItem('shelfloom:groupBySeries')
  })

  it('persists group-by-series preference in localStorage', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    await user.click(screen.getByTestId('group-by-series-toggle'))
    expect(localStorage.getItem('shelfloom:groupBySeries')).toBe('true')

    await user.click(screen.getByTestId('group-by-series-toggle'))
    expect(localStorage.getItem('shelfloom:groupBySeries')).toBe('false')
  })
})

describe('Upload', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = mockFetch({ uploadResponse: MOCK_BOOKS[0] })
  })
  afterEach(() => fetchSpy.mockRestore())

  it('file drop triggers upload', async () => {
    renderLibrary()
    await waitFor(() => screen.getByTestId('upload-zone'))

    const file = new File(['content'], 'dune.epub', {
      type: 'application/epub+zip',
    })
    const dropEvent = createEvent.drop(screen.getByTestId('upload-zone'))
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [file] },
    })
    fireEvent(screen.getByTestId('upload-zone'), dropEvent)

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/books'),
        expect.objectContaining({ method: 'POST' })
      )
    )
  })

  it('shows progress spinner during upload', async () => {
    const user = userEvent.setup()
    let resolveUpload!: (v: unknown) => void
    fetchSpy.mockImplementation((url: string, options?: RequestInit) => {
      const u = url.toString()
      const method = ((options as RequestInit)?.method ?? 'GET').toUpperCase()
      if (u.includes('/api/shelves')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_SHELVES,
        }) as Promise<Response>
      }
      if (u.includes('/api/books') && method === 'POST') {
        return new Promise((r) => {
          resolveUpload = r
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: MOCK_BOOKS,
          total: MOCK_BOOKS.length,
          page: 1,
          per_page: 24,
        }),
      }) as Promise<Response>
    })

    renderLibrary()
    const input = screen.getByTestId('file-input')
    await user.upload(
      input,
      new File(['content'], 'dune.epub', { type: 'application/epub+zip' })
    )

    await waitFor(() =>
      expect(screen.getByTestId('upload-spinner')).toBeInTheDocument()
    )

    // Resolve so upload doesn't leak into other tests
    resolveUpload({ ok: true, status: 201, json: async () => MOCK_BOOKS[0] })
  })

  it('shows error for invalid file type', async () => {
    // applyAccept: false simulates bypassing the file picker filter (e.g. via drag-and-drop)
    const user = userEvent.setup({ applyAccept: false })
    renderLibrary()
    const input = screen.getByTestId('file-input')
    await user.upload(
      input,
      new File(['content'], 'notes.txt', { type: 'text/plain' })
    )

    await waitFor(() =>
      expect(screen.getByTestId('upload-error')).toBeInTheDocument()
    )
    expect(screen.getByTestId('upload-error')).toHaveTextContent(/epub.*pdf/i)
  })

  it('refreshes book list after successful upload', async () => {
    const user = userEvent.setup()
    let bookCount = 0
    fetchSpy.mockImplementation((url: string, options?: RequestInit) => {
      const u = url.toString()
      const method = ((options as RequestInit)?.method ?? 'GET').toUpperCase()
      if (u.includes('/api/shelves')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_SHELVES,
        }) as Promise<Response>
      }
      if (u.includes('/api/books') && method === 'POST') {
        bookCount = 1
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => MOCK_BOOKS[0],
        }) as Promise<Response>
      }
      const books = bookCount > 0 ? [MOCK_BOOKS[0]] : []
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: books,
          total: books.length,
          page: 1,
          per_page: 24,
        }),
      }) as Promise<Response>
    })

    renderLibrary()
    await waitFor(() =>
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    )

    const input = screen.getByTestId('file-input')
    await user.upload(
      input,
      new File(['content'], 'dune.epub', { type: 'application/epub+zip' })
    )

    await waitFor(() =>
      expect(screen.queryByTestId('upload-spinner')).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(screen.getAllByTestId('book-card')).toHaveLength(1)
    )
  })
})
