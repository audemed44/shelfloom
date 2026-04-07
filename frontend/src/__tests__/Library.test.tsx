import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  waitFor,
  createEvent,
  fireEvent,
  within,
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
    status: 'unread',
    rating: 4.5,
    has_review: true,
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
    status: 'reading',
    rating: null,
    has_review: false,
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
    status: 'dnf',
    rating: null,
    has_review: false,
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

const MOCK_SERIES_TREE = [
  {
    id: 1,
    name: 'Dune Saga',
    description: null,
    parent_id: null,
    parent_name: null,
    sort_order: 0,
    cover_path: null,
    book_count: 6,
    first_book_id: '1',
    first_book_cover_path: null,
  },
  {
    id: 2,
    name: 'Foundation Series',
    description: null,
    parent_id: null,
    parent_name: null,
    sort_order: 0,
    cover_path: null,
    book_count: 7,
    first_book_id: '2',
    first_book_cover_path: null,
  },
  {
    id: 10,
    name: 'ABC',
    description: null,
    parent_id: null,
    parent_name: null,
    sort_order: 0,
    cover_path: null,
    book_count: 5,
    first_book_id: '1',
    first_book_cover_path: null,
  },
]

interface MockFetchOptions {
  books?: Record<string, unknown>[]
  total?: number
  shelves?: typeof MOCK_SHELVES
  uploadResponse?: (typeof MOCK_BOOKS)[0] | null
  seriesTree?: typeof MOCK_SERIES_TREE
}

