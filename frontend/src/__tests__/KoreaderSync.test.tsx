import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KoreaderSync from '../components/settings/KoreaderSync'

describe('KOReader sync settings', () => {
  let fetchSpy: {
    mockRestore: () => void
    mock: { calls: [RequestInfo | URL, RequestInit | undefined][] }
  }
  let accounts: unknown[]

  beforeEach(() => {
    accounts = [
      {
        username: 'kindle',
        last_synced_at: Math.floor(Date.now() / 1000) - 7200,
        last_device: 'Kindle Paperwhite',
        last_book_title: 'Piranesi',
      },
    ]
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      const method = (opts?.method ?? 'GET').toUpperCase()
      if (String(url) === '/api/sync-accounts' && method === 'POST') {
        accounts = [...accounts, { username: 'phone', last_synced_at: null }]
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ username: 'phone' }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => accounts,
      } as Response)
    }) as unknown as typeof fetchSpy
  })

  afterEach(() => fetchSpy.mockRestore())

  it('shows the address to enter in KOReader and each account’s last sync', async () => {
    render(<KoreaderSync />)
    expect(screen.getByTestId('kosync-url')).toHaveTextContent(
      `${window.location.origin}/api/kosync`
    )
    const row = await screen.findByTestId('sync-account')
    expect(row).toHaveTextContent('kindle')
    expect(row).toHaveTextContent('Kindle Paperwhite · Piranesi · 2 h ago')
  })

  it('creates an account', async () => {
    render(<KoreaderSync />)
    await screen.findByTestId('sync-account')
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'phone' },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add account/i }))
    await waitFor(() =>
      expect(screen.getAllByTestId('sync-account')).toHaveLength(2)
    )
    const post = fetchSpy.mock.calls.find(([, o]) => o?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      username: 'phone',
      password: 'secret',
    })
  })
})
