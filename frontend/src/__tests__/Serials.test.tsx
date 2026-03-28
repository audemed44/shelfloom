import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Serials from '../pages/Serials'

const SERIALS: object[] = [
  {
    id: 1,
    url: 'https://royalroad.com/fiction/1/test',
    source: 'royalroad',
    title: 'The Grand Adventure',
    author: 'Author One',
    description: null,
    cover_path: null,
    cover_url: null,
    status: 'ongoing',
    total_chapters: 120,
    live_chapter_count: 120,
    stubbed_chapter_count: 0,
    last_checked_at: null,
    last_error: null,
    created_at: '2026-01-01T00:00:00',
    series_id: null,
  },
  {
    id: 2,
    url: 'https://royalroad.com/fiction/2/finished',
    source: 'royalroad',
    title: 'Finished Story',
    author: 'Author Two',
    description: null,
    cover_path: null,
    cover_url: null,
    status: 'completed',
    total_chapters: 200,
    live_chapter_count: 200,
    stubbed_chapter_count: 0,
    last_checked_at: null,
    last_error: null,
    created_at: '2026-01-02T00:00:00',
    series_id: null,
  },
]

const SHELVES = [
  { id: 1, name: 'Library', path: '/shelves/library', is_default: true },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockFetch(overrides: Record<string, any> = {}): any {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
    const u = url.toString()
    const method =
      (opts as RequestInit | undefined)?.method?.toUpperCase() ?? 'GET'

    if (u.includes('/api/serials/adapters') && method === 'GET') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [
          'royalroad',
          'wordpress-generic',
          'sequential-next-link',
        ],
      }) as Promise<Response>
    }
    if (u.includes('/api/serials/detect-adapter') && method === 'GET') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ adapter: 'royalroad' }),
      }) as Promise<Response>
    }
    if (u.includes('/api/serials') && method === 'GET') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.serials ?? SERIALS,
      }) as Promise<Response>
    }
    if (u.includes('/api/serials') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => overrides.created ?? SERIALS[0],
      }) as Promise<Response>
    }
    if (u.includes('/api/shelves')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.shelves ?? SHELVES,
      }) as Promise<Response>
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Promise<Response>
  })
}

function renderSerials() {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Serials />
    </MemoryRouter>
  )
}

