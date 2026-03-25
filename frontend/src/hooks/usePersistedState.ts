import { useState, useCallback } from 'react'

/**
 * Like useState but persists to localStorage under the given key.
 * Values are JSON-serialized so null, booleans, and strings all work.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return defaultValue
      return JSON.parse(raw) as T
    } catch {
      // Backward compat: old values stored as raw strings (e.g. 'true')
      const raw = localStorage.getItem(key)
      if (raw === 'true') return true as T
      if (raw === 'false') return false as T
      return (raw ?? defaultValue) as T
    }
  })

  const setPersistedState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next =
          typeof value === 'function' ? (value as (p: T) => T)(prev) : value
        if (next === null || next === undefined) {
          localStorage.removeItem(key)
        } else {
          localStorage.setItem(key, JSON.stringify(next))
        }
        return next
      })
    },
    [key]
  )

  return [state, setPersistedState]
}
