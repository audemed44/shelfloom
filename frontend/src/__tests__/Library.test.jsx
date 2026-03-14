import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Library from '../pages/Library'

const MOCK_SHELVES = [
  { id: 'shelf-1', name: 'Main Library', book_count: 3 },
]

const MOCK_BOOKS = [
  { id: 'b1', title: 'Dune', author: 'Frank Herbert', format: 'epub', page_count: 412 },
  { id: 'b2', title: 'Foundation', author: 'Isaac Asimov', format: 'epub', page_count: 255 },
  { id: 'b3', title: 'Neuromancer', author: 'William Gibson', format: 'pdf', page_count: 271 },
]

function mockFetch({ books = MOCK_BOOKS, total = MOCK_BOOKS.length, shelves = MOCK_SHELVES } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.includes('/api/shelves')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => shelves })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ items: books, total, page: 1, per_page: 24 }),
    })
  })
}

function renderLibrary() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Library />
    </MemoryRouter>
  )
}

describe('Library', () => {
  let fetchSpy

  beforeEach(() => { fetchSpy = mockFetch() })
  afterEach(() => fetchSpy.mockRestore())

  it('renders the library heading', () => {
    renderLibrary()
    expect(screen.getByRole('heading', { name: /library/i })).toBeInTheDocument()
  })

  it('shows loading skeletons while fetching', () => {
    // Don't resolve fetch — stay in loading state
    fetchSpy.mockReturnValue(new Promise(() => {}))
    renderLibrary()
    expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThan(0)
  })

  it('renders the correct number of book cards', async () => {
    renderLibrary()
    await waitFor(() => expect(screen.getAllByTestId('book-card')).toHaveLength(3))
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
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument())
  })

  it('shows empty state when search has no results', async () => {
    fetchSpy.mockRestore()
    mockFetch({ books: [], total: 0 })
    renderLibrary()
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument())
  })

  it('switches to list view when list toggle is clicked', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => expect(screen.getAllByTestId('book-card')).toHaveLength(3))

    await user.click(screen.getByLabelText('List view'))
    await waitFor(() => expect(screen.getAllByTestId('book-row')).toHaveLength(3))
    expect(screen.queryByTestId('book-card')).not.toBeInTheDocument()
  })

  it('switches back to grid view from list', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getAllByTestId('book-card'))

    await user.click(screen.getByLabelText('List view'))
    await user.click(screen.getByLabelText('Grid view'))
    await waitFor(() => expect(screen.getAllByTestId('book-card')).toHaveLength(3))
  })

  it('renders shelf tabs when shelves exist', async () => {
    renderLibrary()
    await waitFor(() => expect(screen.getByText('Main Library')).toBeInTheDocument())
    expect(screen.getByText('All')).toBeInTheDocument()
  })

  it('passes shelf_id param when shelf tab is selected', async () => {
    const user = userEvent.setup()
    renderLibrary()
    await waitFor(() => screen.getByText('Main Library'))
    await user.click(screen.getByText('Main Library'))

    await waitFor(() => {
      const booksCall = fetchSpy.mock.calls.find(
        ([url]) => url.includes('/api/books') && url.includes('shelf_id=shelf-1')
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
        ([url]) => url.includes('/api/books') && url.includes('sort=title')
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
    await waitFor(() => expect(screen.getByLabelText('Next page')).toBeInTheDocument())
  })
})