describe('Serials page', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = mockFetch()
  })
  afterEach(() => fetchSpy.mockRestore())

  it('renders serial cards', async () => {
    renderSerials()
    await waitFor(() =>
      expect(screen.getByText('The Grand Adventure')).toBeInTheDocument()
    )
    expect(screen.getByText('Finished Story')).toBeInTheDocument()
  })

  it('shows chapter counts on cards', async () => {
    renderSerials()
    await waitFor(() =>
      expect(screen.getByText('The Grand Adventure')).toBeInTheDocument()
    )
    expect(screen.getByText('120 ch')).toBeInTheDocument()
    expect(screen.getByText('200 ch')).toBeInTheDocument()
  })

  it('shows author names', async () => {
    renderSerials()
    await waitFor(() =>
      expect(screen.getByText('Author One')).toBeInTheDocument()
    )
    expect(screen.getByText('Author Two')).toBeInTheDocument()
  })

  it('renders status filter tabs', async () => {
    renderSerials()
    await waitFor(() =>
      expect(screen.getByTestId('status-filter-tabs')).toBeInTheDocument()
    )
    expect(screen.getByTestId('filter-all')).toBeInTheDocument()
    expect(screen.getByTestId('filter-ongoing')).toBeInTheDocument()
    expect(screen.getByTestId('filter-completed')).toBeInTheDocument()
  })

  it('filters by status', async () => {
    renderSerials()
    await waitFor(() =>
      expect(screen.getByText('The Grand Adventure')).toBeInTheDocument()
    )
    await userEvent.click(screen.getByTestId('filter-completed'))
    expect(screen.queryByText('The Grand Adventure')).not.toBeInTheDocument()
    expect(screen.getByText('Finished Story')).toBeInTheDocument()
  })

  it('shows empty state when filter has no results', async () => {
    renderSerials()
    await waitFor(() =>
      expect(screen.getByText('The Grand Adventure')).toBeInTheDocument()
    )
    await userEvent.click(screen.getByTestId('filter-error'))
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByText(/No error serials/)).toBeInTheDocument()
  })

  it('shows empty state with no serials', async () => {
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({ serials: [] })
    renderSerials()
    await waitFor(() =>
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    )
    expect(screen.getByText(/No serials yet/)).toBeInTheDocument()
  })

  it('opens AddSerialModal on button click', async () => {
    renderSerials()
    await waitFor(() => screen.getByTestId('add-serial-btn'))
    await userEvent.click(screen.getByTestId('add-serial-btn'))
    expect(screen.getByTestId('add-serial-modal')).toBeInTheDocument()
  })

  it('closes AddSerialModal on backdrop click', async () => {
    renderSerials()
    await waitFor(() => screen.getByTestId('add-serial-btn'))
    await userEvent.click(screen.getByTestId('add-serial-btn'))
    expect(screen.getByTestId('add-serial-modal')).toBeInTheDocument()

    // Click backdrop
    const backdrop = screen.getByTestId('add-serial-modal')
    await userEvent.click(backdrop)
    expect(screen.queryByTestId('add-serial-modal')).not.toBeInTheDocument()
  })

  it('submits new serial and refreshes list', async () => {
    renderSerials()
    await waitFor(() => screen.getByTestId('add-serial-btn'))
    await userEvent.click(screen.getByTestId('add-serial-btn'))

    const input = screen.getByPlaceholderText(/https:\/\/www\.royalroad\.com/)
    await userEvent.type(input, 'https://royalroad.com/fiction/3/new')
    await userEvent.click(screen.getByTestId('add-serial-submit'))

    await waitFor(() =>
      expect(screen.queryByTestId('add-serial-modal')).not.toBeInTheDocument()
    )
  })

  it('shows error when POST fails', async () => {
    fetchSpy.mockRestore()
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      const u = url.toString()
      const method =
        (opts as RequestInit | undefined)?.method?.toUpperCase() ?? 'GET'
      if (u.includes('/api/serials') && method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: async () => ({ detail: 'No adapter for that URL' }),
        }) as Promise<Response>
      }
      if (u.includes('/api/serials') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        }) as Promise<Response>
      }
      if (u.includes('/api/shelves')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SHELVES,
        }) as Promise<Response>
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as Promise<Response>
    })

    renderSerials()
    await waitFor(() => screen.getByTestId('add-serial-btn'))
    await userEvent.click(screen.getByTestId('add-serial-btn'))

    const input = screen.getByPlaceholderText(/https:\/\/www\.royalroad\.com/)
    await userEvent.type(input, 'https://example.com/unsupported')
    await userEvent.click(screen.getByTestId('add-serial-submit'))

    await waitFor(() =>
      expect(screen.getByText('No adapter for that URL')).toBeInTheDocument()
    )
  })

  it('shows serial count in header', async () => {
    renderSerials()
    await waitFor(() =>
      expect(screen.getByText('2 serials tracked')).toBeInTheDocument()
    )
  })

  it('serial cards link to detail page', async () => {
    renderSerials()
    await waitFor(() =>
      expect(screen.getByTestId('serial-card-1')).toBeInTheDocument()
    )
    const card = screen.getByTestId('serial-card-1')
    expect(card).toHaveAttribute('href', '/serials/1')
  })

  it('serial cards prefer the uploaded cover when both cover fields exist', async () => {
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({
      serials: [
        {
          ...SERIALS[0],
          cover_path: '/data/covers/serial_1.jpg',
          cover_url: 'https://example.com/remote-cover.jpg',
        },
      ],
    })
    renderSerials()
    await waitFor(() =>
      expect(screen.getByTestId('serial-card-1')).toBeInTheDocument()
    )
    const cover = screen.getByAltText('The Grand Adventure')
    expect(cover.getAttribute('src')).toContain('/api/serials/1/cover')
    expect(cover.getAttribute('src')).toContain('cover=')
  })

  it('serial cards fall back to cover_url when there is no uploaded cover', async () => {
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({
      serials: [
        {
          ...SERIALS[0],
          cover_path: null,
          cover_url: 'https://example.com/remote-cover.jpg',
        },
      ],
    })
    renderSerials()
    await waitFor(() =>
      expect(screen.getByTestId('serial-card-1')).toBeInTheDocument()
    )
    const cover = screen.getByAltText('The Grand Adventure')
    expect(cover.getAttribute('src')).toBe(
      'https://example.com/remote-cover.jpg'
    )
  })
})

// ---------------------------------------------------------------------------
// EditSerialModal
// ---------------------------------------------------------------------------

import EditSerialModal from '../components/serials/EditSerialModal'
import type { WebSerial } from '../types/api'

const SERIAL_FIXTURE: WebSerial = {
  id: 1,
  url: 'https://royalroad.com/fiction/1/test',
  source: 'royalroad',
  title: 'Test Serial',
  author: 'Author',
  description: 'A description',
  cover_path: null,
  cover_url: null,
  status: 'ongoing',
  total_chapters: 100,
  live_chapter_count: 100,
  stubbed_chapter_count: 0,
  last_checked_at: null,
  last_error: null,
  created_at: '2026-01-01T00:00:00',
  series_id: null,
}

describe('EditSerialModal', () => {
  it('renders with serial data', () => {
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <EditSerialModal
          serial={SERIAL_FIXTURE}
          onClose={() => {}}
          onSaved={() => {}}
        />
      </MemoryRouter>
    )
    expect(screen.getByTestId('edit-serial-modal')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test Serial')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Author')).toBeInTheDocument()
    expect(screen.getByDisplayValue('A description')).toBeInTheDocument()
  })

  it('submits PATCH on save', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ...SERIAL_FIXTURE, title: 'Updated' }),
        }) as Promise<Response>
    )
    const onSaved = vi.fn()
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <EditSerialModal
          serial={SERIAL_FIXTURE}
          onClose={() => {}}
          onSaved={onSaved}
        />
      </MemoryRouter>
    )

    await userEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    // Verify PATCH was called
    const patchCall = fetchSpy.mock.calls.find(
      (c) => (c[1] as RequestInit)?.method === 'PATCH'
    )
    expect(patchCall).toBeTruthy()
    fetchSpy.mockRestore()
  })

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <EditSerialModal
          serial={SERIAL_FIXTURE}
          onClose={onClose}
          onSaved={() => {}}
        />
      </MemoryRouter>
    )
    await userEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })
})
