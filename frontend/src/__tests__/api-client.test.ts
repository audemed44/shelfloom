import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api } from '../api/client'

describe('api client', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('GET requests the correct path', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    })

    const result = await api.get('/api/health')
    expect(fetchSpy).toHaveBeenCalledWith('/api/health', expect.any(Object))
    expect(result).toEqual({ status: 'ok' })
  })

  it('throws on non-OK response', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Not found' }),
    })

    await expect(api.get('/api/missing')).rejects.toThrow('API error: 404')
  })

  it('attaches status and data to thrown error', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'Validation error' }),
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let err: any
    try {
      await api.get('/api/books')
    } catch (e) {
      err = e
    }

    expect(err.status).toBe(422)
    expect(err.data).toEqual({ detail: 'Validation error' })
  })

  it('returns null for 204 responses', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => null,
    })

    const result = await api.delete('/api/books/1')
    expect(result).toBeNull()
  })

  it('POST sends JSON body with correct Content-Type', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 1 }),
    })

    await api.post('/api/shelves', { name: 'Test' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [, options]: [string, any] = fetchSpy.mock.calls[0]
    expect(options.method).toBe('POST')
    expect(options.body).toBe(JSON.stringify({ name: 'Test' }))
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  it('upload sends FormData without overriding Content-Type', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 2 }),
    })

    const formData = new FormData()
    formData.append(
      'file',
      new Blob(['data'], { type: 'application/epub+zip' }),
      'book.epub'
    )

    await api.upload('/api/books', formData)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [, options]: [string, any] = fetchSpy.mock.calls[0]
    expect(options.body).toBe(formData)
    expect(options.headers['Content-Type']).toBeUndefined()
  })

  it('PATCH sends JSON body', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 1, title: 'Updated' }),
    })

    await api.patch('/api/books/1', { title: 'Updated' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [, options]: [string, any] = fetchSpy.mock.calls[0]
    expect(options.method).toBe('PATCH')
    expect(options.body).toBe(JSON.stringify({ title: 'Updated' }))
  })
})
