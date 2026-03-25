import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SerialDetail from '../pages/SerialDetail'
import type { WebSerial } from '../types/api'

const SERIAL: WebSerial = {
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

function mockFetch(
  overrides: { serial?: WebSerial; uploadedSerial?: WebSerial } = {}
) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
    const u = url.toString()
    const method =
      (opts as RequestInit | undefined)?.method?.toUpperCase() ?? 'GET'
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
    if (u.match(/\/api\/serials\/\d+\/upload-cover/) && method === 'POST')
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          overrides.uploadedSerial ?? {
            ...SERIAL,
            cover_path: '/data/covers/serial_1.jpg',
          },
      }) as Promise<Response>
    if (u.match(/\/api\/serials\/\d+\/refresh-cover/) && method === 'POST')
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          overrides.uploadedSerial ?? {
            ...SERIAL,
            cover_path: '/data/covers/serial_1.jpg',
          },
      }) as Promise<Response>
    if (u.match(/\/api\/serials\/\d+(\?|$)/))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => overrides.serial ?? SERIAL,
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
  afterEach(() => {
    cleanup()
    fetchSpy.mockRestore()
  })

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

  it('prefers the uploaded cover endpoint when both cover_path and cover_url exist', async () => {
    renderDetail()
    await waitFor(() => screen.getByRole('heading', { level: 1 }))
    const cover = screen.getByAltText('Test Story')
    expect(cover.getAttribute('src')).toContain('/api/serials/1/cover')
    expect(cover.getAttribute('src')).toContain('cover=')
  })

  it('falls back to cover_url when no uploaded cover is present', async () => {
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({
      serial: {
        ...SERIAL,
        cover_path: null,
        cover_url: 'https://example.com/remote-cover.jpg',
      },
    })
    renderDetail()
    await waitFor(() => screen.getByRole('heading', { level: 1 }))
    const cover = screen.getByAltText('Test Story')
    expect(cover.getAttribute('src')).toBe(
      'https://example.com/remote-cover.jpg'
    )
  })

  it('switches to the uploaded cover without waiting for a reload', async () => {
    fetchSpy.mockRestore()
    fetchSpy = mockFetch({
      serial: {
        ...SERIAL,
        cover_path: null,
      },
      uploadedSerial: {
        ...SERIAL,
        cover_path: '/data/covers/serial_1.jpg',
      },
    })
    renderDetail()
    await waitFor(() => screen.getByRole('heading', { level: 1 }))

    const uploadInput = document.querySelector(
      'input[type="file"][accept="image/*"]'
    ) as HTMLInputElement
    const file = new File(['cover'], 'cover.jpg', { type: 'image/jpeg' })
    await userEvent.upload(uploadInput, file)

    await waitFor(() => {
      const cover = screen.getByAltText('Test Story')
      expect(cover.getAttribute('src')).toContain('/api/serials/1/cover')
      expect(cover.getAttribute('src')).toContain('v=1')
    })
  })
})
