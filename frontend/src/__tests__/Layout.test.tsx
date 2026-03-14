import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Layout from '../components/Layout'

function renderLayout(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Layout />
    </MemoryRouter>
  )
}

describe('Layout', () => {
  it('renders sidebar', () => {
    renderLayout()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  it('renders all nav items', () => {
    renderLayout()
    // Nav items appear in both Sidebar and BottomNav — assert at least one each
    expect(screen.getAllByText('Library').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Stats').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Series').length).toBeGreaterThan(0)
    expect(screen.getByText('Settings')).toBeInTheDocument() // sidebar only
  })

  it('renders main content area', () => {
    renderLayout()
    expect(document.querySelector('main')).toBeInTheDocument()
  })

  it('renders bottom nav for mobile', () => {
    renderLayout()
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument()
  })
})
