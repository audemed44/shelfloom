import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  List,
  Loader2,
  RefreshCw,
  Type,
  X,
} from 'lucide-react'
import { api } from '../api/client'
import type { Book } from '../types'
import {
  createFoliateView,
  loadFoliate,
  type FoliateView,
  type RelocateDetail,
  type TocItem,
} from '../reader/foliate'
import {
  PositionSaver,
  SessionTracker,
  positionFromRelocate,
  type BookPosition,
} from '../reader/sync'
import { resolveXPointer, sectionIndexOf } from '../reader/xpointer'

type Theme = 'light' | 'sepia' | 'dark'
type FontFamily = 'serif' | 'sans'

interface ReaderPrefs {
  theme: Theme
  fontSize: number // percent
  font: FontFamily
}

const PREFS_KEY = 'shelfloom.reader.prefs'
const DEFAULT_PREFS: ReaderPrefs = {
  theme: 'light',
  fontSize: 100,
  font: 'serif',
}

const THEMES: Record<
  Theme,
  { bg: string; fg: string; link: string; label: string }
> = {
  light: { bg: '#ffffff', fg: '#111111', link: '#2563ff', label: 'Light' },
  sepia: { bg: '#f4ecd8', fg: '#3b2f1e', link: '#8a4b12', label: 'Sepia' },
  dark: { bg: '#000000', fg: '#e8e8e8', link: '#7aa2ff', label: 'Dark' },
}

function readPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

function writePrefs(prefs: ReaderPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage unavailable: settings last for this visit only.
  }
}

