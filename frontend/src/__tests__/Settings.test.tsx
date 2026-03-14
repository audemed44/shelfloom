import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Settings from '../pages/Settings'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SHELVES = [
  {
    id: 1,
    name: 'Main Library',
    path: '/shelves/library',
    is_default: true,
    is_sync_target: false,
    device_name: null,
    auto_organize: false,
    created_at: '2026-01-01T00:00:00Z',
    book_count: 42,
  },
  {
    id: 2,
    name: 'KOReader Sync',
    path: '/shelves/kobo',
    is_default: false,
    is_sync_target: true,
    device_name: 'Kobo Clara',
    auto_organize: false,
    created_at: '2026-01-02T00:00:00Z',
    book_count: 7,
  },
]

const SCAN_STATUS_IDLE = {
  is_running: false,
  last_scan_at: '2026-03-14T10:00:00Z',
  progress: null,
  error: null,
}

const SCAN_STATUS_RUNNING = {
  is_running: true,
  last_scan_at: null,
  progress: {
    total: 100,
    processed: 40,
    created: 5,
    updated: 2,
    skipped: 33,
    errors: 0,
  },
  error: null,
}

const PREVIEW_RESULTS = [
  {
    book_id: 'uuid-1',
    book_title: 'The Way of Kings',
    old_path: '/shelves/library/way-of-kings.epub',
    new_path:
      '/shelves/library/Brandon Sanderson/Stormlight Archive/01 - The Way of Kings.epub',
    moved: false,
    already_correct: false,
    error: null,
  },
  {
    book_id: 'uuid-2',
    book_title: 'Already Correct',
    old_path: '/shelves/library/correct.epub',
    new_path: '/shelves/library/correct.epub',
    moved: false,
    already_correct: true,
    error: null,
  },
]

// ── Mock fetch ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockFetch(overrides: Record<string, any> = {}): any {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
    const u = url.toString()
    const method =
      (opts as RequestInit | undefined)?.method?.toUpperCase() ?? 'GET'

    if (u.includes('/api/shelves') && method === 'GET') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.shelves ?? SHELVES,
      }) as Promise<Response>
    }
    if (u.includes('/api/shelves') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({
          id: 99,
          name: 'New',
          path: '/shelves/new',
          is_default: false,
          is_sync_target: false,
          device_name: null,
          auto_organize: false,
          created_at: '2026-01-01T00:00:00Z',
          book_count: 0,
        }),
      }) as Promise<Response>
    }
    if (u.match(/\/api\/shelves\/\d+$/) && method === 'DELETE') {
      return Promise.resolve({
        ok: true,
        status: 204,
        json: async () => null,
      }) as Promise<Response>
    }
    if (u.match(/\/api\/shelves\/\d+$/) && method === 'PATCH') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => SHELVES[0],
      }) as Promise<Response>
    }
    if (u.includes('/api/import/status')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.scanStatus ?? SCAN_STATUS_IDLE,
      }) as Promise<Response>
    }
    if (u.includes('/api/import/scan') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 202,
        json: async () => null,
      }) as Promise<Response>
    }
    if (u.includes('/api/import/backfill-covers') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          overrides.backfill ?? { refreshed: 3, failed: 0, skipped: 5 },
      }) as Promise<Response>
    }
    if (u.includes('/api/organize/preview')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.preview ?? PREVIEW_RESULTS,
      }) as Promise<Response>
    }
    if (u.includes('/api/organize/apply') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          overrides.apply ?? [
            { ...PREVIEW_RESULTS[0], moved: true, already_correct: false },
          ],
      }) as Promise<Response>
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Promise<Response>
  })
}

function renderSettings() {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Settings />
    </MemoryRouter>
  )
}

