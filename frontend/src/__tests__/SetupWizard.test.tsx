import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import SetupWizard from '../components/SetupWizard'

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// DirPicker is a modal that needs filesystem API — stub it out
vi.mock('../components/settings/DirPicker', () => ({
  default: ({
    onSelect,
    onClose,
  }: {
    onSelect: (p: string) => void
    onClose: () => void
  }) => (
    <div data-testid="dir-picker">
      <button onClick={() => onSelect('/selected/path')}>Select</button>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fetchSpy: any

function mockFetch(
  overrides: {
    shelves?: object
    scanStatus?: object
  } = {}
) {
  return vi.spyOn(global, 'fetch').mockImplementation((url, opts) => {
    const u = url.toString()
    const method =
      (opts as RequestInit | undefined)?.method?.toUpperCase() ?? 'GET'

    if (u.includes('/api/shelves') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () =>
          overrides.shelves ?? {
            id: 1,
            name: 'Library',
            path: '/shelves/library',
          },
      }) as Promise<Response>
    }
    if (u.includes('/api/import/scan') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 202,
        json: async () => null,
      }) as Promise<Response>
    }
    if (u.includes('/api/import/status')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          overrides.scanStatus ?? {
            is_running: false,
            last_scan_at: null,
            progress: {
              total: 5,
              processed: 5,
              created: 5,
              updated: 0,
              skipped: 0,
              errors: 0,
            },
            error: null,
          },
      }) as Promise<Response>
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => null,
    }) as Promise<Response>
  })
}

function renderWizard(onComplete = vi.fn()) {
  return render(
    <MemoryRouter>
      <SetupWizard onComplete={onComplete} />
    </MemoryRouter>
  )
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('SetupWizard', () => {
  beforeEach(() => {
    fetchSpy = mockFetch()
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    mockNavigate.mockReset()
  })

  it('renders step 1 by default', () => {
    renderWizard()
    expect(screen.getByTestId('setup-wizard')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument()
  })

  it('shows step indicator with 4 steps', () => {
    renderWizard()
    expect(screen.getByText('Default Shelf')).toBeInTheDocument()
    expect(screen.getByText('Sync Shelf')).toBeInTheDocument()
    expect(screen.getByText('Template')).toBeInTheDocument()
    expect(screen.getByText('Initial Scan')).toBeInTheDocument()
  })

  it('next button disabled when fields are empty', () => {
    renderWizard()
    expect(screen.getByTestId('wizard-next-btn')).toBeDisabled()
  })

  it('next button enabled when name and path are filled', async () => {
    renderWizard()
    await userEvent.type(screen.getByTestId('wizard-shelf-name'), 'Library')
    await userEvent.type(
      screen.getByTestId('wizard-shelf-path'),
      '/shelves/library'
    )
    expect(screen.getByTestId('wizard-next-btn')).toBeEnabled()
  })

  it('step 1 → step 2 after successful shelf creation', async () => {
    renderWizard()
    await userEvent.type(screen.getByTestId('wizard-shelf-name'), 'Library')
    await userEvent.type(
      screen.getByTestId('wizard-shelf-path'),
      '/shelves/library'
    )
    await userEvent.click(screen.getByTestId('wizard-next-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument()
    )
  })

  it('skip in step 2 advances to step 3', async () => {
    renderWizard()
    // Advance to step 2
    await userEvent.type(screen.getByTestId('wizard-shelf-name'), 'Library')
    await userEvent.type(
      screen.getByTestId('wizard-shelf-path'),
      '/shelves/library'
    )
    await userEvent.click(screen.getByTestId('wizard-next-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-2'))

    await userEvent.click(screen.getByTestId('wizard-skip-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
    )
  })

  it('step 3 shows template input and live example path', async () => {
    renderWizard()
    // Advance to step 2 then skip
    await userEvent.type(screen.getByTestId('wizard-shelf-name'), 'Library')
    await userEvent.type(
      screen.getByTestId('wizard-shelf-path'),
      '/shelves/library'
    )
    await userEvent.click(screen.getByTestId('wizard-next-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-2'))
    await userEvent.click(screen.getByTestId('wizard-skip-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-3'))

    expect(screen.getByTestId('wizard-template-input')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-example-path')).toBeInTheDocument()
  })

  it('template live preview updates as user types', async () => {
    renderWizard()
    await userEvent.type(screen.getByTestId('wizard-shelf-name'), 'Library')
    await userEvent.type(
      screen.getByTestId('wizard-shelf-path'),
      '/shelves/library'
    )
    await userEvent.click(screen.getByTestId('wizard-next-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-2'))
    await userEvent.click(screen.getByTestId('wizard-skip-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-3'))

    const input = screen.getByTestId('wizard-template-input')
    await userEvent.clear(input)
    await userEvent.type(input, '{{title}')
    await waitFor(() =>
      expect(screen.getByTestId('wizard-example-path').textContent).toContain(
        'The Way of Kings'
      )
    )
  })

  it('step 3 → step 4 (scan) on Start Scan click', async () => {
    renderWizard()
    await userEvent.type(screen.getByTestId('wizard-shelf-name'), 'Library')
    await userEvent.type(
      screen.getByTestId('wizard-shelf-path'),
      '/shelves/library'
    )
    await userEvent.click(screen.getByTestId('wizard-next-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-2'))
    await userEvent.click(screen.getByTestId('wizard-skip-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-3'))
    await userEvent.click(screen.getByTestId('wizard-next-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('wizard-step-4')).toBeInTheDocument()
    )
  })

  it('scan step starts scan and enables finish button when done', async () => {
    renderWizard()
    await userEvent.type(screen.getByTestId('wizard-shelf-name'), 'Library')
    await userEvent.type(
      screen.getByTestId('wizard-shelf-path'),
      '/shelves/library'
    )
    await userEvent.click(screen.getByTestId('wizard-next-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-2'))
    await userEvent.click(screen.getByTestId('wizard-skip-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-3'))
    await userEvent.click(screen.getByTestId('wizard-next-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-4'))

    await waitFor(() =>
      expect(screen.getByTestId('wizard-finish-btn')).toBeEnabled()
    )
  })

  it('finish navigates to /library and calls onComplete', async () => {
    const onComplete = vi.fn()
    renderWizard(onComplete)
    await userEvent.type(screen.getByTestId('wizard-shelf-name'), 'Library')
    await userEvent.type(
      screen.getByTestId('wizard-shelf-path'),
      '/shelves/library'
    )
    await userEvent.click(screen.getByTestId('wizard-next-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-2'))
    await userEvent.click(screen.getByTestId('wizard-skip-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-3'))
    await userEvent.click(screen.getByTestId('wizard-next-btn'))
    await waitFor(() => screen.getByTestId('wizard-step-4'))
    await waitFor(() =>
      expect(screen.getByTestId('wizard-finish-btn')).toBeEnabled()
    )
    await userEvent.click(screen.getByTestId('wizard-finish-btn'))
    expect(onComplete).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/library')
  })

  it('dir picker sets path value', async () => {
    renderWizard()
    await userEvent.click(screen.getByTitle('Browse'))
    await waitFor(() => screen.getByTestId('dir-picker'))
    await userEvent.click(screen.getByText('Select'))
    await waitFor(() =>
      expect(
        (screen.getByTestId('wizard-shelf-path') as HTMLInputElement).value
      ).toBe('/selected/path')
    )
  })
})
