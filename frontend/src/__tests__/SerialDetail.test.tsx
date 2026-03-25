import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SerialDetail from '../pages/SerialDetail'

const SERIAL = {
  id: 1,
  url: 'https://royalroad.com/fiction/1/test-story',
  source: 'royalroad',
  title: 'Test Story',
  author: 'Author One',
  description: 'A great story.',
  cover_path: '/data/covers/serial_1.jpg',
  cover_url: 'https://example.com/cover.jpg',
  status: 'ongoing',
  total_chapters: 50,
  last_checked_at: null,
  last_error: null,
  created_at: '2026-01-01T00:00:00',
  series_id: 1,
}

const VOLUMES: object[] = []
const SHELVES = [
  { id: 1, name: 'Library', path: '/shelves/library', is_default: true },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockFetch(): any {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.match(/\/api\/serials\/\d+\/volumes/))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => VOLUMES,
      }) as Promise<Response>
    if (u.match(/\/api\/serials\/\d+\/chapters/))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [],
      }) as Promise<Response>
    if (u.match(/\/api\/serials\/\d+(\?|$)/))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => SERIAL,
      }) as Promise<Response>
    if (u.includes('/api/shelves'))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => SHELVES,
      }) as Promise<Response>
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Promise<Response>
  })
}

function renderDetail(serialId: number = 1) {
  return render(
    <MemoryRouter
      initialEntries={[`/serials/${serialId}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/serials/:id" element={<SerialDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('SerialDetail', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = mockFetch()
  })
  afterEach(() => fetchSpy.mockRestore())

  it('renders serial title and author', async () => {
    renderDetail()
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Test Story'
      )
    )
    expect(screen.getByText('Author One')).toBeInTheDocument()
  })

  it('renders cover upload button', async () => {
    renderDetail()
    await waitFor(() => screen.getByRole('heading', { level: 1 }))
    const uploadInput = document.querySelector(
      'input[type="file"][accept="image/*"]'
    )
    expect(uploadInput).toBeInTheDocument()
  })

  it('renders cover refresh button', async () => {
    renderDetail()
    await waitFor(() => screen.getByRole('heading', { level: 1 }))
    expect(screen.getByTitle('Refresh cover from source')).toBeInTheDocument()
  })
})
