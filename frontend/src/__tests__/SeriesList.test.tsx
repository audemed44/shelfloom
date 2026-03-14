import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SeriesList from '../pages/SeriesList'

const SERIES_TREE = [
  { id: 1, name: 'Cosmere', parent_id: null, book_count: 0, description: null, sort_order: 0, cover_path: null },
  { id: 2, name: 'Stormlight Archive', parent_id: 1, book_count: 7, description: null, sort_order: 0, cover_path: null },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockFetch(overrides: Record<string, any> = {}): any {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
    const u = url.toString()
    const method = (opts as RequestInit | undefined)?.method?.toUpperCase() ?? 'GET'

    if (u.includes('/api/series/tree')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => overrides.tree ?? SERIES_TREE,
      }) as Promise<Response>
    }
    if (u.includes('/api/series/empty') && method === 'DELETE') {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => overrides.purge ?? { deleted: [], count: 0 },
      }) as Promise<Response>
    }
    if (u.match(/\/api\/series\/\d+$/) && method === 'DELETE') {
      return Promise.resolve({ ok: true, status: 204, json: async () => ({}) }) as Promise<Response>
    }
    if (u.includes('/api/series') && method === 'POST') {
      return Promise.resolve({
        ok: true, status: 201,
        json: async () => ({ id: 99, name: 'New', parent_id: null, description: null, sort_order: 0, cover_path: null }),
      }) as Promise<Response>
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }) as Promise<Response>
  })
}

function renderList() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SeriesList />
    </MemoryRouter>
  )
}

describe('SeriesList', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => { fetchSpy = mockFetch() })
  afterEach(() => fetchSpy.mockRestore())

  it('renders series tree', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('Cosmere')).toBeInTheDocument())
    expect(screen.getByText('Stormlight Archive')).toBeInTheDocument()
  })

  it('create series button opens modal', async () => {
    renderList()
    await waitFor(() => screen.getByTestId('new-series-btn'))
    await userEvent.click(screen.getByTestId('new-series-btn'))
    expect(screen.getByTestId('series-modal')).toBeInTheDocument()
  })

  it('purge empty series calls API and shows result', async () => {
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({ purge: { deleted: ['Old Series'], count: 1 } })
    renderList()
    await waitFor(() => screen.getByTestId('purge-btn'))
    await userEvent.click(screen.getByTestId('purge-btn'))
    await waitFor(() => expect(screen.getByTestId('purge-result')).toBeInTheDocument())
    expect(screen.getByTestId('purge-result')).toHaveTextContent('Old Series')
  })

  it('delete series calls API', async () => {
    renderList()
    await waitFor(() => screen.getByTestId('series-row-1'))
    // stub confirm
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deleteBtn = screen.getByTestId('series-row-1').querySelector('[aria-label^="Delete"]')
    expect(deleteBtn).not.toBeNull()
    await userEvent.click(deleteBtn!)
    const calls = (fetchSpy as ReturnType<typeof vi.spyOn>).mock.calls
    const deleteCall = calls.find(([url, opts]: [string, RequestInit]) =>
      url.toString().includes('/api/series/1') && (opts?.method ?? 'GET').toUpperCase() === 'DELETE'
    )
    expect(deleteCall).toBeDefined()
  })

  it('purge with no empty series shows message', async () => {
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({ purge: { deleted: [], count: 0 } })
    renderList()
    await waitFor(() => screen.getByTestId('purge-btn'))
    await userEvent.click(screen.getByTestId('purge-btn'))
    await waitFor(() => expect(screen.getByTestId('purge-result')).toBeInTheDocument())
    expect(screen.getByTestId('purge-result')).toHaveTextContent('No empty series found')
  })
})
