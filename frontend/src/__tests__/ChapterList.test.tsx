import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChapterList from '../components/serials/ChapterList'
import type {
  ChapterFetchStatusResponse,
  SerialChapter,
  SerialVolume,
} from '../types/api'

function makeChapter(
  chapterNumber: number,
  overrides: Partial<SerialChapter> = {}
): SerialChapter {
  return {
    id: chapterNumber,
    serial_id: 1,
    chapter_number: chapterNumber,
    title: `Chapter ${chapterNumber}`,
    source_url: `https://example.com/ch/${chapterNumber}`,
    is_stubbed: false,
    stubbed_at: null,
    publish_date: null,
    word_count: null,
    estimated_pages: null,
    running_word_count: 0,
    running_estimated_pages: null,
    running_is_partial: false,
    fetched_at: null,
    has_content: false,
    ...overrides,
  }
}

describe('ChapterList', () => {
  let fetchSpy: { mockRestore: () => void }
  let chapters: SerialChapter[]
  let status: ChapterFetchStatusResponse

  beforeEach(() => {
    chapters = [makeChapter(1), makeChapter(2)]
    status = {
      serial_id: 1,
      state: 'idle',
      start: null,
      end: null,
      total: 0,
      processed: 0,
      fetched: 0,
      skipped: 0,
      failed: 0,
      current_chapter_number: null,
      current_chapter_title: null,
      started_at: null,
      finished_at: null,
      logs: [],
      error: null,
    }

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      const requestUrl = url.toString()
      const method =
        (opts as RequestInit | undefined)?.method?.toUpperCase() ?? 'GET'

      if (
        requestUrl === '/api/serials/1/chapters/fetch-status' &&
        method === 'GET'
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => status,
        }) as Promise<Response>
      }

      if (
        requestUrl.startsWith('/api/serials/1/chapters?offset=0&limit=50') &&
        method === 'GET'
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => chapters,
        }) as Promise<Response>
      }

      if (requestUrl === '/api/serials/1/chapters/fetch' && method === 'POST') {
        status = {
          serial_id: 1,
          state: 'running',
          start: 1,
          end: 2,
          total: 2,
          processed: 0,
          fetched: 0,
          skipped: 0,
          failed: 0,
          current_chapter_number: null,
          current_chapter_title: null,
          started_at: '2026-03-25T10:00:00Z',
          finished_at: null,
          logs: [],
          error: null,
        }

        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            serial_id: 1,
            state: 'running',
            start: 1,
            end: 2,
            total: 2,
            started_at: '2026-03-25T10:00:00Z',
          }),
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

  it('polls fetch status and updates fetched chapter rows while the job is running', async () => {
    const { container } = render(<ChapterList serialId={1} totalChapters={2} />)

    await waitFor(() =>
      expect(screen.getByText('0/2 fetched')).toBeInTheDocument()
    )

    const [fromInput, toInput] = screen.getAllByRole('spinbutton')
    fireEvent.change(fromInput, { target: { value: '1' } })
    fireEvent.change(toInput, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch Content' }))

    await waitFor(() => expect(screen.getByText('running')).toBeInTheDocument())
    expect(screen.getByText('Waiting for log output.')).toBeInTheDocument()

    status = {
      ...status,
      processed: 1,
      fetched: 1,
      current_chapter_number: 1,
      current_chapter_title: 'Chapter 1',
      logs: [
        {
          timestamp: '2026-03-25T10:00:01Z',
          level: 'info',
          message: 'Fetched chapter 1 "Chapter 1" (42 words)',
          chapter_number: 1,
        },
      ],
    }
    chapters = [
      makeChapter(1, {
        has_content: true,
        fetched_at: '2026-03-25T10:00:01Z',
        word_count: 42,
      }),
      makeChapter(2),
    ]

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100))
    })

    await waitFor(() =>
      expect(screen.getByText('1/2 fetched')).toBeInTheDocument()
    )
    expect(
      screen.getByText('Fetched chapter 1 "Chapter 1" (42 words)')
    ).toBeInTheDocument()
    expect(container.querySelectorAll('svg.text-green-500')).toHaveLength(1)

    status = {
      ...status,
      state: 'completed',
      processed: 2,
      current_chapter_number: null,
      current_chapter_title: null,
      finished_at: '2026-03-25T10:00:02Z',
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100))
    })

    await waitFor(() =>
      expect(screen.getByText('completed')).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'Fetch Content' })).toBeEnabled()
  })

  it('renders chapter word counts, running pages, and matching volumes', async () => {
    chapters = [
      makeChapter(1, {
        word_count: 280,
        estimated_pages: 1,
        running_word_count: 280,
        running_estimated_pages: 1,
      }),
      makeChapter(2, {
        running_word_count: 280,
        running_estimated_pages: 1,
        running_is_partial: true,
      }),
    ]

    const volumes: SerialVolume[] = [
      {
        id: 10,
        serial_id: 1,
        book_id: null,
        volume_number: 1,
        name: 'Arc One',
        cover_path: null,
        chapter_start: 1,
        chapter_end: 1,
        generated_at: null,
        is_stale: false,
        chapter_count: 1,
        fetched_chapter_count: 1,
        is_partial: false,
        stubbed_missing_count: 0,
        estimated_pages: 1,
        total_words: 280,
      },
    ]

    render(<ChapterList serialId={1} totalChapters={2} volumes={volumes} />)

    await waitFor(() =>
      expect(
        screen.getByText('Words 280 · Pages 1 · Run 1')
      ).toBeInTheDocument()
    )

    expect(screen.getByText('Words — · Pages — · Run 1*')).toBeInTheDocument()
    expect(screen.getAllByText('Arc One').length).toBeGreaterThan(0)
  })
})
