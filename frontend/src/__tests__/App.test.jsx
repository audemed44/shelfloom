import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

describe('App', () => {
  // Silence fetch errors from useApi calls in jsdom (no network available)
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in tests'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders without crashing', () => {
    render(<App />)
    expect(document.body).toBeTruthy()
  })

  it('shows navigation items (sidebar + bottom nav both render them)', () => {
    render(<App />)
    // Both Sidebar and BottomNav render the same labels — getAllByText asserts ≥1
    expect(screen.getAllByText('Library').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Stats').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Serials').length).toBeGreaterThan(0)
  })

  it('shows dashboard page by default', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument()
  })

  it('navigates to library page', async () => {
    const user = userEvent.setup()
    render(<App />)
    // Click the first matching nav link (sidebar or bottom nav)
    await user.click(screen.getAllByText('Library')[0])
    expect(screen.getByRole('heading', { name: /library/i })).toBeInTheDocument()
  })

  it('navigates to stats page', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getAllByText('Stats')[0])
    expect(screen.getByRole('heading', { name: /stats/i })).toBeInTheDocument()
  })

  it('navigates to serials page', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getAllByText('Serials')[0])
    expect(screen.getByRole('heading', { name: /serials/i })).toBeInTheDocument()
  })
})
