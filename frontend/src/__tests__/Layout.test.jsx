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
    expect(screen.getByText('Library')).toBeInTheDocument()
    expect(screen.getByText('Stats')).toBeInTheDocument()
    expect(screen.getByText('Serials')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('renders main content area', () => {
    renderLayout()
    expect(document.querySelector('main')).toBeInTheDocument()
  })

  it('shows SHELFLOOM branding', () => {
    renderLayout()
    expect(screen.getByText('Shelfloom')).toBeInTheDocument()
  })
})