function mockFetch({
  books = MOCK_BOOKS,
  total = MOCK_BOOKS.length,
  shelves = MOCK_SHELVES,
  uploadResponse = null,
  seriesTree = MOCK_SERIES_TREE,
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
    if (u.includes('/api/series/tree')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => seriesTree,
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
    if (
      u.includes('/api/genres') ||
      u.includes('/api/tags') ||
      u.includes('/api/authors')
    ) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [],
      }) as Promise<Response>
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        items: books,
        total,
        page: 1,
        per_page: 25,
        pages: Math.max(1, Math.ceil(total / 25)),
      }),
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
    localStorage.clear()
    fetchSpy = mockFetch()
  })
  afterEach(() => fetchSpy.mockRestore())

  it('renders the library heading', async () => {
    renderLibrary()
    await waitFor(() =>
      expect(screen.getAllByTestId('book-card')).toHaveLength(3)
    )
    expect(
      screen.getByRole('heading', { name: /library/i })
    ).toBeInTheDocument()
  })

  it('toggles ratings visibility on the library page', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() =>
      expect(screen.getAllByTestId('book-card')).toHaveLength(3)
    )

    expect(screen.getByText('4.5')).toBeInTheDocument()
    await user.click(screen.getByTestId('ratings-toggle'))
    expect(screen.queryByText('4.5')).not.toBeInTheDocument()
  })

  it('shows a quick-rate toast with add note action', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() =>
      expect(screen.getAllByTestId('book-card')).toHaveLength(3)
    )

    const firstCard = screen.getAllByTestId('book-card')[0]
    const ratingButtons = within(firstCard).getAllByLabelText('Rate 4 stars')
    await user.click(ratingButtons[0])

    const toast = screen.getByTestId('quick-rate-toast')
    expect(toast).toBeInTheDocument()
    expect(toast.className).toContain(
      'bottom-[calc(var(--mobile-bottom-nav-offset)+1rem)]'
    )
    expect(await screen.findByText('Rated 4.0 Stars')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Note' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
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

  it('uses backend pages for grouped pagination instead of raw total', async () => {
    const groupedBooks = [
      ...Array.from({ length: 4 }, (_, i) => ({
        ...MOCK_BOOKS[i % MOCK_BOOKS.length],
        id: 100 + i,
        title: `00 Grouped Series ${i + 1}`,
        series_id: 1,
        series_name: 'Grouped Series',
        series_sequence: i + 1,
      })),
      ...Array.from({ length: 24 }, (_, i) => ({
        ...MOCK_BOOKS[i % MOCK_BOOKS.length],
        id: 200 + i,
        title: `${String(i + 1).padStart(2, '0')} Standalone`,
      })),
    ]

    fetchSpy.mockRestore()
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      if (u.includes('/api/shelves')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_SHELVES,
        }) as Promise<Response>
      }
      if (
        u.includes('/api/genres') ||
        u.includes('/api/tags') ||
        u.includes('/api/authors')
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        }) as Promise<Response>
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: groupedBooks,
          total: 28,
          page: 1,
          per_page: 25,
          pages: 1,
        }),
      }) as Promise<Response>
    })

    localStorage.setItem('shelfloom:groupBySeries', 'true')
    renderLibrary()
    await waitFor(() => screen.getByTestId('series-card'))
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument()
    localStorage.removeItem('shelfloom:groupBySeries')
  })

  it('renders group-by-series toggle button', async () => {
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))
    expect(screen.getByTestId('group-by-series-toggle')).toBeInTheDocument()
  })

  it('keeps user sort when group-by-series is toggled on', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    await user.click(screen.getByTestId('group-by-series-toggle'))

    // Sort should remain last_read (default), not switch to series
    await waitFor(() => {
      const booksCall = fetchSpy.mock.calls.find(
        ([url]: [string]) =>
          url.includes('/api/books') && url.includes('sort=series')
      )
      expect(booksCall).toBeFalsy()
    })
  })

  it('shows series cards instead of individual books when grouping is on', async () => {
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
      expect(screen.getAllByTestId('series-card')).toHaveLength(2)
    })
    // Standalone book still renders as book-card
    expect(screen.getAllByTestId('book-card')).toHaveLength(1)
    expect(screen.getByText('Neuromancer')).toBeInTheDocument()
    localStorage.removeItem('shelfloom:groupBySeries')
  })

  it('series card shows book count', async () => {
    const seriesBooks = [
      {
        ...MOCK_BOOKS[0],
        series_id: 1,
        series_name: 'Dune Saga',
        series_sequence: 1,
      },
      {
        ...MOCK_BOOKS[1],
        series_id: 1,
        series_name: 'Dune Saga',
        series_sequence: 2,
      },
      {
        ...MOCK_BOOKS[2],
      },
    ]
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({ books: seriesBooks, total: 2 })
    localStorage.setItem('shelfloom:groupBySeries', 'true')
    renderLibrary()

    await waitFor(() => {
      expect(screen.getByTestId('series-card')).toBeInTheDocument()
    })
    expect(screen.getByText('2 books')).toBeInTheDocument()
    localStorage.removeItem('shelfloom:groupBySeries')
  })

  it('fills grouped pages to 25 visible entries when series collapse books', async () => {
    const groupedBooks = [
      ...Array.from({ length: 3 }, (_, i) => ({
        ...MOCK_BOOKS[i % MOCK_BOOKS.length],
        id: 300 + i,
        title: `00 Paged Series ${i + 1}`,
        series_id: 1,
        series_name: 'Paged Series',
        series_sequence: i + 1,
      })),
      ...Array.from({ length: 24 }, (_, i) => ({
        ...MOCK_BOOKS[i % MOCK_BOOKS.length],
        id: 400 + i,
        title: `${String(i + 1).padStart(2, '0')} Visible Book`,
      })),
    ]

    fetchSpy.mockRestore()
    fetchSpy = mockFetch({ books: groupedBooks, total: 27 })
    localStorage.setItem('shelfloom:groupBySeries', 'true')
    renderLibrary()

    await waitFor(() => {
      expect(screen.getByTestId('series-card')).toBeInTheDocument()
    })
    expect(screen.getAllByTestId('book-card')).toHaveLength(24)
    localStorage.removeItem('shelfloom:groupBySeries')
  })

  it('clicking series card expands to show individual books', async () => {
    const user = userEvent.setup()
    const seriesBooks = [
      {
        ...MOCK_BOOKS[0],
        series_id: 1,
        series_name: 'Dune Saga',
        series_sequence: 1,
      },
      {
        ...MOCK_BOOKS[1],
        series_id: 1,
        series_name: 'Dune Saga',
        series_sequence: 2,
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
      expect(screen.getByTestId('series-card')).toBeInTheDocument()
    })
    // Only 1 book-card (standalone Neuromancer)
    expect(screen.getAllByTestId('book-card')).toHaveLength(1)

    // Click to expand
    await user.click(screen.getByLabelText('Expand Dune Saga'))

    await waitFor(() => {
      // Now all 3 books visible as book-cards
      expect(screen.getAllByTestId('book-card')).toHaveLength(3)
    })
    expect(screen.getByTestId('series-expanded-header')).toBeInTheDocument()
    expect(screen.queryByTestId('series-card')).not.toBeInTheDocument()
    localStorage.removeItem('shelfloom:groupBySeries')
  })

  it('clicking expanded header collapses back to series card', async () => {
    const user = userEvent.setup()
    const seriesBooks = [
      {
        ...MOCK_BOOKS[0],
        series_id: 1,
        series_name: 'Dune Saga',
        series_sequence: 1,
      },
      {
        ...MOCK_BOOKS[1],
        series_id: 1,
        series_name: 'Dune Saga',
        series_sequence: 2,
      },
    ]
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({ books: seriesBooks, total: 2 })
    localStorage.setItem('shelfloom:groupBySeries', 'true')
    renderLibrary()

    await waitFor(() => {
      expect(screen.getByTestId('series-card')).toBeInTheDocument()
    })

    // Expand
    await user.click(screen.getByLabelText('Expand Dune Saga'))
    await waitFor(() => {
      expect(screen.getByTestId('series-expanded-header')).toBeInTheDocument()
    })

    // Collapse
    await user.click(screen.getByTestId('series-expanded-header'))
    await waitFor(() => {
      expect(screen.getByTestId('series-card')).toBeInTheDocument()
    })
    expect(
      screen.queryByTestId('series-expanded-header')
    ).not.toBeInTheDocument()
    localStorage.removeItem('shelfloom:groupBySeries')
  })

  it('series link icon has correct href to /series/{id}', async () => {
    const seriesBooks = [
      {
        ...MOCK_BOOKS[0],
        series_id: 1,
        series_name: 'Dune Saga',
        series_sequence: 1,
      },
    ]
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({ books: seriesBooks, total: 1 })
    localStorage.setItem('shelfloom:groupBySeries', 'true')
    renderLibrary()

    await waitFor(() => {
      expect(screen.getByTestId('series-card')).toBeInTheDocument()
    })
    const link = screen.getByTestId('series-link')
    expect(link).toHaveAttribute('href', '/series/1')
    localStorage.removeItem('shelfloom:groupBySeries')
  })

  it('standalone books still render as book-card when grouping is on', async () => {
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({ books: MOCK_BOOKS, total: 3 })
    localStorage.setItem('shelfloom:groupBySeries', 'true')
    renderLibrary()

    await waitFor(() => {
      // All standalone — no series cards
      expect(screen.getAllByTestId('book-card')).toHaveLength(3)
    })
    expect(screen.queryByTestId('series-card')).not.toBeInTheDocument()
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

describe('Bulk Upload', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    localStorage.clear()
    fetchSpy = mockFetch({ uploadResponse: MOCK_BOOKS[0] })
  })
  afterEach(() => fetchSpy.mockRestore())

  it('adds files to list when selected via file input', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getByTestId('upload-zone'))

    const input = screen.getByTestId('file-input')
    await user.upload(input, [
      new File(['content'], 'dune.epub', { type: 'application/epub+zip' }),
      new File(['content'], 'foundation.pdf', { type: 'application/pdf' }),
    ])

    await waitFor(() =>
      expect(screen.getAllByTestId('file-row')).toHaveLength(2)
    )
    expect(screen.getByTestId('upload-all-button')).toBeInTheDocument()
  })

  it('file drop adds files to list', async () => {
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
      expect(screen.getAllByTestId('file-row')).toHaveLength(1)
    )
  })

  it('ignores invalid file types', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderLibrary()
    await waitFor(() => screen.getByTestId('upload-zone'))

    const input = screen.getByTestId('file-input')
    await user.upload(input, [
      new File(['content'], 'notes.txt', { type: 'text/plain' }),
    ])

    // No file rows should appear for .txt
    expect(screen.queryByTestId('file-row')).not.toBeInTheDocument()
  })

  it('uploads all files when Upload All is clicked', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getByTestId('upload-zone'))

    const input = screen.getByTestId('file-input')
    await user.upload(
      input,
      new File(['content'], 'dune.epub', { type: 'application/epub+zip' })
    )

    await waitFor(() => screen.getByTestId('upload-all-button'))
    await user.click(screen.getByTestId('upload-all-button'))

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/books'),
        expect.objectContaining({ method: 'POST' })
      )
    )
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
          per_page: 25,
          pages: 1,
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

    await waitFor(() => screen.getByTestId('upload-all-button'))
    await user.click(screen.getByTestId('upload-all-button'))

    await waitFor(() =>
      expect(screen.getAllByTestId('book-card')).toHaveLength(1)
    )
  })
})

