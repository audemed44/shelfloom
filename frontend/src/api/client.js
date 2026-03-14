const BASE_URL = import.meta.env?.VITE_API_URL ?? ''

async function request(path, options = {}) {
  const { body, ...fetchOptions } = options

  // Don't set Content-Type for FormData — browser sets it with boundary
  const headers =
    body instanceof FormData
      ? {}
      : { 'Content-Type': 'application/json' }

  const response = await fetch(`${BASE_URL}${path}`, {
    headers,
    body,
    ...fetchOptions,
  })

  if (!response.ok) {
    const error = new Error(`API error: ${response.status}`)
    error.status = response.status
    try {
      error.data = await response.json()
    } catch {
      error.data = null
    }
    throw error
  }

  if (response.status === 204) return null
  return response.json()
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) => request(path, { method: 'POST', body: formData }),
}
