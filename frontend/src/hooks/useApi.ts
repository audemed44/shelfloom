import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'

/**
 * Fetch data from a GET endpoint. Re-fetches when `path` changes.
 * Pass null/undefined to skip fetching (e.g. when an id isn't ready yet).
 *
 * `loading` is only true on the initial fetch (data is null). Subsequent
 * re-fetches keep stale data visible to avoid flicker.
 */
export function useApi<T>(path: string | null | undefined): {
  data: T | null
  loading: boolean
  error: Error | null
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!!path)
  const [error, setError] = useState<Error | null>(null)
  const hasData = useRef(false)

  useEffect(() => {
    if (!path) {
      setLoading(false)
      return
    }
    let cancelled = false
    // Only show loading spinner when we have no data yet (initial fetch)
    if (!hasData.current) {
      setLoading(true)
    }
    setError(null)
    api
      .get<T>(path)
      .then((d) => {
        if (!cancelled) {
          setData(d as T)
          hasData.current = true
          setLoading(false)
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return { data, loading, error }
}
