import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ZLibrarySettings from '../components/settings/ZLibrarySettings'

describe('ZLibrarySettings', () => {
  let fetchSpy: {
    mockRestore: () => void
    mock: { calls: [RequestInfo | URL, RequestInit | undefined][] }
  }
  let state: {
    selected: string
    default: string
    enabled: boolean
    domains: { domain: string; source: 'official' | 'zlibrary' | 'custom' }[]
    fetched_from: string | null
    fetched_at: number | null
  }

  beforeEach(() => {
    state = {
      selected: 'z-library.hn',
      default: 'z-library.hn',
      enabled: true,
      domains: [
        { domain: 'z-library.sk', source: 'official' },
        { domain: 'z-library.hn', source: 'official' },
      ],
      fetched_from: null,
      fetched_at: null,
    }
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      const u = url.toString()
      const method = (opts?.method ?? 'GET').toUpperCase()
      const sent = opts?.body ? JSON.parse(opts.body as string) : {}
      let body: unknown = state
      let status = 200
      if (u.startsWith('/api/zlibrary/domains/check?')) {
        const d = new URL(u, 'http://x').searchParams.get('domain')!
        body =
          d === 'z-library.sk'
            ? { domain: d, ok: false, ms: 0, error: 'behind a bot check' }
            : { domain: d, ok: true, ms: 420, error: null }
      } else if (u === '/api/zlibrary/domains/refresh') {
        state = {
          ...state,
          domains: [
            ...state.domains,
            { domain: 'articles.sk', source: 'zlibrary' },
          ],
          fetched_from: 'z-library.hn',
          fetched_at: 1791700000,
        }
        body = state
      } else if (u === '/api/zlibrary/domain' && method === 'PUT') {
        state = { ...state, selected: sent.domain }
        body = state
      } else if (u === '/api/zlibrary/domains' && method === 'POST') {
        status = 201
        state = {
          ...state,
          domains: [
            ...state.domains,
            { domain: sent.domain, source: 'custom' },
          ],
        }
        body = state
      } else if (
        u.startsWith('/api/zlibrary/domains/') &&
        method === 'DELETE'
      ) {
        state = {
          ...state,
          domains: state.domains.filter((d) => d.source !== 'custom'),
        }
        body = state
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

  it('checks every domain and shows which one is in use', async () => {
    render(<ZLibrarySettings />)
    expect(
      (await screen.findAllByText('Works · 420 ms')).length
    ).toBeGreaterThan(0)
    expect(screen.getByText('behind a bot check')).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'Use z-library.hn' })
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('adds Z-Library’s own domain list and checks the new ones', async () => {
    render(<ZLibrarySettings />)
    expect(await screen.findByText('articles.sk')).toBeInTheDocument()
    expect(screen.getByText('FROM Z-LIBRARY')).toBeInTheDocument()
    expect(screen.getByTestId('zlibrary-fetched')).toHaveTextContent(
      'from z-library.hn'
    )
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([u]) =>
          u.toString().includes('check?domain=articles.sk')
        )
      ).toBe(true)
    )
  })

  it('switches, adds and removes domains', async () => {
    render(<ZLibrarySettings />)
    fireEvent.click(
      await screen.findByRole('radio', { name: 'Use z-library.sk' })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('radio', { name: 'Use z-library.sk' })
      ).toHaveAttribute('aria-checked', 'true')
    )

    fireEvent.change(screen.getByLabelText('New domain'), {
      target: { value: 'libb.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('libb.example')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([u]) =>
          u.toString().includes('check?domain=libb.example')
        )
      ).toBe(true)
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove libb.example' }))
    await waitFor(() =>
      expect(screen.queryByText('libb.example')).not.toBeInTheDocument()
    )
  })

  it('says how to turn Z-Library on when no account is set', async () => {
    state.enabled = false
    render(<ZLibrarySettings />)
    expect(
      await screen.findByText(/Z-Library is off until an account is set/)
    ).toBeInTheDocument()
  })
})
