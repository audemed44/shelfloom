import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ZLibraryModal from '../components/library/ZLibraryModal'
import { TestMemoryRouter } from '../test-utils/router'

const RESULT = {
  id: '17',
  hash: 'abc',
  title: 'Fake Book',
  author: 'Jane Doe',
  publisher: null,
  year: 2020,
  language: 'English',
  pages: 321,
  series: 'Saga',
  extension: 'epub',
  size: '1 MB',
  isbns: [],
  cover_url: null,
  description: null,
  in_library_book_id: null,
}

const BOOK = {
  id: 'b1',
  title: 'Fake Book',
  author: 'Jane Doe',
  format: 'epub',
  genres: [],
  tags: [],
}

describe('ZLibraryModal', () => {
  let fetchSpy: {
    mockRestore: () => void
    mock: { calls: [RequestInfo | URL, RequestInit | undefined][] }
  }
  let alreadyInLibrary = false

  beforeEach(() => {
    alreadyInLibrary = false
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      const u = url.toString()
      const method = (opts?.method ?? 'GET').toUpperCase()
      let body: unknown = []
      let status = 200
      if (u === '/api/zlibrary/status') {
        body = {
          enabled: true,
          domain: 'z-library.hn',
          downloads_today: 3,
          downloads_limit: 10,
          error: null,
        }
      } else if (u.startsWith('/api/zlibrary/search?')) {
        body = { results: [RESULT], page: 1, has_more: false }
      } else if (u === '/api/zlibrary/books' && method === 'POST') {
        status = 201
        body = {
          book: BOOK,
          already_in_library: alreadyInLibrary,
          series: 'Saga',
          series_sequence: '2',
        }
      } else if (u === '/api/books/b1') {
        body = BOOK
      } else if (u.startsWith('/api/series/4/books/b1') && method === 'POST') {
        status = 201
        body = {}
      } else if (u === '/api/series/tree') {
        body = [
          {
            id: 4,
            name: 'Saga',
            description: null,
            parent_id: null,
            parent_name: null,
            sort_order: 0,
            cover_path: null,
            book_count: 1,
            first_book_id: null,
            first_book_cover_path: null,
          },
        ]
      }
      return Promise.resolve({
        ok: true,
        status,
        json: async () => body,
      }) as Promise<Response>
    }) as unknown as typeof fetchSpy
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  const renderModal = (onAdded = vi.fn()) =>
    render(
      <TestMemoryRouter>
        <ZLibraryModal onClose={() => {}} onAdded={onAdded} />
      </TestMemoryRouter>
    )

  const searchFor = async (text: string) => {
    fireEvent.change(screen.getByTestId('zlibrary-search-input'), {
      target: { value: text },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByTestId('zlibrary-result')
  }

  it('shows the downloads left and searches with the chosen filters', async () => {
    renderModal()
    expect(
      await screen.findByText('7 of 10 downloads left today')
    ).toBeInTheDocument()
    await searchFor('fake book')
    const searchCall = fetchSpy.mock.calls.find(([u]) =>
      u.toString().startsWith('/api/zlibrary/search?')
    )
    expect(searchCall?.[0].toString()).toContain('q=fake+book')
    expect(searchCall?.[0].toString()).toContain('format=epub')
    expect(screen.getByText('Series: Saga')).toBeInTheDocument()
  })

  it('adds a book and opens the editor with its series picked', async () => {
    const onAdded = vi.fn()
    renderModal(onAdded)
    await searchFor('fake')
    fireEvent.click(screen.getByTestId('zlibrary-add'))

    expect(await screen.findByTestId('edit-book-modal')).toBeInTheDocument()
    expect(screen.getByText('Added — review details')).toBeInTheDocument()
    expect(await screen.findByText('✓ Saga selected')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2')).toBeInTheDocument()
    expect(onAdded).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() =>
      expect(screen.queryByTestId('edit-book-modal')).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('zlibrary-notice')).toHaveTextContent(
      'Added “Fake Book”.'
    )
  })

  it('saves the picked series with the book, without a separate ✓', async () => {
    renderModal()
    await searchFor('fake')
    fireEvent.click(screen.getByTestId('zlibrary-add'))
    expect(await screen.findByText('✓ Saga selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(screen.queryByTestId('edit-book-modal')).not.toBeInTheDocument()
    )
    const calls = fetchSpy.mock.calls.map(
      ([u, o]) => `${(o?.method ?? 'GET').toUpperCase()} ${u}`
    )
    const add = calls.indexOf('POST /api/series/4/books/b1?sequence=2')
    expect(add).toBeGreaterThan(-1)
    expect(add).toBeLessThan(calls.indexOf('PATCH /api/books/b1'))
  })

  it('says when the book is already in the library', async () => {
    alreadyInLibrary = true
    renderModal()
    await searchFor('fake')
    fireEvent.click(screen.getByTestId('zlibrary-add'))
    expect(await screen.findByTestId('zlibrary-notice')).toHaveTextContent(
      '“Fake Book” is already in your library.'
    )
    expect(screen.queryByTestId('edit-book-modal')).not.toBeInTheDocument()
  })
})
