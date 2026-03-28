import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MoreMenu from '../components/nav/MoreMenu'
import { TestMemoryRouter } from '../test-utils/router'

function renderMenu(open: boolean, onClose = vi.fn()) {
  return render(
    <TestMemoryRouter>
      <MoreMenu open={open} onClose={onClose} />
    </TestMemoryRouter>
  )
}

describe('MoreMenu', () => {
  it('does not render when closed', () => {
    renderMenu(false)
    expect(screen.queryByTestId('more-menu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('more-menu-backdrop')).not.toBeInTheDocument()
  })

  it('renders menu items when open', () => {
    renderMenu(true)
    expect(screen.getByTestId('more-menu')).toBeInTheDocument()
    expect(screen.getByTestId('more-menu-item-series')).toBeInTheDocument()
    expect(screen.getByTestId('more-menu-item-stats')).toBeInTheDocument()
    expect(screen.getByTestId('more-menu-item-settings')).toBeInTheDocument()
  })

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderMenu(true, onClose)

    await user.click(screen.getByTestId('more-menu-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderMenu(true, onClose)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when a menu item is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderMenu(true, onClose)

    await user.click(screen.getByTestId('more-menu-item-settings'))
    expect(onClose).toHaveBeenCalled()
  })
})