describe('Settings', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = mockFetch()
  })
  afterEach(() => {
    fetchSpy.mockRestore()
    vi.restoreAllMocks()
  })

  // ── Shelves ──

  it('renders shelf list', async () => {
    renderSettings()
    await waitFor(() =>
      expect(screen.getByTestId('shelf-card-1')).toBeInTheDocument()
    )
    expect(screen.getByTestId('shelf-card-2')).toBeInTheDocument()
  })

  it('shows Default badge on default shelf', async () => {
    renderSettings()
    await waitFor(() => screen.getByTestId('shelf-card-1'))
    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('shows sync badge on sync shelf', async () => {
    renderSettings()
    await waitFor(() => screen.getByTestId('shelf-card-2'))
    expect(screen.getByText('Sync')).toBeInTheDocument()
  })

  it('add shelf button opens modal', async () => {
    renderSettings()
    await waitFor(() => screen.getByTestId('add-shelf-btn'))
    await userEvent.click(screen.getByTestId('add-shelf-btn'))
    expect(screen.getByTestId('shelf-modal')).toBeInTheDocument()
  })

  it('edit shelf button opens modal', async () => {
    renderSettings()
    await waitFor(() => screen.getByTestId('shelf-card-1'))
    const editBtn = screen
      .getByTestId('shelf-card-1')
      .querySelector('[aria-label^="Edit"]')
    expect(editBtn).not.toBeNull()
    await userEvent.click(editBtn!)
    expect(screen.getByTestId('shelf-modal')).toBeInTheDocument()
  })

  it('delete shelf calls API with confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSettings()
    await waitFor(() => screen.getByTestId('shelf-card-1'))
    const deleteBtn = screen
      .getByTestId('shelf-card-1')
      .querySelector('[aria-label^="Delete"]')
    expect(deleteBtn).not.toBeNull()
    await userEvent.click(deleteBtn!)
    const calls = fetchSpy.mock.calls
    const deleteCall = calls.find(
      ([url, opts]: [string, RequestInit]) =>
        url.toString().includes('/api/shelves/1') &&
        (opts?.method ?? 'GET').toUpperCase() === 'DELETE'
    )
    expect(deleteCall).toBeDefined()
  })

  it('cancels delete when confirm is false', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderSettings()
    await waitFor(() => screen.getByTestId('shelf-card-1'))
    const deleteBtn = screen
      .getByTestId('shelf-card-1')
      .querySelector('[aria-label^="Delete"]')!
    await userEvent.click(deleteBtn)
    const calls = fetchSpy.mock.calls
    const deleteCall = calls.find(
      ([url, opts]: [string, RequestInit]) =>
        url.toString().includes('/api/shelves/1') &&
        (opts?.method ?? 'GET').toUpperCase() === 'DELETE'
    )
    expect(deleteCall).toBeUndefined()
  })

  // ── Template preview ──

  it('shows example path in live preview', async () => {
    renderSettings()
    await waitFor(() => screen.getByTestId('example-path'))
    const examplePath = screen.getByTestId('example-path')
    expect(examplePath.textContent).toContain('Brandon Sanderson')
    expect(examplePath.textContent).toContain('.epub')
  })

  it('preview button calls dry-run API', async () => {
    renderSettings()
    await waitFor(() => screen.getByTestId('preview-btn'))
    await userEvent.click(screen.getByTestId('preview-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('organizer-results')).toBeInTheDocument()
    )
    expect(screen.getByText('1 would move')).toBeInTheDocument()
  })

  it('apply button appears after preview and calls API on confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSettings()
    await waitFor(() => screen.getByTestId('preview-btn'))
    await userEvent.click(screen.getByTestId('preview-btn'))
    await waitFor(() => screen.getByTestId('apply-btn'))
    await userEvent.click(screen.getByTestId('apply-btn'))
    await waitFor(() => {
      const calls = fetchSpy.mock.calls
      const applyCall = calls.find(
        ([url, opts]: [string, RequestInit]) =>
          url.toString().includes('/api/organize/apply') &&
          (opts?.method ?? 'GET').toUpperCase() === 'POST'
      )
      expect(applyCall).toBeDefined()
    })
  })

  // ── Scan ──

  it('shows scan status', async () => {
    renderSettings()
    await waitFor(() =>
      expect(screen.getByTestId('scan-status')).toBeInTheDocument()
    )
    expect(screen.getByTestId('scan-status')).toHaveTextContent('Idle')
  })

  it('scan trigger button calls API', async () => {
    renderSettings()
    await waitFor(() => screen.getByTestId('scan-btn'))
    await userEvent.click(screen.getByTestId('scan-btn'))
    await waitFor(() => {
      const calls = fetchSpy.mock.calls
      const scanCall = calls.find(
        ([url, opts]: [string, RequestInit]) =>
          url.toString().includes('/api/import/scan') &&
          (opts?.method ?? 'GET').toUpperCase() === 'POST'
      )
      expect(scanCall).toBeDefined()
    })
  })

  it('shows progress bar when scan is running', async () => {
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({ scanStatus: SCAN_STATUS_RUNNING })
    renderSettings()
    await waitFor(() =>
      expect(screen.getByTestId('scan-progress')).toBeInTheDocument()
    )
    expect(screen.getByText('40 / 100 files')).toBeInTheDocument()
  })

  // ── Backfill covers ──

  it('backfill covers button calls API and shows result', async () => {
    renderSettings()
    await waitFor(() => screen.getByTestId('backfill-covers-btn'))
    await userEvent.click(screen.getByTestId('backfill-covers-btn'))
    await waitFor(() => {
      const calls = fetchSpy.mock.calls
      const backfillCall = calls.find(
        ([url, opts]: [string, RequestInit]) =>
          url.toString().includes('/api/import/backfill-covers') &&
          (opts?.method ?? 'GET').toUpperCase() === 'POST'
      )
      expect(backfillCall).toBeDefined()
    })
    await waitFor(() =>
      expect(screen.getByText(/3 refreshed/i)).toBeInTheDocument()
    )
  })
})
