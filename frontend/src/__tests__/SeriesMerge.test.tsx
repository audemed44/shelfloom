import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SeriesMergeBanner from '../components/serials/SeriesMergeBanner'
import MergeSeriesModal from '../components/series/MergeSeriesModal'
import { TestMemoryRouter } from '../test-utils/router'
import type { SeriesWithCount } from '../types/api'

const CANDIDATE = {
  series_id: 7,
  name: 'Mother of Learning',
  book_count: 3,
  reasons: ['same_name'],
  books: [1, 2, 3].map((n) => ({
    book_id: `b${n}`,
    title: `Mother of Learning: Book ${n}`,
    sequence: n,
    linked: n === 1,
  })),
}

function series(id: number, name: string, book_count: number): SeriesWithCount {
  return {
    id,
    name,
    description: null,
    parent_id: null,
    parent_name: null,
    sort_order: 0,
    cover_path: null,
    book_count,
    first_book_id: null,
    first_book_cover_path: null,
  }
}

describe('Series merging', () => {
  let fetchSpy: {
    mockRestore: () => void
    mock: { calls: [RequestInfo | URL, RequestInit | undefined][] }
  }

  beforeEach(() => {
    localStorage.clear()
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      let body: unknown = {}
      if (u.endsWith('/series-merge-candidates')) body = [CANDIDATE]
      else if (u.endsWith('/merge-series'))
        body = {
          series_id: 3,
          series_name: 'Mother of Learning',
          merged_from: 'Mother of Learning',
          moved_books: 0,
          linked_volumes: 2,
        }
      else if (u.endsWith('/merge'))
        body = { series: { id: 3, name: 'New' }, moved_books: 2 }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => body,
      }) as Promise<Response>
    }) as unknown as typeof fetchSpy
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  function bodyOf(suffix: string) {
    const call = fetchSpy.mock.calls.find(([u]) => String(u).endsWith(suffix))
    return JSON.parse(String(call?.[1]?.body))
  }

  it('offers to merge a matching series and link its books', async () => {
    const onMerged = vi.fn()
    render(
      <TestMemoryRouter>
        <SeriesMergeBanner serialId={1} refreshKey={0} onMerged={onMerged} />
      </TestMemoryRouter>
    )
    const banner = await screen.findByTestId('series-merge-banner')
    expect(banner).toHaveTextContent('Mother of Learning')
    expect(banner).toHaveTextContent('already has 3 books')
    expect(banner).toHaveTextContent('LINKED') // book 1
    // Two books aren't linked yet, so linking them is on by default.
    expect(screen.getByTestId('series-merge-link')).toBeChecked()

    fireEvent.click(screen.getByTestId('series-merge-confirm'))
    await waitFor(() => expect(onMerged).toHaveBeenCalled())
    expect(bodyOf('/api/serials/1/merge-series')).toEqual({
      series_id: 7,
      link_as_volumes: true,
    })
    expect(await screen.findByTestId('series-merge-done')).toHaveTextContent(
      '2 books added as ebook volumes'
    )
  })

  it('can merge without linking, and remembers "Not now"', async () => {
    const { unmount } = render(
      <TestMemoryRouter>
        <SeriesMergeBanner serialId={1} refreshKey={0} onMerged={() => {}} />
      </TestMemoryRouter>
    )
    await screen.findByTestId('series-merge-banner')
    fireEvent.click(screen.getByTestId('series-merge-link'))
    fireEvent.click(screen.getByTestId('series-merge-confirm'))
    await screen.findByTestId('series-merge-done')
    expect(bodyOf('/merge-series').link_as_volumes).toBe(false)
    unmount()

    render(
      <TestMemoryRouter>
        <SeriesMergeBanner serialId={2} refreshKey={0} onMerged={() => {}} />
      </TestMemoryRouter>
    )
    await screen.findByTestId('series-merge-banner')
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByTestId('series-merge-banner')).not.toBeInTheDocument()
    expect(localStorage.getItem('shelfloom.seriesMerge.dismissed')).toContain(
      '2:7'
    )
  })

  it('merges a series into the one picked in the dialog', async () => {
    const onMerged = vi.fn()
    render(
      <MergeSeriesModal
        source={{ id: 1, name: 'Mother of Learning' }}
        sourceBookCount={3}
        allSeries={[
          series(1, 'Mother of Learning', 3),
          series(3, 'Mother of Learning', 5),
          series(4, 'Worm', 1),
        ]}
        onClose={() => {}}
        onMerged={onMerged}
      />
    )
    // Pre-filtered by name, and the series itself isn't offered.
    const options = screen.getAllByTestId('merge-series-option')
    expect(options).toHaveLength(1)
    expect(screen.getByTestId('merge-series-confirm')).toBeDisabled()

    fireEvent.click(options[0])
    expect(screen.getByTestId('merge-series-summary')).toHaveTextContent(
      '5 books'
    )
    fireEvent.click(screen.getByTestId('merge-series-confirm'))
    await waitFor(() => expect(onMerged).toHaveBeenCalledWith(3))
    expect(bodyOf('/api/series/3/merge')).toEqual({ source_id: 1 })
  })
})
