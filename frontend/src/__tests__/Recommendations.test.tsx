import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Recommendations from '../pages/Recommendations'
import RecommendationSettings from '../components/settings/RecommendationSettings'
import type {
  Recommendation,
  RecommendationsResponse,
  RecommendationSettingsResponse,
} from '../types/api'

const run = {
  id: 1,
  status: 'done' as const,
  model: 'google/gemini-3.8-flash',
  web_search: true,
  error: null,
  input_tokens: 9800,
  output_tokens: 1200,
  web_searches: 3,
  cost: 0.0123,
  started_at: '2026-10-13T10:00:00',
  finished_at: '2026-10-13T10:01:00',
}

function pick(over: Partial<Recommendation>): Recommendation {
  return {
    id: 1,
    book: null,
    title: 'Title',
    author: 'Author',
    format: 'book',
    site: null,
    reason: 'Because.',
    source_url: null,
    feedback: null,
    ...over,
  }
}

function state(): RecommendationsResponse {
  return {
    enabled: true,
    settings: {
      model: 'google/gemini-3.8-flash',
      web_search: true,
      share_notes: false,
      weekly: false,
      discover_kinds: 'both',
    },
    read_next: {
      run,
      running: false,
      items: [
        pick({
          id: 1,
          title: 'Saga Two',
          reason: 'You loved Saga One.',
          book: {
            id: 'b2',
            cover_path: null,
            series_name: 'The Saga',
            series_sequence: 2,
            progress: null,
          },
        }),
      ],
    },
    discover: {
      run: { ...run, id: 2 },
      running: false,
      items: [
        pick({
          id: 10,
          title: 'Mother of Learning',
          author: 'nobody103',
          format: 'web_serial',
          site: 'Royal Road',
          reason: 'Time loops like The Hundred Reigns.',
          source_url: 'https://www.royalroad.com/fiction/21220',
        }),
        pick({ id: 11, title: 'Cradle', author: 'Will Wight' }),
        pick({ id: 12, title: 'Hidden', feedback: 'not_interested' }),
      ],
    },
    saved: [],
  }
}

describe('Recommendations page', () => {
  let data: RecommendationsResponse
  let calls: { url: string; method: string; body: unknown }[]
  let fetchSpy: { mockRestore: () => void }

  beforeEach(() => {
    localStorage.clear()
    data = state()
    calls = []
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      const u = url.toString()
      const method = (opts?.method ?? 'GET').toUpperCase()
      const sent = opts?.body ? JSON.parse(opts.body as string) : null
      calls.push({ url: u, method, body: sent })
      let body: unknown = {}
      let status = 200
      if (u === '/api/recommendations') body = data
      else if (u.startsWith('/api/recommendations/prompt'))
        body = {
          kind: 'discover',
          model: 'google/gemini-3.8-flash',
          web_search: true,
          system: 'You are a librarian.',
          user: '## Reading history\n- The Saga — Ann Author',
          schema: { type: 'object' },
          tools: [{ type: 'openrouter:web_search' }],
          approx_tokens: 6100,
        }
      else if (u === '/api/zlibrary/status')
        body = {
          enabled: false,
          domain: 'z-library.hn',
          downloads_today: null,
          downloads_limit: null,
          error: null,
        }
      else if (u === '/api/recommendations/refresh') {
        status = 202
        data = {
          ...data,
          read_next: { ...data.read_next, running: true },
          discover: { ...data.discover, running: true },
        }
        body = { started: ['read_next', 'discover'] }
      } else if (u.endsWith('/feedback') && method === 'POST') {
        const id = Number(u.split('/')[3])
        data = {
          ...data,
          discover: {
            ...data.discover,
            items: data.discover.items.map((i) =>
              i.id === id ? { ...i, feedback: sent.verdict } : i
            ),
          },
        }
        body = { verdict: sent.verdict }
      }
      return Promise.resolve({
        ok: true,
        status,
        json: async () => body,
      } as Response)
    })
  })

  afterEach(() => fetchSpy.mockRestore())

  const renderPage = () =>
    render(
      <MemoryRouter>
        <Recommendations />
      </MemoryRouter>
    )

  it('shows read next picks with their reasons and run info', async () => {
    renderPage()
    expect(await screen.findByText('Saga Two')).toBeInTheDocument()
    expect(screen.getByText('You loved Saga One.')).toBeInTheDocument()
    expect(screen.getByText(/The Saga #2/)).toBeInTheDocument()
    expect(screen.getByTestId('run-info')).toHaveTextContent(
      '9.8k in / 1.2k out'
    )
    expect(screen.getByTestId('run-info')).toHaveTextContent('$0.012')
  })

  it('lists discover picks with links and hides turned-down ones', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Discover' }))
    expect(await screen.findAllByTestId('discover-item')).toHaveLength(2)
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Royal Road/ })).toHaveAttribute(
      'href',
      'https://www.royalroad.com/fiction/21220'
    )
    // Z-Library isn't set up in Shelfloom: link to its search instead.
    expect(screen.getByRole('link', { name: /Z-Library/ })).toHaveAttribute(
      'href',
      'https://z-library.hn/s/Cradle%20Will%20Wight'
    )
  })

  it('sends feedback and offers an undo', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Discover' }))
    const items = await screen.findAllByTestId('discover-item')
    fireEvent.click(
      items[1].querySelector('button[title^="The book"]') as HTMLElement
    )
    await waitFor(() =>
      expect(screen.getAllByTestId('discover-item')).toHaveLength(1)
    )
    const feedback = calls.find((c) => c.url.endsWith('/feedback'))
    expect(feedback?.url).toBe('/api/recommendations/11/feedback')
    expect(feedback?.body).toEqual({ verdict: 'not_found' })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(screen.getAllByTestId('discover-item')).toHaveLength(2)
    )
  })

  it('refreshes and shows progress', async () => {
    renderPage()
    fireEvent.click(await screen.findByTestId('refresh-all'))
    expect(await screen.findByTestId('recs-running')).toBeInTheDocument()
    expect(
      calls.find((c) => c.url === '/api/recommendations/refresh')?.body
    ).toEqual({ kind: 'all' })
  })

  it('shows the last error and keeps the old picks', async () => {
    data.read_next.run = { ...run, status: 'error', error: 'No credits' }
    renderPage()
    expect(await screen.findByTestId('recs-error')).toHaveTextContent(
      'No credits'
    )
    expect(screen.getByText('Saga Two')).toBeInTheDocument()
  })

  it('shows the prompt and copies it', async () => {
    const exec = vi.fn(() => true)
    document.execCommand = exec
    let copied = ''
    const append = document.body.appendChild.bind(document.body)
    const spy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation(<T extends Node>(n: T) => {
        if (n instanceof HTMLTextAreaElement) copied = n.value
        return append(n)
      })
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Discover' }))
    fireEvent.click(await screen.findByTestId('view-prompt'))
    expect(await screen.findByTestId('prompt-user')).toHaveTextContent(
      'The Saga — Ann Author'
    )
    expect(
      calls.some((c) => c.url === '/api/recommendations/prompt?kind=discover')
    ).toBe(true)
    expect(screen.getByTestId('prompt-meta')).toHaveTextContent(
      'about 6.1k tokens · web search on'
    )
    fireEvent.click(screen.getByRole('button', { name: /Copy prompt/ }))
    await waitFor(() => expect(exec).toHaveBeenCalledWith('copy'))
    expect(copied).toBe(
      'You are a librarian.\n\n## Reading history\n- The Saga — Ann Author'
    )
    expect(await screen.findByText('Copied')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Copy full request/ }))
    await waitFor(() =>
      expect(JSON.parse(copied).tools[0].type).toBe('openrouter:web_search')
    )
    spy.mockRestore()
  })

  it('explains how to turn it on', async () => {
    data = { ...state(), enabled: false }
    renderPage()
    expect(await screen.findByTestId('recs-disabled')).toHaveTextContent(
      'OPENROUTER_API_KEY'
    )
    expect(screen.getByTestId('refresh-all')).toBeDisabled()
  })
})

