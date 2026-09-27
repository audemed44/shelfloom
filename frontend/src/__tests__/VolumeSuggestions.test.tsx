import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VolumeList from '../components/serials/VolumeList'
import { TestMemoryRouter } from '../test-utils/router'
import type { SerialVolume } from '../types/api'

const SUGGESTIONS = {
  start_chapter: 31,
  words_per_page: 280,
  average_chapter_words: 5000,
  reason: null,
  suggestions: [
    {
      start: 31,
      end: 61,
      chapter_count: 31,
      total_words: 155000,
      estimated_pages: 554,
      estimated_chapter_count: 0,
      in_progress: false,
    },
    {
      start: 62,
      end: 80,
      chapter_count: 19,
      total_words: 95000,
      estimated_pages: 339,
      estimated_chapter_count: 4,
      in_progress: true,
    },
  ],
}

const BUILT: SerialVolume = {
  id: 1,
  serial_id: 1,
  book_id: 'b1',
  volume_number: 1,
  kind: 'generated',
  name: null,
  cover_path: null,
  chapter_start: 1,
  chapter_end: 30,
  generated_at: '2026-01-01T00:00:00Z',
  is_stale: false,
  chapter_count: 30,
  fetched_chapter_count: 30,
  is_partial: false,
  stubbed_missing_count: 0,
  estimated_pages: 540,
  total_words: 150000,
}

describe('Volume suggestions', () => {
  let fetchSpy: {
    mockRestore: () => void
    mock: { calls: [RequestInfo | URL, RequestInit | undefined][] }
  }

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      let body: unknown = []
      if (u.endsWith('/volumes/suggest')) body = SUGGESTIONS
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

  function renderList(onRefresh = vi.fn()) {
    render(
      <TestMemoryRouter>
        <VolumeList
          serialId={1}
          volumes={[BUILT]}
          totalChapters={80}
          shelves={[]}
          onRefresh={onRefresh}
        />
      </TestMemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }))
    return onRefresh
  }

  function bodyOf(path: string) {
    const call = fetchSpy.mock.calls.find(([u]) => String(u).endsWith(path))
    return JSON.parse(String(call?.[1]?.body))
  }

  it('asks for 500–600 page volumes and lists them after built ones', async () => {
    renderList()
    const items = await screen.findAllByTestId('volume-suggestion')
    expect(bodyOf('/volumes/suggest')).toEqual({
      min_pages: 500,
      max_pages: 600,
    })
    expect(items).toHaveLength(2)
    // Volume 1 is already built, so suggestions start at 02.
    expect(items[0]).toHaveTextContent('02')
    expect(items[0]).toHaveTextContent('Ch 31–61')
    expect(items[0]).toHaveTextContent('~554 pages')
    expect(items[1]).toHaveTextContent('In progress')
  })

  it('re-suggests with a different book length', async () => {
    renderList()
    await screen.findAllByTestId('volume-suggestion')
    fireEvent.change(screen.getByLabelText('Minimum pages'), {
      target: { value: '300' },
    })
    fireEvent.change(screen.getByLabelText('Maximum pages'), {
      target: { value: '350' },
    })
    fireEvent.click(screen.getByRole('button', { name: /suggest again/i }))
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.filter(([u]) =>
          String(u).endsWith('/volumes/suggest')
        )
      ).toHaveLength(2)
    )
    const calls = fetchSpy.mock.calls.filter(([u]) =>
      String(u).endsWith('/volumes/suggest')
    )
    expect(JSON.parse(String(calls[1][1]?.body))).toEqual({
      min_pages: 300,
      max_pages: 350,
    })
  })

  it('rejects a backwards page range without calling the API', async () => {
    renderList()
    await screen.findAllByTestId('volume-suggestion')
    fireEvent.change(screen.getByLabelText('Maximum pages'), {
      target: { value: '100' },
    })
    fireEvent.click(screen.getByRole('button', { name: /suggest again/i }))
    expect(await screen.findByText(/Enter a page range/)).toBeInTheDocument()
  })

  it('applies the suggestions as volume splits', async () => {
    const onRefresh = renderList()
    await screen.findAllByTestId('volume-suggestion')
    fireEvent.click(screen.getByTestId('apply-suggestions'))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(bodyOf('/api/serials/1/volumes')).toEqual({
      splits: [
        { start: 31, end: 61 },
        { start: 62, end: 80 },
      ],
    })
  })

  it('loads the suggestions into the custom editor to tweak', async () => {
    renderList()
    await screen.findAllByTestId('volume-suggestion')
    fireEvent.click(screen.getByTestId('edit-suggestions'))
    expect(
      screen
        .getAllByPlaceholderText('Start')
        .map((i) => (i as HTMLInputElement).value)
    ).toEqual(['31', '62'])
    expect(
      screen
        .getAllByPlaceholderText('End')
        .map((i) => (i as HTMLInputElement).value)
    ).toEqual(['61', '80'])
  })
})
