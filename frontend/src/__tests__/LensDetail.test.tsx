import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LensDetail from '../pages/LensDetail'

const MOCK_LENS = {
  id: 1,
  name: 'Fantasy Reads',
  book_count: 2,
  cover_book_id: null,
  filter_state: {
    genres: [1],
    tags: [3],
    seriesIds: [],
    authors: [],
    formats: ['epub'],
    mode: 'and',
    shelfId: null,
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
  per_page: 24,
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
    <MemoryRouter initialEntries={[`/lenses/${id}`]}>
      <Routes>
        <Route path="/lenses/:id" element={<LensDetail />} />
      </Routes>
    </MemoryRouter>
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
    const { default: userEvent } = await import('@testing-library/user-event')
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
})
