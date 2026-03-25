import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VolumeList from '../components/serials/VolumeList'

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
      <MemoryRouter>
        <VolumeList
          serialId={1}
          volumes={[]}
          totalChapters={4}
          shelves={[]}
          onRefresh={vi.fn()}
        />
      </MemoryRouter>
    )

    fireEvent.change(screen.getByPlaceholderText('End'), {
      target: { value: '3' },
    })

    await waitFor(() => expect(screen.getByText('Preview')).toBeInTheDocument())

    expect(screen.getByText('Opening')).toBeInTheDocument()
    expect(screen.getByText('~2* pages')).toBeInTheDocument()
    expect(screen.getByText('560 words')).toBeInTheDocument()
    expect(screen.getByText('2/3 fetched')).toBeInTheDocument()
    expect(previewRequests[previewRequests.length - 1]).toEqual({
      splits: [{ start: 1, end: 3 }],
    })
  })
})
