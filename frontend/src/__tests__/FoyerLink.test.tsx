import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Sidebar from '../components/Sidebar'
import MoreMenu from '../components/nav/MoreMenu'
import { TestMemoryRouter } from '../test-utils/router'

const foyer = vi.hoisted(() => ({ url: null as string | null }))
vi.mock('../components/nav/useFoyerUrl', () => ({
  useFoyerUrl: () => foyer.url,
}))

describe('Foyer link', () => {
  it('is hidden without HOMEPAGE_URL', () => {
    foyer.url = null
    render(
      <TestMemoryRouter>
        <Sidebar />
        <MoreMenu open onClose={vi.fn()} />
      </TestMemoryRouter>
    )
    expect(screen.queryByTestId('sidebar-foyer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('more-menu-item-foyer')).not.toBeInTheDocument()
  })

  it('links the sidebar and the More menu to Foyer', () => {
    foyer.url = 'https://home.example'
    render(
      <TestMemoryRouter>
        <Sidebar />
        <MoreMenu open onClose={vi.fn()} />
      </TestMemoryRouter>
    )
    expect(screen.getByTestId('sidebar-foyer')).toHaveAttribute(
      'href',
      'https://home.example'
    )
    expect(screen.getByTestId('more-menu-item-foyer')).toHaveAttribute(
      'href',
      'https://home.example'
    )
  })
})
