import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SeriesDetail from '../pages/SeriesDetail'

const SERIES = {
  id: 1,
  name: 'Stormlight Archive',
  description: 'Epic fantasy',
  parent_id: null,
  sort_order: 0,
  cover_path: null,
}

const SERIES_BOOKS = [
  {
    book_id: 'uuid1',
    sequence: 1,
    title: 'The Way of Kings',
    author: 'Brandon Sanderson',
    format: 'epub',
    cover_path: null,
  },
  {
    book_id: 'uuid2',
    sequence: 2,
    title: 'Words of Radiance',
    author: 'Brandon Sanderson',
    format: 'epub',
    cover_path: null,
  },
]

const READING_ORDERS = [
  { id: 10, name: 'Publication Order', series_id: 1, entries: [] },
]

const SERIES_TREE = [
  {
    id: 1,
    name: 'Stormlight Archive',
    parent_id: null,
    book_count: 2,
    description: null,
    sort_order: 0,
    cover_path: null,
  },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockFetch(overrides: Record<string, any> = {}): any {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()

    if (u.includes('/api/series/tree')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.tree ?? SERIES_TREE,
      }) as Promise<Response>
    }
    if (u.match(/\/api\/series\/\d+\/reading-orders/)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.readingOrders ?? READING_ORDERS,
      }) as Promise<Response>
    }
    if (u.match(/\/api\/series\/\d+\/books$/)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.books ?? SERIES_BOOKS,
      }) as Promise<Response>
    }
    if (u.match(/\/api\/series\/\d+$/)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.series ?? SERIES,
      }) as Promise<Response>
    }
    if (u.includes('/reading-summary')) {
      const summary = overrides.summary ?? {
        percent_finished: null,
        total_time_seconds: 0,
        total_sessions: 0,
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => summary,
      }) as Promise<Response>
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Promise<Response>
  })
}

function renderDetail(seriesId: number = 1) {
  return render(
    <MemoryRouter
      initialEntries={[`/series/${seriesId}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/series/:id" element={<SeriesDetail />} />
        <Route
          path="/series"
          element={<div data-testid="series-list-page">Series List</div>}
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('SeriesDetail', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = mockFetch()
  })
  afterEach(() => fetchSpy.mockRestore())

  it('renders series title and books', async () => {
    renderDetail()
    await waitFor(() =>
      expect(screen.getByTestId('series-title')).toHaveTextContent(
        'Stormlight Archive'
      )
    )
    expect(await screen.findByText('The Way of Kings')).toBeInTheDocument()
    expect(await screen.findByText('Words of Radiance')).toBeInTheDocument()
  })

  it('shows reading order tabs', async () => {
    renderDetail()
    await waitFor(() => {
      expect(screen.getByTestId('reading-order-tab-10')).toBeInTheDocument()
      expect(screen.getByTestId('reading-order-tab-10')).toHaveTextContent(
        'Publication Order'
      )
    })
  })

  it('progress indicator shows when summaries loaded', async () => {
    fetchSpy.mockRestore()
    let callCount = 0
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      if (u.includes('/api/series/tree')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SERIES_TREE,
        }) as Promise<Response>
      }
      if (u.match(/\/api\/series\/\d+\/reading-orders/)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => READING_ORDERS,
        }) as Promise<Response>
      }
      if (u.match(/\/api\/series\/\d+\/books$/)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SERIES_BOOKS,
        }) as Promise<Response>
      }
      if (u.match(/\/api\/series\/\d+$/)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SERIES,
        }) as Promise<Response>
      }
      if (u.includes('/reading-summary')) {
        callCount++
        // first book: read, second: not read
        const pct = callCount === 1 ? 100 : 10
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            percent_finished: pct,
            total_time_seconds: 0,
            total_sessions: 0,
          }),
        }) as Promise<Response>
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as Promise<Response>
    })

    renderDetail()
    await waitFor(
      () => {
        expect(screen.getByTestId('progress-indicator')).toBeInTheDocument()
        expect(screen.getByTestId('progress-indicator')).toHaveTextContent(
          '1 of 2'
        )
      },
      { timeout: 3000 }
    )
  })

  it('edit series button opens modal', async () => {
    renderDetail()
    await waitFor(() => screen.getByTestId('series-title'))
    const editBtn = screen.getByRole('button', { name: /series settings/i })
    await userEvent.click(editBtn)
    expect(screen.getByTestId('series-modal')).toBeInTheDocument()
  })

  it('reading order tab switching shows different content', async () => {
    fetchSpy.mockRestore()
    const twoOrders = [
      {
        id: 10,
        name: 'Publication Order',
        series_id: 1,
        entries: [
          {
            id: 1,
            reading_order_id: 10,
            book_id: 'uuid1',
            position: 1,
            note: null,
          },
        ],
      },
      {
        id: 11,
        name: 'Chronological Order',
        series_id: 1,
        entries: [
          {
            id: 2,
            reading_order_id: 11,
            book_id: 'uuid2',
            position: 1,
            note: null,
          },
        ],
      },
    ]
    fetchSpy = mockFetch({ readingOrders: twoOrders })

    renderDetail()
    await waitFor(() => {
      expect(screen.getByTestId('reading-order-tab-10')).toBeInTheDocument()
      expect(screen.getByTestId('reading-order-tab-11')).toBeInTheDocument()
    })

    // Tab 10 is active by default (first tab), click tab 11
    await userEvent.click(screen.getByTestId('reading-order-tab-11'))
    // After switching, the active order tab-11 should be active
    expect(screen.getByTestId('reading-order-tab-11').className).toContain(
      'text-primary'
    )
  })
})
