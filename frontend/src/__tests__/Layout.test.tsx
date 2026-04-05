import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Layout from '../components/Layout'

function renderLayout(path = '/') {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
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
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0)
  })

  it('renders main content area', () => {
    renderLayout()
    const main = document.querySelector('main')
    expect(main).toBeInTheDocument()
    expect(main?.className).toContain('pb-mobile-bottom-nav')
  })

  it('renders bottom nav for mobile', () => {
    renderLayout()
    const bottomNav = screen.getByTestId('bottom-nav')
    expect(bottomNav).toBeInTheDocument()
    expect(bottomNav.className).toContain('h-mobile-bottom-nav')
    expect(bottomNav.className).toContain('z-30')
  })
})
