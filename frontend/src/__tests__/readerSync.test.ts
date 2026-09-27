import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PositionSaver,
  SessionTracker,
  positionFromRelocate,
} from '../reader/sync'
import type { RelocateDetail } from '../reader/foliate'

function okFetch(body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response)
}

describe('positionFromRelocate', () => {
  it('turns the visible range into a KOReader XPointer', () => {
    const doc = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>One</p><p>Two</p></body></html>',
      'application/xhtml+xml'
    )
    const range = doc.createRange()
    range.setStart(doc.querySelectorAll('p')[1].firstChild!, 1)
    const detail = {
      fraction: 0.4213,
      section: { current: 6, total: 20 },
      cfi: 'epubcfi(/6/14!/4/4,/1:1)',
      range,
    } as RelocateDetail
    expect(positionFromRelocate(detail)).toEqual({
      progress: '/body/DocFragment[7]/body/p[2]/text().1',
      percentage: 0.4213,
      locator: 'epubcfi(/6/14!/4/4,/1:1)',
    })
  })
})

describe('PositionSaver', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces page turns into one save of the latest position', async () => {
    const fetcher = okFetch({ timestamp: 1700 })
    const saver = new PositionSaver('b1', 1000, fetcher)
    const onSaved = vi.fn()
    saver.onSaved = onSaved
    saver.queue({ progress: 'a', percentage: 0.1, locator: 'x' })
    saver.queue({ progress: 'b', percentage: 0.2, locator: 'y' })
    expect(fetcher).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/books/b1/position')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({
      progress: 'b',
      percentage: 0.2,
      locator: 'y',
    })
    expect(saver.lastSavedAt).toBe(1700)
    expect(onSaved).toHaveBeenCalled()
  })

  it('flushes immediately with keepalive when the tab closes', async () => {
    const fetcher = okFetch()
    const saver = new PositionSaver('b1', 1000, fetcher)
    saver.queue({ progress: 'a', percentage: 0.1, locator: 'x' })
    await saver.flush(true)
    expect(fetcher.mock.calls[0][1].keepalive).toBe(true)
    await saver.flush() // nothing pending
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed save for the next attempt', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true, json: async () => ({ timestamp: 5 }) })
    const saver = new PositionSaver('b1', 1000, fetcher)
    saver.onError = vi.fn()
    saver.queue({ progress: 'a', percentage: 0.1, locator: 'x' })
    await saver.flush()
    expect(saver.onError).toHaveBeenCalled()
    await saver.flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(saver.lastSavedAt).toBe(5)
  })
})

describe('SessionTracker', () => {
  it('counts active time only, and re-sends one growing session', async () => {
    let t = Date.parse('2026-09-28T10:00:00Z')
    const fetcher = okFetch()
    const tracker = new SessionTracker('b1', () => t, 5 * 60_000, fetcher)

    t += 20_000
    tracker.activity(true)
    await tracker.flush()
    expect(fetcher).not.toHaveBeenCalled() // under 30 seconds

    t += 40_000
    tracker.activity(true)
    await tracker.flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      start_time: '2026-09-28T10:00:00.000Z',
      duration: 60,
      pages_read: 2,
    })

    // Idle for 20 minutes: none of it counts.
    t += 20 * 60_000
    tracker.tick()
    expect(tracker.activeSeconds).toBe(60)
    await tracker.flush()
    expect(fetcher).toHaveBeenCalledTimes(1) // unchanged, not re-sent

    // Hidden tab doesn't count either.
    tracker.activity()
    t += 60_000
    tracker.tick(false)
    expect(tracker.activeSeconds).toBe(60)
  })
})
