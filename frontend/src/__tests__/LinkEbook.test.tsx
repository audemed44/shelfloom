import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LinkEbookModal from '../components/serials/LinkEbookModal'
import VolumeList from '../components/serials/VolumeList'
import { TestMemoryRouter } from '../test-utils/router'
import type { SerialVolume } from '../types/api'

function makeVolume(overrides: Partial<SerialVolume>): SerialVolume {
  return {
    id: 1,
    serial_id: 1,
    book_id: null,
    volume_number: 1,
    kind: 'generated',
    name: null,
    cover_path: null,
    chapter_start: 121,
    chapter_end: 180,
    generated_at: null,
    is_stale: false,
    chapter_count: 60,
    fetched_chapter_count: 60,
    is_partial: false,
    stubbed_missing_count: 0,
    estimated_pages: 300,
    total_words: 90000,
    ...overrides,
  }
}

const BOOKS = [
  {
    id: 'b1',
    title: 'Beware of Chicken',
    author: 'CasualFarmer',
    format: 'epub',
  },
  {
    id: 'b2',
    title: 'Beware of Chicken 2',
    author: 'CasualFarmer',
    format: 'epub',
  },
]

describe('Linking ebooks to a serial', () => {
  let fetchSpy: {
    mockRestore: () => void
    mock: { calls: [RequestInfo | URL, RequestInit | undefined][] }
  }

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      const u = url.toString()
      const method = (opts?.method ?? 'GET').toUpperCase()
      let body: unknown = {}
      let status = 200
      if (u.startsWith('/api/books?')) {
        body = { items: BOOKS, total: 2, page: 1, per_page: 8, pages: 1 }
      } else if (u.endsWith('/volumes/link-ebook') && method === 'POST') {
        status = 201
        body = makeVolume({ id: 9, kind: 'ebook', book_id: 'b1' })
      } else if (u.endsWith('/volumes/preview')) {
        body = []
      } else if (method === 'DELETE') {
        status = 204
        body = null
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

  it('searches the library, then links the chosen book at a position', async () => {
    const onLinked = vi.fn()
    render(
      <LinkEbookModal
        serialId={1}
        serialTitle="Beware of Chicken"
        volumes={[makeVolume({ id: 3, volume_number: 1 })]}
        stubbedChapterCount={120}
        onClose={() => {}}
        onLinked={onLinked}
      />
    )

    // Search is pre-filled with the serial title.
    expect(screen.getByTestId('link-ebook-search')).toHaveValue(
      'Beware of Chicken'
    )
    await waitFor(() =>
      expect(screen.getAllByTestId('link-ebook-result')).toHaveLength(2)
    )
    expect(screen.getByText(/120 stubbed chapters/)).toBeInTheDocument()
    expect(screen.getByTestId('link-ebook-submit')).toBeDisabled()

    fireEvent.click(screen.getAllByTestId('link-ebook-result')[0])
    expect(screen.getByTestId('link-ebook-selected')).toHaveTextContent(
      'Beware of Chicken'
    )
    // Default position is book 1, which pushes the existing volume down.
    expect(screen.getByLabelText('Book number in the serial')).toHaveValue(1)
    expect(screen.getByText('Volume #1 moves down to #2.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('First'), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText('Last'), {
      target: { value: '60' },
    })
    fireEvent.click(screen.getByTestId('link-ebook-submit'))

    await waitFor(() => expect(onLinked).toHaveBeenCalled())
    const call = fetchSpy.mock.calls.find(([u]) =>
      String(u).endsWith('/volumes/link-ebook')
    )
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      book_id: 'b1',
      volume_number: 1,
      name: null,
      chapter_start: 1,
      chapter_end: 60,
    })
  })

  it('requires both ends of the chapter range', async () => {
    render(
      <LinkEbookModal
        serialId={1}
        serialTitle="Beware of Chicken"
        volumes={[]}
        stubbedChapterCount={0}
        onClose={() => {}}
        onLinked={() => {}}
      />
    )
    await waitFor(() =>
      expect(screen.getAllByTestId('link-ebook-result')).toHaveLength(2)
    )
    fireEvent.click(screen.getAllByTestId('link-ebook-result')[1])
    fireEvent.change(screen.getByLabelText('First'), {
      target: { value: '5' },
    })
    fireEvent.click(screen.getByTestId('link-ebook-submit'))
    expect(
      await screen.findByText(
        'Enter both the first and last chapter, or leave both empty'
      )
    ).toBeInTheDocument()
    expect(
      fetchSpy.mock.calls.some(([u]) =>
        String(u).endsWith('/volumes/link-ebook')
      )
    ).toBe(false)
  })

  it('shows linked ebooks without generate or rebuild, and only unlinks them', async () => {
    const onRefresh = vi.fn()
    render(
      <TestMemoryRouter>
        <VolumeList
          serialId={1}
          volumes={[
            makeVolume({
              id: 7,
              kind: 'ebook',
              book_id: 'b1',
              name: 'Beware of Chicken',
              chapter_start: null,
              chapter_end: null,
            }),
            makeVolume({ id: 8, volume_number: 2 }),
          ]}
          totalChapters={180}
          shelves={[]}
          onRefresh={onRefresh}
        />
      </TestMemoryRouter>
    )

    const card = screen.getByTestId('ebook-volume')
    expect(card).toHaveTextContent('EBOOK')
    expect(card).toHaveTextContent('Chapters not set')
    // Only the generated volume offers Generate.
    expect(screen.getAllByRole('button', { name: /^generate$/i })).toHaveLength(
      1
    )

    fireEvent.click(screen.getByLabelText('Unlink ebook'))
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    const del = fetchSpy.mock.calls.find(
      ([, opts]) => opts?.method === 'DELETE'
    )
    expect(String(del?.[0])).toBe('/api/serials/1/volumes/7?delete_book=false')
  })

  it('opens the link dialog from the volume list', async () => {
    render(
      <TestMemoryRouter>
        <VolumeList
          serialId={1}
          volumes={[]}
          totalChapters={10}
          serialTitle="Beware of Chicken"
          shelves={[]}
          onRefresh={() => {}}
        />
      </TestMemoryRouter>
    )
    fireEvent.click(screen.getByTestId('link-ebook-button'))
    expect(screen.getByTestId('link-ebook-modal')).toBeInTheDocument()
  })
})
