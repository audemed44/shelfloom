import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />)
    expect(document.body).toBeTruthy()
  })

  it('shows sidebar navigation items', () => {
    render(<App />)
    expect(screen.getByText('Library')).toBeInTheDocument()
    expect(screen.getByText('Stats')).toBeInTheDocument()
    expect(screen.getByText('Serials')).toBeInTheDocument()
  })

  it('shows dashboard page by default', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument()
  })

  it('navigates to library page', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByText('Library'))
    expect(screen.getByRole('heading', { name: /library/i })).toBeInTheDocument()
  })

  it('navigates to stats page', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByText('Stats'))
    expect(screen.getByRole('heading', { name: /stats/i })).toBeInTheDocument()
  })

  it('navigates to serials page', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByText('Serials'))
    expect(screen.getByRole('heading', { name: /serials/i })).toBeInTheDocument()
  })
})
