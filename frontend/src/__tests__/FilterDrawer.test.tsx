import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilterDrawer from '../components/library/FilterDrawer'
import type { FilterState, FilterLabels } from '../types/api'

const EMPTY_FILTERS: FilterState = {
  genres: [],
  tags: [],
  seriesIds: [],
  authors: [],
  formats: [],
  mode: 'and',
}

const MOCK_SHELVES = [
  {
    id: 1,
    name: 'Main Library',
    path: '/books',
    is_default: true,
    is_sync_target: false,
    device_name: null,
    koreader_stats_db_path: null,
    auto_organize: false,
    created_at: '',
    book_count: 5,
    organize_template: null,
    seq_pad: 2,
  },
]

const MOCK_GENRES = [
  { id: 1, name: 'Fantasy' },
  { id: 2, name: 'Sci-Fi' },
  { id: 3, name: 'Mystery' },
  { id: 4, name: 'Romance' },
  { id: 5, name: 'Thriller' },
  { id: 6, name: 'Horror' },
]

const MOCK_TAGS = [
  { id: 1, name: 'favorites' },
  { id: 2, name: 'to-read' },
]

const MOCK_AUTHORS = [{ name: 'Frank Herbert' }, { name: 'Isaac Asimov' }]

const MOCK_SERIES = [
  {
    id: 1,
    name: 'Dune',
    description: null,
    parent_id: null,
    parent_name: null,
    sort_order: 0,
    cover_path: null,
    book_count: 6,
    first_book_id: '1',
  },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let savedFetch: any

function setupMockFetch() {
  savedFetch = globalThis.fetch
  globalThis.fetch = vi.fn((url: string | URL | Request) => {
    const u = url.toString()
    if (u.includes('/api/genres'))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => MOCK_GENRES,
      })
    if (u.includes('/api/tags'))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => MOCK_TAGS,
      })
    if (u.includes('/api/authors'))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => MOCK_AUTHORS,
      })
    if (u.includes('/api/series'))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => MOCK_SERIES,
      })
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => [],
    })
  }) as unknown as typeof fetch
}

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  filters: EMPTY_FILTERS,
  onApply: vi.fn() as (f: FilterState, l: FilterLabels) => void,
  shelves: MOCK_SHELVES,
  shelfId: null as number | null,
  onShelfChange: vi.fn(),
  status: null as string | null,
  onStatusChange: vi.fn(),
}

describe('FilterDrawer', () => {
  beforeEach(() => {
    setupMockFetch()
    vi.clearAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = savedFetch
  })

  it('renders all accordion sections when open', async () => {
    render(<FilterDrawer {...defaultProps} />)

    expect(screen.getByTestId('filter-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('accordion-shelves')).toBeInTheDocument()
    expect(screen.getByTestId('accordion-status')).toBeInTheDocument()
    expect(screen.getByTestId('accordion-genre')).toBeInTheDocument()
    expect(screen.getByTestId('accordion-tags')).toBeInTheDocument()
    expect(screen.getByTestId('accordion-series')).toBeInTheDocument()
    expect(screen.getByTestId('accordion-author')).toBeInTheDocument()
    expect(screen.getByTestId('accordion-format')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<FilterDrawer {...defaultProps} open={false} />)
    expect(screen.queryByTestId('filter-drawer')).not.toBeInTheDocument()
  })

  it('expands accordion on click to show items', async () => {
    const user = userEvent.setup()
    render(<FilterDrawer {...defaultProps} />)

    // Genre section should be collapsed by default
    const genreAccordion = screen.getByTestId('accordion-genre')
    await user.click(genreAccordion)

    // After expanding, genre items should appear (fetched from mock API)
    expect(await screen.findByText('Fantasy')).toBeInTheDocument()
    expect(screen.getByText('Sci-Fi')).toBeInTheDocument()
    expect(screen.getByText('Mystery')).toBeInTheDocument()
  })

  it('toggles AND/OR mode', async () => {
    const user = userEvent.setup()
    render(<FilterDrawer {...defaultProps} />)

    const andBtn = screen.getByTestId('filter-mode-and')
    const orBtn = screen.getByTestId('filter-mode-or')

    // Default is AND
    expect(andBtn.className).toContain('bg-primary')

    await user.click(orBtn)
    expect(orBtn.className).toContain('bg-primary')
  })

  it('calls onApply with selected filters', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<FilterDrawer {...defaultProps} onApply={onApply} />)

    // Expand format section and select EPUB
    await user.click(screen.getByTestId('accordion-format'))
    const epubCheckbox = screen.getByRole('checkbox', { name: /epub/i })
    await user.click(epubCheckbox)

    // Apply
    await user.click(screen.getByTestId('filter-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    const [appliedFilters] = onApply.mock.calls[0]
    expect(appliedFilters.formats).toEqual(['epub'])
  })

  it('Clear All resets all draft filters', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <FilterDrawer
        {...defaultProps}
        onApply={onApply}
        filters={{ ...EMPTY_FILTERS, formats: ['epub'] }}
      />
    )

    await user.click(screen.getByTestId('filter-clear-all'))
    await user.click(screen.getByTestId('filter-apply'))

    const [appliedFilters] = onApply.mock.calls[0]
    expect(appliedFilters.formats).toEqual([])
    expect(appliedFilters.genres).toEqual([])
  })

  it('closes on backdrop click', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<FilterDrawer {...defaultProps} onClose={onClose} />)

    await user.click(screen.getByTestId('filter-drawer-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape key', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<FilterDrawer {...defaultProps} onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('search filters the checkbox list', async () => {
    const user = userEvent.setup()
    render(<FilterDrawer {...defaultProps} />)

    // Expand genre section
    await user.click(screen.getByTestId('accordion-genre'))
    await screen.findByText('Fantasy')

    // Search for "Sci"
    const searchInput = screen.getByTestId('filter-search-input')
    await user.type(searchInput, 'Sci')

    expect(screen.getByText('Sci-Fi')).toBeInTheDocument()
    expect(screen.queryByText('Fantasy')).not.toBeInTheDocument()
    expect(screen.queryByText('Mystery')).not.toBeInTheDocument()
  })

  it('shows selected count in accordion header', async () => {
    const user = userEvent.setup()
    render(
      <FilterDrawer
        {...defaultProps}
        filters={{ ...EMPTY_FILTERS, formats: ['epub', 'pdf'] }}
      />
    )

    // Format section header should show count of 2
    const formatSection = screen.getByTestId('accordion-format')
    expect(within(formatSection).getByText('2')).toBeInTheDocument()
  })
})
