import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useApi } from '../hooks/useApi'

describe('useApi', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('returns loading=true initially', () => {
    fetchSpy.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useApi('/api/health'))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
  })

  it('returns data on success', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    })
    const { result } = renderHook(() => useApi('/api/health'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ status: 'ok' })
    expect(result.current.error).toBeNull()
  })

  it('returns error on failure', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'Server error' }),
    })
    const { result } = renderHook(() => useApi('/api/broken'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeTruthy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result.current.error as any).status).toBe(500)
  })

  it('skips fetch when path is null', () => {
    const { result } = renderHook(() => useApi(null))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('re-fetches when path changes', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 1 }),
    })
    const { rerender } = renderHook(({ path }: { path: string }) => useApi(path), {
      initialProps: { path: '/api/books/1' },
    })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    rerender({ path: '/api/books/2' })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
  })
})
