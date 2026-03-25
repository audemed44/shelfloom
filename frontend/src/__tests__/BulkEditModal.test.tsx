import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BulkEditModal from '../components/library/BulkEditModal'
import type { Shelf } from '../types/api'

const SHELVES: Shelf[] = [
  {
    id: 1,
    name: 'Library',
    path: '/shelves/library',
    is_default: true,
    is_sync_target: false,
    device_name: null,
    koreader_stats_db_path: null,
    auto_organize: false,
    created_at: '2024-01-01T00:00:00',
    book_count: 10,
    organize_template: null,
    seq_pad: 0,
  },
  {
    id: 2,
    name: 'Archive',
    path: '/shelves/archive',
    is_default: false,
    is_sync_target: false,
    device_name: null,
    koreader_stats_db_path: null,
    auto_organize: false,
    created_at: '2024-01-01T00:00:00',
    book_count: 5,
    organize_template: null,
    seq_pad: 0,
  },
]

function mockFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.includes('/api/genres')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ id: 1, name: 'Fantasy' }],
      }) as Promise<Response>
    }
    if (u.includes('/api/tags')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ id: 1, name: 'Favorites' }],
      }) as Promise<Response>
    }
    if (u.includes('/api/books/bulk-metadata')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { book_id: 'b1', success: true, error: null },
            { book_id: 'b2', success: true, error: null },
          ],
          total: 2,
          succeeded: 2,
          failed: 0,
        }),
      }) as Promise<Response>
    }
    if (u.includes('/api/books/bulk-move')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { book_id: 'b1', success: true, error: null },
            { book_id: 'b2', success: true, error: null },
          ],
          total: 2,
          succeeded: 2,
          failed: 0,
        }),
      }) as Promise<Response>
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Promise<Response>
  })
}

function renderModal(
  overrides: {
    onClose?: () => void
    onSuccess?: () => void
  } = {}
) {
  const selectedIds = new Set(['b1', 'b2'])
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <BulkEditModal
        selectedIds={selectedIds}
        shelves={SHELVES}
        onClose={overrides.onClose ?? vi.fn()}
        onSuccess={overrides.onSuccess ?? vi.fn()}
      />
    </MemoryRouter>
  )
}

describe('BulkEditModal', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = mockFetch()
  })
  afterEach(() => {
    cleanup()
    fetchSpy.mockRestore()
  })

  it('renders the modal with section headers', () => {
    renderModal()
    expect(screen.getByText('Edit 2 Books')).toBeInTheDocument()
    expect(screen.getByText('01 Metadata')).toBeInTheDocument()
    expect(screen.getByText('02 Move to Shelf')).toBeInTheDocument()
  })

  it('apply button is disabled when no changes are made', () => {
    renderModal()
    const btn = screen.getByTestId('bulk-apply-btn')
    expect(btn).toBeDisabled()
  })

  it('shows shelf options in the move dropdown', () => {
    renderModal()
    const select = screen.getByTestId(
      'bulk-move-shelf-select'
    ) as HTMLSelectElement
    expect(select.options).toHaveLength(3) // "Select shelf..." + 2 shelves
  })

  it('requires confirmation checkbox before move is enabled', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.selectOptions(screen.getByTestId('bulk-move-shelf-select'), '2')
    // Apply still disabled — need confirmation
    expect(screen.getByTestId('bulk-apply-btn')).toBeDisabled()

    await user.click(screen.getByTestId('bulk-move-confirm'))
    expect(screen.getByTestId('bulk-apply-btn')).not.toBeDisabled()
  })

  it('shows result summary after applying metadata changes', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    renderModal({ onSuccess })

    // Type a genre name and press enter to add it
    const genreInput = screen.getAllByPlaceholderText(
      'Type to search or add\u2026'
    )[0]
    await user.type(genreInput, 'Fantasy')
    // Wait for suggestions
    await waitFor(() => screen.getByText('Fantasy'))
    await user.click(screen.getByText('Fantasy'))

    // Now apply should be enabled
    await waitFor(() =>
      expect(screen.getByTestId('bulk-apply-btn')).not.toBeDisabled()
    )
    await user.click(screen.getByTestId('bulk-apply-btn'))

    await waitFor(() =>
      expect(screen.getByTestId('bulk-result-summary')).toBeInTheDocument()
    )
    expect(screen.getByText(/2 operations succeeded/)).toBeInTheDocument()

    // Click done
    await user.click(screen.getByTestId('bulk-done-btn'))
    expect(onSuccess).toHaveBeenCalled()
  })
})