describe('RecommendationSettings', () => {
  let settings: RecommendationSettingsResponse
  let puts: unknown[]
  let fetchSpy: { mockRestore: () => void }

  beforeEach(() => {
    puts = []
    settings = {
      enabled: true,
      default_model: 'google/gemini-3.8-flash',
      settings: {
        model: 'google/gemini-3.8-flash',
        web_search: true,
        share_notes: false,
        weekly: false,
        discover_kinds: 'both',
      },
    }
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      const u = url.toString()
      let body: unknown = settings
      if (u === '/api/recommendations/models')
        body = {
          models: [
            {
              id: 'google/gemini-3.8-flash',
              name: 'Gemini 3.8 Flash',
              context_length: 1000000,
              input_price: 0.75,
              output_price: 3.75,
              structured_outputs: true,
              tools: true,
            },
          ],
        }
      else if (opts?.method === 'PUT') {
        const sent = JSON.parse(opts.body as string)
        puts.push(sent)
        settings = { ...settings, settings: { ...settings.settings, ...sent } }
        body = settings
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => body,
      } as Response)
    })
  })

  afterEach(() => fetchSpy.mockRestore())

  it('shows the model price and saves toggles and the model', async () => {
    render(<RecommendationSettings />)
    expect(await screen.findByTestId('rec-model-info')).toHaveTextContent(
      '$0.75 in / $3.75 out'
    )
    fireEvent.click(
      screen.getByRole('switch', { name: 'Share reviews and highlights' })
    )
    await waitFor(() => expect(puts).toEqual([{ share_notes: true }]))
    expect(
      screen.getByRole('switch', { name: 'Share reviews and highlights' })
    ).toHaveAttribute('aria-checked', 'true')

    fireEvent.change(screen.getByLabelText('MODEL'), {
      target: { value: 'anthropic/claude-sonnet-5.5' },
    })
    expect(screen.getByTestId('rec-model-info')).toHaveTextContent(
      'Not a model OpenRouter lists.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(puts[1]).toEqual({ model: 'anthropic/claude-sonnet-5.5' })
    )
  })
})
