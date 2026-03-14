import type { ApiError } from '../types'

const BASE_URL = import.meta.env?.VITE_API_URL ?? ''

class ApiRequestError extends Error {
  status: number
  data: { detail?: string } | null

  constructor(status: number, data: { detail?: string } | null) {
    super(`API error: ${status}`)
    this.status = status
    this.data = data
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { body?: BodyInit | null } = {}
): Promise<T | null> {
  const { body, ...fetchOptions } = options

  // Don't set Content-Type for FormData — browser sets it with boundary
  const headers: HeadersInit =
    body instanceof FormData ? {} : { 'Content-Type': 'application/json' }

  const response = await fetch(`${BASE_URL}${path}`, {
    headers,
    body,
    ...fetchOptions,
  })

  if (!response.ok) {
    let data: { detail?: string } | null = null
    try {
      data = (await response.json()) as { detail?: string }
    } catch {
      data = null
    }
    throw new ApiRequestError(response.status, data)
  }

  if (response.status === 204) return null
  return response.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T = null>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', body: formData }),
}

export type { ApiError }
