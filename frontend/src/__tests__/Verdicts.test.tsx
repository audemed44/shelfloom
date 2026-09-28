import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Verdicts from '../pages/Verdicts'
import { TestMemoryRouter } from '../test-utils/router'

const BOOKS = [
  {
    id: 'a',
    title: 'Dune',
    author: 'Frank Herbert',
    cover_path: null,
    page_count: 600,
    completed_at: '2026-09-20T21:00:00',
  },
  {
    id: 'b',
    title: 'Piranesi',
    author: 'Susanna Clarke',
    cover_path: null,
    page_count: 272,
    completed_at: '2026-09-10T21:00:00',
  },
  {
    id: 'c',
    title: 'Hyperion',
    author: 'Dan Simmons',
    cover_path: null,
    page_count: 482,
    completed_at: '2026-08-01T21:00:00',
  },
]

let calls: { url: string; method: string; body: unknown }[]

function mockFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? 'GET'
  calls.push({
    url,
    method,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  })
  const payload = url.includes('/api/stats/pending-verdicts') ? BOOKS : {}
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(payload),
  } as Response)
}

function renderPage() {
  render(
    <TestMemoryRouter>
      <Verdicts />
    </TestMemoryRouter>
  )
}

const title = () => screen.getByTestId('verdict-title')
const writes = () => calls.filter((c) => c.method !== 'GET')
const lastWrite = () => writes()[writes().length - 1]

describe('Verdicts', () => {
  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', vi.fn(mockFetch))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('rates with one tap and moves to the next book', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(title()).toHaveTextContent('Dune'))
    expect(screen.getByTestId('verdicts-count')).toHaveTextContent(
      '3 finished books are waiting'
    )

    await user.click(screen.getByRole('button', { name: 'Rate 4 stars' }))
    await waitFor(() => expect(title()).toHaveTextContent('Piranesi'))
    expect(writes()).toEqual([
      {
        url: '/api/books/a',
        method: 'PATCH',
        body: { rating: 4, review: null },
      },
    ])
    expect(screen.getByTestId('verdict-last')).toHaveTextContent(
      'Dune rated 4 ★'
    )
    expect(screen.getByTestId('verdicts-count')).toHaveTextContent(
      '2 finished books are waiting'
    )
  })

  it('undoes the last verdict', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(title()).toHaveTextContent('Dune'))
    await user.click(screen.getByRole('button', { name: 'Rate 5 stars' }))
    await waitFor(() => expect(title()).toHaveTextContent('Piranesi'))
    await user.click(screen.getByTestId('verdict-undo'))
    await waitFor(() => expect(title()).toHaveTextContent('Dune'))
    expect(lastWrite()).toEqual({
      url: '/api/books/a',
      method: 'PATCH',
      body: { rating: null, review: null },
    })
  })

  it('saves a few words with the rating', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(title()).toHaveTextContent('Dune'))
    await user.click(screen.getByTestId('verdict-write'))
    await user.click(screen.getByRole('button', { name: 'Rate 3 stars' }))
    // Writing: the star doesn't save on its own.
    expect(writes()).toHaveLength(0)
    await user.type(
      screen.getByTestId('verdict-review'),
      'Slow start, great finish.'
    )
    await user.click(screen.getByTestId('verdict-save'))
    await waitFor(() => expect(title()).toHaveTextContent('Piranesi'))
    expect(writes()).toEqual([
      {
        url: '/api/books/a',
        method: 'PATCH',
        body: { rating: 3, review: 'Slow start, great finish.' },
      },
    ])
  })

  it('skips, marks as not finished and rates from the keyboard', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(title()).toHaveTextContent('Dune'))
    await user.click(screen.getByTestId('verdict-skip'))
    expect(title()).toHaveTextContent('Piranesi')
    await user.click(screen.getByTestId('verdict-dnf'))
    await waitFor(() => expect(lastWrite()?.url).toBe('/api/books/b/dnf'))
    await waitFor(() => expect(title()).toHaveTextContent('Hyperion'))
    await user.keyboard('2')
    await waitFor(() => expect(title()).toHaveTextContent('Dune'))
    await user.keyboard('5')
    await waitFor(() =>
      expect(screen.getByTestId('verdicts-done')).toHaveTextContent(
        'You gave 3 verdicts.'
      )
    )
  })
})
