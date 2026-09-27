import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import {
  QuickSearchProvider,
  useQuickSearch,
} from '../components/search/QuickSearch'

function OpenButton() {
  const { open } = useQuickSearch()
  return <button onClick={open}>open search</button>
}

function Where() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderSearch() {
  return render(
    <MemoryRouter
      initialEntries={['/']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <QuickSearchProvider>
        <OpenButton />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </QuickSearchProvider>
    </MemoryRouter>
  )
}

describe('QuickSearch', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      let body: unknown = []
      if (u.startsWith('/api/books?')) {
        body = {
          items: [
            {
              id: 'b1',
              title: 'Gardens of the Moon',
              author: 'Steven Erikson',
              cover_path: null,
            },
          ],
          total: 1,
          page: 1,
          per_page: 6,
          pages: 1,
        }
      } else if (u === '/api/series/tree') {
        body = [
          {
            id: 7,
            name: 'Malazan Book of the Fallen',
            book_count: 10,
            children: [],
          },
          { id: 8, name: 'Stormlight', book_count: 5, children: [] },
        ]
      } else if (u === '/api/serials') {
        body = [{ id: 3, title: 'Malazan Fan Serial', author: 'Someone' }]
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => body,
      }) as Promise<Response>
    })
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('opens with Ctrl+K and closes with Escape', async () => {
    renderSearch()
    expect(screen.queryByTestId('quick-search')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByTestId('quick-search')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('quick-search')).not.toBeInTheDocument()
  })

  it('groups matching books, series and serials', async () => {
    renderSearch()
    fireEvent.click(screen.getByText('open search'))
    fireEvent.change(screen.getByTestId('quick-search-input'), {
      target: { value: 'malazan' },
    })

    await waitFor(() =>
      expect(screen.getAllByTestId('quick-search-result')).toHaveLength(3)
    )
    expect(screen.getByText('Books')).toBeInTheDocument()
    expect(screen.getByText('Series')).toBeInTheDocument()
    expect(screen.getByText('Web Serials')).toBeInTheDocument()
    expect(screen.getByText('Malazan Book of the Fallen')).toBeInTheDocument()
    expect(screen.queryByText('Stormlight')).not.toBeInTheDocument()
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes('/api/books?search=malazan')
      )
    ).toBe(true)
  })

  it('navigates to the highlighted result with the keyboard', async () => {
    renderSearch()
    fireEvent.click(screen.getByText('open search'))
    const input = screen.getByTestId('quick-search-input')
    fireEvent.change(input, { target: { value: 'malazan' } })
    await waitFor(() =>
      expect(screen.getAllByTestId('quick-search-result')).toHaveLength(3)
    )

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByTestId('location')).toHaveTextContent('/series/7')
    expect(screen.queryByTestId('quick-search')).not.toBeInTheDocument()
  })
})
