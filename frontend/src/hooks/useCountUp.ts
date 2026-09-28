import { useEffect, useState } from 'react'

export function prefersMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Animates a number from 0 → target once it becomes known. With `enabled`
 * false (or reduced motion) it returns the target straight away.
 */
export function useCountUp(
  target: number | null,
  durationMs = 900,
  enabled = true
): number | null {
  const animate = enabled && prefersMotion()
  const [value, setValue] = useState<number | null>(
    target == null || !animate ? target : 0
  )

  useEffect(() => {
    if (target == null) {
      setValue(null)
      return
    }
    if (!animate || typeof requestAnimationFrame === 'undefined') {
      setValue(target)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs, animate])

  return value
}
