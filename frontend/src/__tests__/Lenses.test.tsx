import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Lenses from '../pages/Lenses'
import { TestMemoryRouter } from '../test-utils/router'

const MOCK_LENSES = [
  {
    id: 1,
    name: 'Fantasy Reads',
    book_count: 12,
    cover_book_id: 'abc123',
    filter_state: {
      genres: [1],
      tags: [],
      series_ids: [],
      authors: [],
      formats: [],
      mode: 'and',
      shelf_id: null,
      status: null,
    },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 2,
    name: 'Unread Sci-Fi',
    book_count: 5,
    cover_book_id: null,
    filter_state: {
      genres: [2],
      tags: [],
      series_ids: [],
      authors: [],
      formats: [],
      mode: 'and',
      shelf_id: null,
      status: 'unread',
    },
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let savedFetch: any

beforeEach(() => {
  savedFetch = globalThis.fetch
  globalThis.fetch = vi.fn((url: string | URL | Request) => {
    const u = url.toString()
    if (u.includes('/api/lenses')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => MOCK_LENSES,
      })
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => [] })
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = savedFetch
})

function renderLenses() {
  return render(
    <TestMemoryRouter>
      <Lenses />
    </TestMemoryRouter>
  )
}

describe('Lenses', () => {
  it('renders lens cards with name and book count', async () => {
    renderLenses()

    expect(await screen.findByText('Fantasy Reads')).toBeInTheDocument()
    expect(screen.getByText('12 books')).toBeInTheDocument()
    expect(screen.getByText('Unread Sci-Fi')).toBeInTheDocument()
    expect(screen.getByText('5 books')).toBeInTheDocument()
  })

  it('renders a card for each lens', async () => {
    renderLenses()

    await screen.findByText('Fantasy Reads')
    const cards = screen.getAllByTestId('lens-card')
    expect(cards).toHaveLength(2)
  })

  it('shows empty state when no lenses exist', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => [] })
    ) as unknown as typeof fetch

    renderLenses()

    expect(await screen.findByTestId('lenses-empty')).toBeInTheDocument()
    expect(screen.getByText('No Lenses Yet')).toBeInTheDocument()
  })

  it('renders the New Lens button', async () => {
    renderLenses()

    await screen.findByText('Fantasy Reads')
    expect(screen.getByTestId('new-lens-btn')).toBeInTheDocument()
  })

  it('opens edit modal when edit is selected from card menu', async () => {
    const user = userEvent.setup()
    renderLenses()

    await screen.findByText('Fantasy Reads')
    const menuBtns = screen.getAllByTestId('lens-card-menu')
    await user.click(menuBtns[0])

    await user.click(screen.getByTestId('lens-card-edit'))
    expect(screen.getByTestId('save-lens-modal')).toBeInTheDocument()
  })

  it('calls delete API when delete is confirmed', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('confirm', () => true)
    renderLenses()

    await screen.findByText('Fantasy Reads')
    const menuBtns = screen.getAllByTestId('lens-card-menu')
    await user.click(menuBtns[0])
    await user.click(screen.getByTestId('lens-card-delete'))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/lenses/1'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    vi.unstubAllGlobals()
  })
})