describe('Bulk Selection', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    localStorage.clear()
    fetchSpy = mockFetch()
  })
  afterEach(() => fetchSpy.mockRestore())

  it('does not show bulk toolbar by default', async () => {
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))
    expect(screen.queryByTestId('bulk-toolbar')).not.toBeInTheDocument()
  })

  it('shows bulk toolbar after clicking a book checkbox', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    const checkboxes = screen.getAllByTestId('book-select-checkbox')
    await user.click(checkboxes[0])

    await waitFor(() =>
      expect(screen.getByTestId('bulk-toolbar')).toBeInTheDocument()
    )
    expect(screen.getByTestId('bulk-toolbar').className).toContain(
      'bottom-mobile-bottom-nav'
    )
    expect(screen.getByTestId('library-page-shell').className).toContain(
      'pb-mobile-bottom-toolbar'
    )
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('clears selection when clear button is clicked', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    // Select a book
    const checkboxes = screen.getAllByTestId('book-select-checkbox')
    await user.click(checkboxes[0])
    await waitFor(() => screen.getByTestId('bulk-toolbar'))

    // Clear selection
    await user.click(screen.getByTestId('bulk-clear-btn'))
    await waitFor(() =>
      expect(screen.queryByTestId('bulk-toolbar')).not.toBeInTheDocument()
    )
  })

  it('select all selects all visible books', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    // Select one book first to show toolbar
    const checkboxes = screen.getAllByTestId('book-select-checkbox')
    await user.click(checkboxes[0])
    await waitFor(() => screen.getByTestId('bulk-toolbar'))

    // Click select all
    await user.click(screen.getByTestId('bulk-select-all'))
    await waitFor(() =>
      expect(screen.getByText('3 selected')).toBeInTheDocument()
    )
  })

  it('clears selection when search changes', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    // Select a book
    const checkboxes = screen.getAllByTestId('book-select-checkbox')
    await user.click(checkboxes[0])
    await waitFor(() => screen.getByTestId('bulk-toolbar'))

    // Type in search
    await user.type(screen.getByTestId('search-input'), 'test')

    // Toolbar should disappear (selection cleared after debounce)
    await waitFor(() =>
      expect(screen.queryByTestId('bulk-toolbar')).not.toBeInTheDocument()
    )
  })

  it('shows Save as Lens button in FilterDrawer', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    await user.click(screen.getByTestId('filters-button'))
    expect(await screen.findByTestId('save-as-lens-btn')).toBeInTheDocument()
  })

  it('opens SaveLensModal from Save as Lens button in FilterDrawer', async () => {
    const user = userEvent.setup()
    // Add lenses mock to fetch
    fetchSpy.mockRestore()
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      if (u.includes('/api/lenses')) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            id: 1,
            name: 'Test',
            book_count: 0,
            cover_book_id: null,
            cover_book_path: null,
            filter_state: {
              genres: [],
              tags: [],
              series_ids: [],
              authors: [],
              formats: [],
              has_genre: null,
              has_tag: null,
              has_author: null,
              has_series: null,
              mode: 'and',
              shelf_id: null,
              status: null,
            },
            created_at: '',
            updated_at: '',
          }),
        }) as Promise<Response>
      }
      if (u.includes('/api/shelves')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_SHELVES,
        }) as Promise<Response>
      }
      if (u.includes('/api/series/tree')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_SERIES_TREE,
        }) as Promise<Response>
      }
      if (
        u.includes('/api/genres') ||
        u.includes('/api/tags') ||
        u.includes('/api/authors')
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        }) as Promise<Response>
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: MOCK_BOOKS,
          total: MOCK_BOOKS.length,
          page: 1,
          per_page: 25,
          pages: 1,
        }),
      }) as Promise<Response>
    })

    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    await user.click(screen.getByTestId('filters-button'))
    await user.click(await screen.findByTestId('save-as-lens-btn'))

    expect(screen.getByTestId('save-lens-modal')).toBeInTheDocument()
  })

  it('requests books with has_genre=false when No Genre is applied', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    await user.click(screen.getByTestId('filters-button'))
    await user.click(await screen.findByTestId('accordion-genre'))
    await user.click(await screen.findByRole('checkbox', { name: /no genre/i }))
    await user.click(screen.getByTestId('filter-apply'))

    await waitFor(() => {
      expect(
        vi
          .mocked(globalThis.fetch)
          .mock.calls.some(
            ([url]) =>
              url.toString().includes('/api/books?') &&
              url.toString().includes('has_genre=false')
          )
      ).toBe(true)
    })
  })
})
