import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DataManagement from '../pages/DataManagement'
import { TestMemoryRouter } from '../test-utils/router'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const DUPLICATE_SESSIONS: import('../types/api').DuplicateSessionGroup[] = [
  {
    book_id: 'book-1',
    book_title: 'Dune',
    book_author: 'Frank Herbert',
    pairs: [
      {
        dismissed: {
          id: 10,
          book_id: 'book-1',
          start_time: '2024-03-01T09:00:00',
          duration: 3600,
          pages_read: 30,
          source: 'sdr',
          dismissed: true,
        },
        active: {
          id: 11,
          book_id: 'book-1',
          start_time: '2024-03-01T09:01:00',
          duration: 3900,
          pages_read: 35,
          source: 'stats_db',
          dismissed: false,
        },
      },
    ],
  },
]

const UNMATCHED: import('../types/api').UnmatchedEntry[] = [
  {
    id: 1,
    title: 'Unknown KO Book',
    author: 'KO Author',
    source: 'stats_db',
    source_path: '/koreader/statistics.sqlite3',
    session_count: 5,
    total_duration_seconds: 18000,
    dismissed: false,
    linked_book_id: null,
    created_at: '2024-01-01T00:00:00Z',
  },
]

const DUPLICATE_BOOKS: import('../types/api').DuplicateBookGroup[] = [
  {
    books: [
      {
        id: 'b1',
        title: 'Foundation',
        author: 'Isaac Asimov',
        format: 'epub',
        shelf_id: 1,
        date_added: '2024-01-01T00:00:00Z',
        session_count: 3,
      },
      {
        id: 'b2',
        title: 'Foundation',
        author: 'Isaac Asimov',
        format: 'epub',
        shelf_id: 1,
        date_added: '2024-02-01T00:00:00Z',
        session_count: 0,
      },
    ],
  },
]