function bookCss({ theme, fontSize, font }: ReaderPrefs): string {
  const t = THEMES[theme]
  const family =
    font === 'serif'
      ? 'Georgia, "Iowan Old Style", "Palatino Linotype", serif'
      : 'Inter, system-ui, -apple-system, sans-serif'
  return `
    html { color-scheme: ${theme === 'dark' ? 'dark' : 'light'}; }
    html, body { background: ${t.bg} !important; color: ${t.fg} !important; }
    body { font-size: ${fontSize}% !important; }
    body, p, li, blockquote, dd, div, span { font-family: ${family} !important; }
    body *:not(a) { color: inherit !important; background-color: transparent !important; }
    a:link, a:visited { color: ${t.link} !important; }
    p, li, blockquote, dd {
      line-height: 1.55;
      hyphens: auto;
      -webkit-hyphens: auto;
      widows: 2;
      orphans: 2;
    }
    img, svg { max-width: 100%; }
    pre { white-space: pre-wrap !important; }
  `
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

const pct = (f: number) => `${Math.round((Number.isFinite(f) ? f : 0) * 100)}%`

type SyncState = 'idle' | 'saving' | 'saved' | 'offline'

/** A position from another device that is newer than what we're showing. */
interface RemotePrompt {
  position: BookPosition
}

export default function Reader() {
  const { id } = useParams<{ id: string }>()
  const bookId = id ?? ''
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const saverRef = useRef<PositionSaver | null>(null)
  const trackerRef = useRef<SessionTracker | null>(null)
  // Positions KOReader or we saved; used to spot newer ones from a device.
  const knownTimestampRef = useRef(0)
  // Don't save the position we just restored: only the reader's own moves.
  const userMovedRef = useRef(false)

  const [book, setBook] = useState<Book | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [location, setLocation] = useState<RelocateDetail | null>(null)
  const [toc, setToc] = useState<TocItem[]>([])
  const [panel, setPanel] = useState<'toc' | 'settings' | null>(null)
  const [chrome, setChrome] = useState(true)
  const [prefs, setPrefs] = useState<ReaderPrefs>(readPrefs)
  const [sync, setSync] = useState<SyncState>('idle')
  const [resumedFrom, setResumedFrom] = useState<BookPosition | null>(null)
  const [remote, setRemote] = useState<RemotePrompt | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)

  const goToPosition = useCallback(async (position: BookPosition) => {
    const view = viewRef.current
    if (!view) return
    if (position.from_web_reader && position.locator) {
      await view.init({ lastLocation: position.locator })
      return
    }
    const index = sectionIndexOf(position.progress)
    if (index != null && index < view.book.sections.length) {
      await view.renderer.goTo({
        index,
        anchor: (doc) => {
          const r = resolveXPointer(doc, position.progress)
          if (!r) return doc.body
          if (r.node.nodeType === Node.TEXT_NODE) {
            const range = doc.createRange()
            const text = r.node as Text
            range.setStart(text, r.offset)
            range.setEnd(text, Math.min(r.offset + 1, text.data.length))
            return range
          }
          return r.node as Element
        },
      })
      return
    }
    await view.init({ lastLocation: { fraction: position.percentage } })
  }, [])

  // Open the book.
  useEffect(() => {
    if (!bookId || !hostRef.current) return
    let cancelled = false
    const host = hostRef.current
    const saver = new PositionSaver(bookId)
    const tracker = new SessionTracker(bookId)
    saverRef.current = saver
    trackerRef.current = tracker
    saver.onSaved = (saved) => {
      knownTimestampRef.current = saved.timestamp
      setSync('saved')
    }
    saver.onError = () => setSync('offline')

    const open = async () => {
      try {
        const [meta] = await Promise.all([
          api.get<Book>(`/api/books/${bookId}`),
          loadFoliate(),
        ])
        if (cancelled) return
        setBook(meta)
        if (meta && meta.format !== 'epub') {
          throw new Error('Only EPUB books can be read in the browser.')
        }
        const res = await fetch(`/api/books/${bookId}/download`)
        if (!res.ok) throw new Error('Could not load the book file.')
        const blob = await res.blob()
        const file = new File([blob], 'book.epub', {
          type: 'application/epub+zip',
        })
        if (cancelled) return

        const view = createFoliateView()
        view.style.width = '100%'
        view.style.height = '100%'
        view.style.display = 'block'
        host.replaceChildren(view)
        viewRef.current = view
        await view.open(file)
        if (cancelled) return
        view.renderer.setAttribute('flow', 'paginated')
        view.renderer.setAttribute('margin', '48px')
        view.renderer.setAttribute('gap', '6%')
        view.renderer.setAttribute('max-inline-size', '680px')
        view.renderer.setAttribute('max-column-count', '2')
        view.renderer.setStyles?.(bookCss(readPrefs()))
        setToc(view.book.toc ?? [])

        view.addEventListener('relocate', (e) => {
          const detail = (e as CustomEvent<RelocateDetail>).detail
          setLocation(detail)
          if (!userMovedRef.current) return
          tracker.activity(true)
          setSync('saving')
          saver.queue(positionFromRelocate(detail))
        })
        view.addEventListener('load', (e) => {
          const { doc } = (e as CustomEvent<{ doc: Document }>).detail
          doc.addEventListener('keydown', onKey)
          doc.addEventListener('click', (ev) => onFrameClick(ev, doc))
          // Swipes and scrolling are handled by foliate; they still count as
          // the reader moving, so the new position gets saved.
          const markUser = () => (userMovedRef.current = true)
          doc.addEventListener('touchstart', markUser, { passive: true })
          doc.addEventListener('wheel', markUser, { passive: true })
        })

        const position = await api
          .get<BookPosition | null>(`/api/books/${bookId}/position`)
          .catch(() => null)
        if (cancelled) return
        if (position) {
          knownTimestampRef.current = position.timestamp
          await goToPosition(position)
          if (!position.from_web_reader) setResumedFrom(position)
        } else {
          await view.init({ showTextStart: true })
        }
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : 'Could not open the book.'
        )
        setStatus('error')
      }
    }
    void open()

    return () => {
      cancelled = true
      void saver.flush(true)
      saver.dispose()
      tracker.tick(document.visibilityState === 'visible')
      void tracker.flush(true)
      viewRef.current?.close()
      viewRef.current = null
    }
    // onKey/onFrameClick only use refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, goToPosition])

  // Apply display settings.
  useEffect(() => {
    writePrefs(prefs)
    viewRef.current?.renderer?.setStyles?.(bookCss(prefs))
  }, [prefs])

  const turn = useCallback((dir: 'prev' | 'next') => {
    const view = viewRef.current
    if (!view) return
    userMovedRef.current = true
    void (dir === 'next' ? view.goRight() : view.goLeft())
  }, [])

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault()
      turn('next')
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault()
      turn('prev')
    }
  }

  // Tap the left or right third of the page to turn; the middle toggles the bars.
  function onFrameClick(ev: MouseEvent, doc: Document) {
    if ((ev.target as Element | null)?.closest?.('a[href]')) return
    if (doc.getSelection()?.toString()) return
    const frame = doc.defaultView?.frameElement
    const host = hostRef.current
    if (!frame || !host) return
    const x = frame.getBoundingClientRect().left + ev.clientX
    const box = host.getBoundingClientRect()
    const f = (x - box.left) / box.width
    if (f < 0.3) turn('prev')
    else if (f > 0.7) turn('next')
    else setChrome((c) => !c)
  }

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reading time, and checking whether KOReader moved on while we were away.
  useEffect(() => {
    if (!bookId) return
    const checkRemote = async () => {
      const position = await api
        .get<BookPosition | null>(`/api/books/${bookId}/position`)
        .catch(() => null)
      if (
        !position ||
        position.from_web_reader ||
        position.timestamp <= knownTimestampRef.current
      )
        return
      knownTimestampRef.current = position.timestamp
      // KOReader saves when a book is closed even if the reader didn't move
      // on; don't offer to "go" to the page that's already showing.
      if (isOnCurrentPage(viewRef.current, position.progress)) return
      setRemote({ position })
    }
    const tick = setInterval(() => {
      trackerRef.current?.tick(document.visibilityState === 'visible')
    }, 15_000)
    const send = setInterval(() => void trackerRef.current?.flush(), 60_000)
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void checkRemote()
    }, 60_000)
    const onVisibility = () => {
      const tracker = trackerRef.current
      if (document.visibilityState === 'hidden') {
        tracker?.tick(true)
        void saverRef.current?.flush(true)
        void tracker?.flush(true)
      } else {
        tracker?.tick(false) // time away doesn't count
        tracker?.activity()
        void checkRemote()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(tick)
      clearInterval(send)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [bookId])

  useEffect(() => {
    if (!resumedFrom) return
    const t = setTimeout(() => setResumedFrom(null), 8000)
    return () => clearTimeout(t)
  }, [resumedFrom])

  const jumpToRemote = async () => {
    if (!remote) return
    knownTimestampRef.current = remote.position.timestamp
    userMovedRef.current = false
    await goToPosition(remote.position)
    setResumedFrom(remote.position)
    setRemote(null)
  }

  const dismissRemote = () => {
    if (remote) knownTimestampRef.current = remote.position.timestamp
    setRemote(null)
  }

  const goToToc = (href: string) => {
    userMovedRef.current = true
    void viewRef.current?.goTo(href)
    setPanel(null)
  }

  const rawFraction = scrub ?? location?.fraction ?? 0
  const fraction = Number.isFinite(rawFraction) ? rawFraction : 0
  const theme = THEMES[prefs.theme]
  const chapter = location?.tocItem?.label?.trim()

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col"
      style={{ background: theme.bg, color: theme.fg }}
      data-testid="reader"
    >
      {/* Top bar */}
      <header
        className={`flex h-12 shrink-0 items-center gap-2 border-b px-2 transition-opacity sm:px-4 ${
          chrome ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        style={{ borderColor: `${theme.fg}22` }}
      >
        <Link
          to={`/books/${bookId}`}
          className="flex min-w-0 items-center gap-2 px-2 py-1.5 text-sm font-semibold hover:opacity-70"
          aria-label="Back to book"
        >
          <ArrowLeft size={16} className="shrink-0" />
          <span className="truncate">{book?.title ?? 'Book'}</span>
        </Link>
        <span
          className="hidden min-w-0 flex-1 truncate text-center text-xs opacity-60 sm:block"
          data-testid="reader-chapter"
        >
          {chapter}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setPanel(panel === 'toc' ? null : 'toc')}
            className="grid size-9 place-items-center hover:opacity-70"
            aria-label="Contents"
          >
            <List size={17} />
          </button>
          <button
            onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
            className="grid size-9 place-items-center hover:opacity-70"
            aria-label="Display settings"
          >
            <Type size={17} />
          </button>
        </div>
      </header>

      {/* Newer position from KOReader */}
      {remote && (
        <div
          className="flex flex-wrap items-center gap-3 bg-primary px-4 py-2 text-sm text-white"
          data-testid="reader-remote-prompt"
        >
          <RefreshCw size={14} />
          <span className="flex-1">
            {remote.position.device} is at {pct(remote.position.percentage)} (
            {timeAgo(remote.position.timestamp)}).
          </span>
          <button
            onClick={jumpToRemote}
            className="bg-white px-3 py-1 text-xs font-semibold text-black"
          >
            Go there
          </button>
          <button
            onClick={dismissRemote}
            className="text-xs font-semibold text-white/80 hover:text-white"
          >
            Stay here
          </button>
        </div>
      )}

      {/* Where we picked up from (another device); hides itself */}
      {resumedFrom && status === 'ready' && !remote && (
        <div
          className="flex items-center justify-center gap-2 border-b px-4 py-1.5 text-xs"
          style={{ borderColor: `${theme.fg}22` }}
          data-testid="reader-resumed"
        >
          <RefreshCw size={11} className="opacity-60" />
          <span className="truncate">
            Continued from {resumedFrom.device} ·{' '}
            {timeAgo(resumedFrom.timestamp)}
          </span>
          <button
            onClick={() => setResumedFrom(null)}
            aria-label="Dismiss"
            className="opacity-60 hover:opacity-100"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Book */}
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0" />
        <button
          onClick={() => turn('prev')}
          className="absolute inset-y-0 left-0 hidden w-12 items-center justify-center opacity-30 hover:opacity-80 md:flex"
          aria-label="Previous page"
        >
          <ChevronLeft size={22} />
        </button>
        <button
          onClick={() => turn('next')}
          className="absolute inset-y-0 right-0 hidden w-12 items-center justify-center opacity-30 hover:opacity-80 md:flex"
          aria-label="Next page"
        >
          <ChevronRight size={22} />
        </button>

        {status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 className="animate-spin opacity-50" />
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="space-y-3">
              <AlertTriangle className="mx-auto opacity-50" />
              <p className="text-sm">{error}</p>
              <Link
                to={`/books/${bookId}`}
                className="text-sm font-semibold underline"
              >
                Back to the book
              </Link>
            </div>
          </div>
        )}

        {/* Contents */}
        {panel === 'toc' && (
          <aside
            className="absolute inset-y-0 right-0 z-10 w-full max-w-sm overflow-y-auto border-l"
            style={{ background: theme.bg, borderColor: `${theme.fg}22` }}
            data-testid="reader-toc"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest opacity-60">
                Contents
              </p>
              <button onClick={() => setPanel(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <TocList
              items={toc}
              current={location?.tocItem?.href}
              onPick={goToToc}
            />
          </aside>
        )}

        {/* Display settings */}
        {panel === 'settings' && (
          <aside
            className="absolute right-2 top-2 z-10 w-72 space-y-4 border p-4 shadow-lg"
            style={{ background: theme.bg, borderColor: `${theme.fg}33` }}
            data-testid="reader-settings"
          >
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest opacity-60">
                Theme
              </p>
              <div className="grid grid-cols-3 gap-1">
                {(Object.keys(THEMES) as Theme[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setPrefs((p) => ({ ...p, theme: t }))}
                    className="border py-2 text-xs font-semibold"
                    style={{
                      background: THEMES[t].bg,
                      color: THEMES[t].fg,
                      borderColor:
                        prefs.theme === t ? '#2563ff' : `${theme.fg}33`,
                      borderWidth: prefs.theme === t ? 2 : 1,
                    }}
                    aria-pressed={prefs.theme === t}
                  >
                    {THEMES[t].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest opacity-60">
                Text size · {prefs.fontSize}%
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setPrefs((p) => ({
                      ...p,
                      fontSize: Math.max(70, p.fontSize - 10),
                    }))
                  }
                  className="size-9 border text-sm"
                  style={{ borderColor: `${theme.fg}33` }}
                  aria-label="Smaller text"
                >
                  A−
                </button>
                <button
                  onClick={() =>
                    setPrefs((p) => ({
                      ...p,
                      fontSize: Math.min(200, p.fontSize + 10),
                    }))
                  }
                  className="size-9 border text-base font-semibold"
                  style={{ borderColor: `${theme.fg}33` }}
                  aria-label="Larger text"
                >
                  A+
                </button>
              </div>
            </div>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest opacity-60">
                Font
              </p>
              <div className="grid grid-cols-2 gap-1">
                {(['serif', 'sans'] as FontFamily[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setPrefs((p) => ({ ...p, font: f }))}
                    className="border py-2 text-sm"
                    style={{
                      fontFamily:
                        f === 'serif' ? 'Georgia, serif' : 'Inter, sans-serif',
                      borderColor:
                        prefs.font === f ? '#2563ff' : `${theme.fg}33`,
                      borderWidth: prefs.font === f ? 2 : 1,
                    }}
                    aria-pressed={prefs.font === f}
                  >
                    {f === 'serif' ? 'Serif' : 'Sans'}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Bottom bar */}
      <footer
        className={`shrink-0 border-t px-4 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 transition-opacity ${
          chrome ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        style={{ borderColor: `${theme.fg}22` }}
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={fraction}
          onChange={(e) => setScrub(parseFloat(e.target.value))}
          onPointerUp={() => {
            if (scrub == null) return
            userMovedRef.current = true
            void viewRef.current?.goToFraction(scrub)
            setScrub(null)
          }}
          onKeyUp={() => {
            if (scrub == null) return
            userMovedRef.current = true
            void viewRef.current?.goToFraction(scrub)
            setScrub(null)
          }}
          className="w-full accent-primary"
          aria-label="Position in book"
          disabled={status !== 'ready'}
        />
        <div className="mt-1 flex items-center justify-between gap-3 text-xs">
          <span
            className="tabular-nums font-semibold"
            data-testid="reader-percent"
          >
            {pct(fraction)}
          </span>
          <span className="truncate opacity-60 sm:hidden">{chapter}</span>
          <SyncBadge state={sync} />
        </div>
      </footer>
    </div>
  )
}

/** Whether a KOReader XPointer is on the page the reader is showing. */
function isOnCurrentPage(view: FoliateView | null, xpointer: string): boolean {
  const location = view?.lastLocation
  if (!location?.range) return false
  if (sectionIndexOf(xpointer) !== location.section.current) return false
  const doc = location.range.startContainer.ownerDocument
  if (!doc) return false
  const target = resolveXPointer(doc, xpointer)
  if (!target) return false
  try {
    return location.range.isPointInRange(target.node, target.offset)
  } catch {
    return false
  }
}

function SyncBadge({ state }: { state: SyncState }) {
  if (state === 'idle')
    return <span className="whitespace-nowrap opacity-50">Sync on</span>
  if (state === 'saving')
    return (
      <span className="flex items-center gap-1 whitespace-nowrap opacity-60">
        <Loader2 size={11} className="animate-spin" />
        Saving
      </span>
    )
  if (state === 'offline')
    return (
      <span className="flex items-center gap-1 whitespace-nowrap text-accent">
        <CloudOff size={11} />
        Not saved — retrying
      </span>
    )
  return (
    <span
      className="flex items-center gap-1 whitespace-nowrap opacity-60"
      data-testid="reader-synced"
    >
      <Check size={11} />
      Saved for KOReader
    </span>
  )
}

function TocList({
  items,
  current,
  onPick,
  depth = 0,
}: {
  items: TocItem[]
  current?: string
  onPick: (href: string) => void
  depth?: number
}) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={`${item.href}-${i}`}>
          <button
            onClick={() => onPick(item.href)}
            className={`block w-full border-t px-4 py-2.5 text-left text-sm hover:opacity-70 ${
              current === item.href ? 'font-bold' : ''
            }`}
            style={{
              paddingLeft: 16 + depth * 16,
              borderColor: 'rgba(127,127,127,0.18)',
            }}
          >
            {item.label.trim()}
          </button>
          {item.subitems && item.subitems.length > 0 && (
            <TocList
              items={item.subitems}
              current={current}
              onPick={onPick}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  )
}
