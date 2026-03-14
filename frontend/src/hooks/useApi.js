import { useState, useEffect } from 'react'
import { api } from '../api/client'

/**
 * Fetch data from a GET endpoint. Re-fetches when `path` changes.
 * Pass null/undefined to skip fetching (e.g. when an id isn't ready yet).
 */
export function useApi(path) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(!!path)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!path) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .get(path)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e); setLoading(false) } })
    return () => { cancelled = true }
  }, [path])

  return { data, loading, error }
}
