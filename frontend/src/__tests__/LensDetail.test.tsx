import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Routes, Route } from 'react-router-dom'
import LensDetail from '../pages/LensDetail'
import { TestMemoryRouter } from '../test-utils/router'

const MOCK_LENS = {
  id: 1,
  name: 'Fantasy Reads',
  book_count: 2,
  cover_book_id: null,
  cover_book_path: null,
  filter_state: {
    genres: [1],
    tags: [3],
    series_ids: [],
    authors: [],
    formats: ['epub'],
    has_genre: null,
    has_tag: null,
    has_author: null,
    has_series: null,
    mode: 'and',
    shelf_id: null,
    status: 'reading',
  },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const MOCK_BOOKS = {
  items: [
    {
      id: 1,
      title: 'The Name of the Wind',
      author: 'Patrick Rothfuss',
      format: 'epub',
      page_count: 662,
      shelf_id: 1,
      shelf_name: 'Main',
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
  ],
  total: 1,
  page: 1,
  per_page: 25,
  pages: 1,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let savedFetch: any

beforeEach(() => {
  savedFetch = globalThis.fetch
  globalThis.fetch = vi.fn((url: string | URL | Request) => {
    const u = url.toString()
    if (u.includes('/api/lenses/1/books')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => MOCK_BOOKS,
      })
    }
    if (u.includes('/api/lenses/1')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => MOCK_LENS,
      })
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => null })
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = savedFetch
})

function renderDetail(id = '1') {
  return render(
    <TestMemoryRouter initialEntries={[`/lenses/${id}`]}>
      <Routes>
        <Route path="/lenses/:id" element={<LensDetail />} />
      </Routes>
    </TestMemoryRouter>
  )
}

describe('LensDetail', () => {
  it('renders lens name as header', async () => {
    renderDetail()
    expect(await screen.findByText('Fantasy Reads')).toBeInTheDocument()
  })

  it('renders filter summary with active filters', async () => {
    renderDetail()
    await screen.findByText('Fantasy Reads')
    // genres + tags + formats + status
    expect(screen.getByText(/1 genre/)).toBeInTheDocument()
    expect(screen.getByText(/1 tag/)).toBeInTheDocument()
    expect(screen.getByText(/EPUB/)).toBeInTheDocument()
    expect(screen.getByText(/status: reading/)).toBeInTheDocument()
  })

  it('renders books from the lens', async () => {
    renderDetail()
    expect(await screen.findByText('The Name of the Wind')).toBeInTheDocument()
  })

  it('renders edit and delete buttons', async () => {
    renderDetail()
    await screen.findByText('Fantasy Reads')
    expect(screen.getByTestId('lens-edit-btn')).toBeInTheDocument()
    expect(screen.getByTestId('lens-delete-btn')).toBeInTheDocument()
  })

  it('opens edit modal when edit button is clicked', async () => {
    const user = userEvent.setup()
    renderDetail()

    await screen.findByText('Fantasy Reads')
    await user.click(screen.getByTestId('lens-edit-btn'))
    expect(screen.getByTestId('save-lens-modal')).toBeInTheDocument()
  })

  it('shows 404 message for non-existent lens', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404, json: async () => null })
    ) as unknown as typeof fetch

    renderDetail('999')
    expect(await screen.findByText('Lens not found')).toBeInTheDocument()
  })

  it('renders group-by-series toggle and requests grouped books when enabled', async () => {
    const groupedBooks = {
      items: [
        {
          ...MOCK_BOOKS.items[0],
          id: 10,
          title: 'The Final Empire',
          series_id: 9,
          series_name: 'Mistborn',
          series_sequence: 1,
        },
        {
          ...MOCK_BOOKS.items[0],
          id: 11,
          title: 'The Well of Ascension',
          series_id: 9,
          series_name: 'Mistborn',
          series_sequence: 2,
        },
      ],
      total: 2,
      page: 1,
      per_page: 25,
      pages: 1,
    }

    globalThis.fetch = vi.fn((url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/api/lenses/1/books')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => groupedBooks,
        })
      }
      if (u.includes('/api/lenses/1')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_LENS,
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => null })
    }) as unknown as typeof fetch

    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Fantasy Reads')

    await user.click(screen.getByTestId('group-by-series-toggle'))

    await waitFor(() => {
      expect(
        vi
          .mocked(globalThis.fetch)
          .mock.calls.some(([url]) =>
            url.toString().includes('group_by_series=true')
          )
      ).toBe(true)
    })
    expect(await screen.findByTestId('series-card')).toBeInTheDocument()
  })
})
