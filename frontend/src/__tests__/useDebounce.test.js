import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebounce } from '../hooks/useDebounce'

describe('useDebounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('hello', 300))
    expect(result.current).toBe('hello')
  })

  it('does not update before the delay has passed', () => {
    const { result, rerender } = renderHook(({ val }) => useDebounce(val, 300), {
      initialProps: { val: 'a' },
    })
    rerender({ val: 'ab' })
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('a')
  })

  it('updates after the delay has passed', () => {
    const { result, rerender } = renderHook(({ val }) => useDebounce(val, 300), {
      initialProps: { val: 'a' },
    })
    rerender({ val: 'ab' })
    act(() => vi.advanceTimersByTime(300))
    expect(result.current).toBe('ab')
  })

  it('resets the timer on rapid changes', () => {
    const { result, rerender } = renderHook(({ val }) => useDebounce(val, 300), {
      initialProps: { val: 'a' },
    })
    rerender({ val: 'ab' })
    act(() => vi.advanceTimersByTime(200))
    rerender({ val: 'abc' })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe('a') // still original — timer reset
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('abc') // now settled
  })

  it('uses 300ms default delay', () => {
    const { result, rerender } = renderHook(({ val }) => useDebounce(val), {
      initialProps: { val: 'x' },
    })
    rerender({ val: 'y' })
    act(() => vi.advanceTimersByTime(299))
    expect(result.current).toBe('x')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe('y')
  })
})
