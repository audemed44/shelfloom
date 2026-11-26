import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VolumeList from '../components/serials/VolumeList'
import { TestMemoryRouter } from '../test-utils/router'

describe('VolumeList', () => {
  let fetchSpy: { mockRestore: () => void }
  let previewRequests: Array<{ splits: Array<{ start: number; end: number }> }>

  beforeEach(() => {
    previewRequests = []

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      const requestUrl = url.toString()
      const method =
        (opts as RequestInit | undefined)?.method?.toUpperCase() ?? 'GET'

      if (
        requestUrl === '/api/serials/1/volumes/preview' &&
        method === 'POST'
      ) {
        const body = JSON.parse(
          String((opts as RequestInit | undefined)?.body ?? '{}')
        ) as {
          splits: Array<{ start: number; end: number }>
        }
        previewRequests.push(body)

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            {
              start: 1,
              end: 3,
              name: 'Opening',
              chapter_count: 3,
              fetched_chapter_count: 2,
              total_words: 560,
              estimated_pages: 2,
              is_partial: true,
              stubbed_missing_count: 1,
            },
          ],
        }) as Promise<Response>
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as Promise<Response>
    })
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('renders preview estimates for valid custom ranges', async () => {
    render(
      <TestMemoryRouter>
        <VolumeList
          serialId={1}
          volumes={[]}
          totalChapters={4}
          shelves={[]}
          onRefresh={vi.fn()}
        />
      </TestMemoryRouter>
    )

    fireEvent.change(screen.getByPlaceholderText('End'), {
      target: { value: '3' },
    })

    await waitFor(() => expect(screen.getByText('Preview')).toBeInTheDocument())

    expect(screen.getByText('Opening')).toBeInTheDocument()
    expect(screen.getByText('~2* pages')).toBeInTheDocument()
    expect(screen.getByText('560 words')).toBeInTheDocument()
    expect(screen.getByText('2/3 fetched')).toBeInTheDocument()
    expect(screen.getByText('1 stubbed missing')).toBeInTheDocument()
    expect(previewRequests[previewRequests.length - 1]).toEqual({
      splits: [{ start: 1, end: 3 }],
    })
  })

  it('extends a volume to the latest chapter', async () => {
    const onRefresh = vi.fn()
    render(
      <TestMemoryRouter>
        <VolumeList
          serialId={1}
          volumes={[
            {
              id: 7,
              serial_id: 1,
              book_id: 'book-7',
              volume_number: 2,
              kind: 'generated',
              name: null,
              cover_path: null,
              chapter_start: 101,
              chapter_end: 150,
              generated_at: null,
              is_stale: false,
              chapter_count: 50,
              fetched_chapter_count: 50,
              is_partial: false,
              stubbed_missing_count: 0,
              estimated_pages: null,
              total_words: null,
            },
          ]}
          totalChapters={180}
          shelves={[]}
          onRefresh={onRefresh}
        />
      </TestMemoryRouter>
    )

    fireEvent.click(screen.getByTitle('Edit chapter range'))
    expect(screen.getByLabelText('Start')).toHaveValue(101)
    expect(screen.getByLabelText('End')).toHaveValue(150)
    fireEvent.click(screen.getByText('To latest (180)'))
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    const call = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url]) => url.toString() === '/api/serials/1/volumes/7')
    expect((call?.[1] as RequestInit).method).toBe('PATCH')
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      chapter_start: 101,
      chapter_end: 180,
    })
  })
})
