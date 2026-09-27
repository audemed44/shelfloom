/**
 * Saving reading positions and sessions from the web reader.
 *
 * Positions go to /api/books/{id}/position, the same store KOReader's
 * Progress sync plugin reads, as a KOReader XPointer plus the reader's own
 * EPUB CFI (for exact resume in the browser).
 */

import { xpointerFromRange } from './xpointer'
import type { RelocateDetail } from './foliate'

export interface BookPosition {
  progress: string
  percentage: number
  device: string
  device_id: string | null
  timestamp: number
  locator: string | null
  from_web_reader: boolean
}

export interface PositionUpdate {
  progress: string
  percentage: number
  locator: string
}

export function positionFromRelocate(detail: RelocateDetail): PositionUpdate {
  return {
    progress: xpointerFromRange(detail.range, detail.section.current),
    percentage: Math.min(1, Math.max(0, detail.fraction)),
    locator: detail.cfi,
  }
}

type Fetch = typeof fetch

function put(fetcher: Fetch, url: string, body: unknown, keepalive: boolean) {
  return fetcher(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Lets the request finish when the tab is closing.
    keepalive,
  })
}

/** Debounces position saves; flush() sends any pending one right away. */
export class PositionSaver {
  private pending: PositionUpdate | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Server timestamp of our last saved position. */
  lastSavedAt = 0
  onSaved?: (position: BookPosition) => void
  onError?: () => void

  constructor(
    private bookId: string,
    private delayMs = 1500,
    private fetcher: Fetch = (...args) => fetch(...args)
  ) {}

  queue(update: PositionUpdate) {
    this.pending = update
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.delayMs)
  }

  async flush(keepalive = false) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const update = this.pending
    if (!update) return
    this.pending = null
    try {
      const res = await put(
        this.fetcher,
        `/api/books/${this.bookId}/position`,
        update,
        keepalive
      )
      if (!res.ok) throw new Error(String(res.status))
      if (keepalive) return
      const saved = (await res.json()) as BookPosition
      this.lastSavedAt = saved.timestamp
      this.onSaved?.(saved)
    } catch {
      // Keep the newest position for the next attempt, unless a newer one came in.
      this.pending ??= update
      this.onError?.()
    }
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

/**
 * Counts active reading time for Shelfloom's reading stats.
 *
 * Time counts while the tab is visible and the reader turned a page or
 * interacted within the idle window. The session is re-sent with the same
 * start time as it grows, so the server keeps one row per sitting.
 */
export class SessionTracker {
  readonly startedAt: Date
  private activeMs = 0
  private lastTick: number
  private lastActivity: number
  private pages = 0
  private sentMs = 0

  constructor(
    private bookId: string,
    private now: () => number = Date.now,
    private idleMs = 5 * 60_000,
    private fetcher: Fetch = (...args) => fetch(...args)
  ) {
    const t = now()
    this.startedAt = new Date(t)
    this.lastTick = t
    this.lastActivity = t
  }

  /** Call on page turns and other reading activity. */
  activity(pageTurn = false) {
    this.tick()
    this.lastActivity = this.now()
    if (pageTurn) this.pages++
  }

  /** Accumulate time since the last tick if the reader is active. */
  tick(visible = true) {
    const t = this.now()
    const elapsed = t - this.lastTick
    this.lastTick = t
    if (visible && t - this.lastActivity <= this.idleMs)
      this.activeMs += elapsed
  }

  get activeSeconds() {
    return Math.floor(this.activeMs / 1000)
  }

  /** Send the session if it has grown; sittings under 30 seconds are skipped. */
  async flush(keepalive = false) {
    if (this.activeMs < 30_000 || this.activeMs === this.sentMs) return
    const activeMs = this.activeMs
    try {
      const res = await put(
        this.fetcher,
        `/api/books/${this.bookId}/web-session`,
        {
          start_time: this.startedAt.toISOString(),
          duration: Math.floor(activeMs / 1000),
          pages_read: this.pages,
        },
        keepalive
      )
      if (res.ok) this.sentMs = activeMs
    } catch {
      // Retried on the next flush.
    }
  }
}
