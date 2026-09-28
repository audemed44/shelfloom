import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LibraryHealth, {
  type HealthReport,
} from '../components/health/LibraryHealth'
import { TestMemoryRouter } from '../test-utils/router'

const book = (id: string, title: string, detail: string | null = null) => ({
  id,
  title,
  author: 'Author',
  format: 'epub',
  cover_path: null,
  detail,
})

const REPORT: HealthReport = {
  checked_at: '2026-09-28T10:00:00',
  total_books: 42,
  issues: [
    {
      key: 'missing_file',
      severity: 'error',
      title: 'Missing files',
      ok_title: 'Every book’s file is on disk',
      description: 'Gone from disk.',
      count: 1,
      books: [book('m1', 'Lost Book', '/books/lost.epub')],
    },
    {
      key: 'no_cover',
      severity: 'warning',
      title: 'No cover',
      ok_title: 'Every book has a cover',
      description: 'Shelfloom can make one.',
      count: 2,
      books: [book('c1', 'Coverless One'), book('c2', 'Coverless Two')],
    },
    {
      key: 'no_fingerprint',
      severity: 'warning',
      title: 'Not ready for KOReader sync',
      ok_title: 'Every book is ready for KOReader sync',
      description: '',
      count: 0,
      books: [],
    },
  ],
  links: [
    {
      key: 'duplicate_books',
      severity: 'warning',
      title: 'Possible duplicates',
      count: 3,
      tab: 'duplicate-books',
    },
  ],
}

describe('Library health', () => {
  let fetchSpy: {
    mockRestore: () => void
    mock: { calls: [RequestInfo | URL, RequestInit | undefined][] }
  }

  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      const u = String(url)
      let body: unknown = REPORT
      if (opts?.method === 'POST') {
        body = u.includes('generate-covers')
          ? { generated: 2, failed: 0 }
          : u.includes('remove-missing')
            ? { removed: 1 }
            : { id: 'c1', cover_path: 'x-generated.jpg' }
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => body,
      } as Response)
    }) as unknown as typeof fetchSpy
  })

  afterEach(() => vi.restoreAllMocks())

  function renderHealth(onOpenTab = vi.fn()) {
    render(
      <TestMemoryRouter>
        <LibraryHealth onOpenTab={onOpenTab} />
      </TestMemoryRouter>
    )
    return onOpenTab
  }

  const posts = () =>
    fetchSpy.mock.calls.filter(([, o]) => o?.method === 'POST')

  it('lists problems, passed checks and links to other tabs', async () => {
    const onOpenTab = renderHealth()
    expect(await screen.findByText('Checked 42 books')).toBeInTheDocument()
    expect(screen.getByTestId('health-missing_file')).toHaveTextContent(
      '/books/lost.epub'
    )
    // A check with nothing found is listed as passed.
    expect(screen.getByText('PASSED').parentElement).toHaveTextContent(
      'Every book is ready for KOReader sync'
    )
    fireEvent.click(screen.getByRole('button', { name: /review/i }))
    expect(onOpenTab).toHaveBeenCalledWith('duplicate-books')
  })

  it('previews generated covers and makes them all', async () => {
    renderHealth()
    const previews = await screen.findAllByTestId('cover-preview')
    expect(previews).toHaveLength(2)
    expect(previews[0].querySelector('img')).toHaveAttribute(
      'src',
      '/api/books/c1/generated-cover?v=0'
    )
    fireEvent.click(screen.getByTestId('generate-no_cover'))
    expect(await screen.findByText('Made 2 covers.')).toBeInTheDocument()
    const [url, opts] = posts()[0]
    expect(String(url)).toBe('/api/library-health/generate-covers')
    expect(JSON.parse(String(opts?.body))).toEqual({
      book_ids: null,
      embed: true,
    })
  })

  it('can make one cover without touching the EPUB', async () => {
    renderHealth()
    await screen.findAllByTestId('cover-preview')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getAllByText('Use this cover')[1])
    await waitFor(() => expect(posts()).toHaveLength(1))
    const [url, opts] = posts()[0]
    expect(String(url)).toBe('/api/books/c2/generate-cover')
    expect(JSON.parse(String(opts?.body))).toEqual({ embed: false })
  })

  it('removes records whose file is missing after confirming', async () => {
    renderHealth()
    await screen.findByTestId('health-missing_file')
    fireEvent.click(
      screen.getByRole('button', { name: /remove from library/i })
    )
    expect(await screen.findByText('Removed 1 record(s).')).toBeInTheDocument()
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      book_ids: ['m1'],
    })
  })
})
