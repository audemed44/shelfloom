import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePersistedState } from '../hooks/usePersistedState'

describe('usePersistedState', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns default value when localStorage is empty', () => {
    const { result } = renderHook(() => usePersistedState('test:key', 'grid'))
    expect(result.current[0]).toBe('grid')
  })

  it('reads existing JSON value from localStorage', () => {
    localStorage.setItem('test:key', JSON.stringify('list'))
    const { result } = renderHook(() => usePersistedState('test:key', 'grid'))
    expect(result.current[0]).toBe('list')
  })

  it('writes JSON to localStorage on state change', () => {
    const { result } = renderHook(() => usePersistedState('test:key', 'grid'))
    act(() => result.current[1]('list'))
    expect(result.current[0]).toBe('list')
    expect(localStorage.getItem('test:key')).toBe('"list"')
  })

  it('handles null values', () => {
    const { result } = renderHook(() =>
      usePersistedState<string | null>('test:status', null)
    )
    expect(result.current[0]).toBeNull()

    act(() => result.current[1]('reading'))
    expect(result.current[0]).toBe('reading')
    expect(localStorage.getItem('test:status')).toBe('"reading"')

    act(() => result.current[1](null))
    expect(result.current[0]).toBeNull()
    expect(localStorage.getItem('test:status')).toBeNull()
  })

  it('handles boolean values', () => {
    const { result } = renderHook(() => usePersistedState('test:flag', false))
    expect(result.current[0]).toBe(false)

    act(() => result.current[1](true))
    expect(result.current[0]).toBe(true)
    expect(localStorage.getItem('test:flag')).toBe('true')
  })

  it('reads legacy raw string booleans (backward compat)', () => {
    localStorage.setItem('test:flag', 'true')
    const { result } = renderHook(() => usePersistedState('test:flag', false))
    expect(result.current[0]).toBe(true)
  })

  it('supports functional updates', () => {
    const { result } = renderHook(() => usePersistedState('test:count', 'a'))
    act(() => result.current[1]((prev) => prev + 'b'))
    expect(result.current[0]).toBe('ab')
  })
})