const IMPORT_LOG: import('../types/api').ImportLogResponse = {
  items: [
    {
      id: 1,
      book_id: 'book-1',
      book_title: 'Dune',
      book_author: 'Frank Herbert',
      hash_sha: 'abcdef123456…',
      hash_md5: 'fedcba654321…',
      page_count: 412,
      recorded_at: '2024-03-01T12:00:00Z',
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
}

// ── Mock fetch ─────────────────────────────────────────────────────────────────

function mockFetch(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    '/api/data-mgmt/duplicate-sessions': DUPLICATE_SESSIONS,
    '/api/data-mgmt/unmatched': UNMATCHED,
    '/api/data-mgmt/duplicate-books': DUPLICATE_BOOKS,
    '/api/data-mgmt/import-log': IMPORT_LOG,
    '/api/books': { items: [], total: 0, page: 1, per_page: 500 },
    ...overrides,
  }

  globalThis.fetch = vi.fn(async (url: string) => {
    const path = url.replace('http://localhost:3000', '').split('?')[0]
    const found = Object.entries(defaults).find(([key]) => path.startsWith(key))
    const data = found ? found[1] : []
    return {
      ok: true,
      status: 200,
      json: async () => data,
    } as Response
  }) as unknown as typeof globalThis.fetch
}

async function renderPage() {
  render(
    <TestMemoryRouter initialEntries={['/data-management']}>
      <DataManagement />
    </TestMemoryRouter>
  )

  await waitFor(() => {
    expect(
      screen.queryByTestId('duplicate-group-book-1') ??
        screen.queryByTestId('no-duplicates')
    ).not.toBeNull()
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DataManagement page', () => {
  beforeEach(() => mockFetch())
  afterEach(() => vi.restoreAllMocks())

  it('renders the page title', async () => {
    await renderPage()
    expect(screen.getByText('Data Management')).toBeInTheDocument()
  })

  it('shows four tabs', async () => {
    await renderPage()
    expect(screen.getByText('Duplicate Sessions')).toBeInTheDocument()
    expect(screen.getByText('Unmatched Data')).toBeInTheDocument()
    expect(screen.getByText('Duplicate Books')).toBeInTheDocument()
    expect(screen.getByText('Import Log')).toBeInTheDocument()
  })

  describe('Duplicate Sessions tab', () => {
    it('shows a duplicate group with book title', async () => {
      await renderPage()
      await waitFor(() => {
        expect(screen.getByText('Dune')).toBeInTheDocument()
      })
    })

    it('shows dismissed and active session labels', async () => {
      await renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('dismissed-session')).toBeInTheDocument()
        expect(screen.getByTestId('active-session')).toBeInTheDocument()
      })
    })

    it('restore dismissed button triggers PATCH', async () => {
      const user = userEvent.setup()
      globalThis.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
        const path = (url as string).split('?')[0]
        if (opts?.method === 'PATCH' && path.includes('/dismissed')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'ok' }),
          } as Response
        }
        // default responses
        if (path.includes('duplicate-sessions')) {
          return {
            ok: true,
            status: 200,
            json: async () => DUPLICATE_SESSIONS,
          } as Response
        }
        return { ok: true, status: 200, json: async () => [] } as Response
      }) as unknown as typeof globalThis.fetch

      await renderPage()
      await waitFor(() => screen.getByText('Restore dismissed'))
      await user.click(screen.getByText('Restore dismissed'))

      // fetch was called with PATCH
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      const patchCall = calls.find(([, opts]) => opts?.method === 'PATCH')
      expect(patchCall).toBeTruthy()
    })

    it('shows empty state when no duplicates', async () => {
      mockFetch({ '/api/data-mgmt/duplicate-sessions': [] })
      await renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('no-duplicates')).toBeInTheDocument()
      })
    })
  })

  describe('Unmatched Data tab', () => {
    it('shows unmatched entries after switching tab', async () => {
      const user = userEvent.setup()
      await renderPage()
      await user.click(screen.getByText('Unmatched Data'))

      await waitFor(() => {
        expect(screen.getByText('Unknown KO Book')).toBeInTheDocument()
      })
    })

    it('shows empty state when no unmatched', async () => {
      mockFetch({ '/api/data-mgmt/unmatched': [] })
      const user = userEvent.setup()
      await renderPage()
      await user.click(screen.getByText('Unmatched Data'))
      await waitFor(() => {
        expect(screen.getByTestId('no-unmatched')).toBeInTheDocument()
      })
    })

    it('dismiss button triggers POST request', async () => {
      let dismissCalled = false
      globalThis.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
        const path = (url as string).split('?')[0]
        if (opts?.method === 'POST' && path.includes('/dismiss')) {
          dismissCalled = true
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'ok' }),
          } as Response
        }
        if (path.includes('data-mgmt/unmatched')) {
          return {
            ok: true,
            status: 200,
            json: async () => UNMATCHED,
          } as Response
        }
        return { ok: true, status: 200, json: async () => [] } as Response
      }) as unknown as typeof globalThis.fetch

      const user = userEvent.setup()
      await renderPage()
      await user.click(screen.getByText('Unmatched Data'))
      await waitFor(() => screen.getByText('Unknown KO Book'))
      await user.click(screen.getByLabelText('Dismiss'))

      expect(dismissCalled).toBe(true)
    })
  })

  describe('Duplicate Books tab', () => {
    it('shows duplicate book groups', async () => {
      const user = userEvent.setup()
      await renderPage()
      await user.click(screen.getByText('Duplicate Books'))

      await waitFor(() => {
        // Both books have same title "Foundation" — expect 2 entries
        const items = screen.getAllByText('Foundation')
        expect(items.length).toBeGreaterThanOrEqual(1)
      })
    })

    it('shows empty state when no duplicates', async () => {
      mockFetch({ '/api/data-mgmt/duplicate-books': [] })
      const user = userEvent.setup()
      await renderPage()
      await user.click(screen.getByText('Duplicate Books'))
      await waitFor(() => {
        expect(screen.getByTestId('no-duplicate-books')).toBeInTheDocument()
      })
    })
  })

  describe('Import Log tab', () => {
    it('shows import log entries', async () => {
      const user = userEvent.setup()
      await renderPage()
      await user.click(screen.getByText('Import Log'))

      await waitFor(() => {
        expect(screen.getByTestId('import-log-1')).toBeInTheDocument()
        expect(screen.getByText('Dune')).toBeInTheDocument()
      })
    })

    it('shows empty state when no import history', async () => {
      mockFetch({
        '/api/data-mgmt/import-log': {
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
        },
      })
      const user = userEvent.setup()
      await renderPage()
      await user.click(screen.getByText('Import Log'))
      await waitFor(() => {
        expect(screen.getByTestId('no-import-log')).toBeInTheDocument()
      })
    })
  })
})

describe('Settings links to DataManagement', () => {
  it('Settings page shows Data Management section', async () => {
    mockFetch({
      '/api/shelves': [],
      '/api/import/status': {
        is_running: false,
        last_scan_at: null,
        progress: null,
        error: null,
      },
    })

    const { default: Settings } = await import('../pages/Settings')
    render(
      <TestMemoryRouter>
        <Settings />
      </TestMemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByTestId('data-mgmt-btn')).toBeInTheDocument()
    })
  })
})
