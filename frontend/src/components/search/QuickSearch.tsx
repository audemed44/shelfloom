import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { BookMarked, BookOpen, Loader2, Scroll, Search, X } from 'lucide-react'
import { api } from '../../api/client'
import { useDebounce } from '../../hooks/useDebounce'
import { getBookCoverUrl } from '../../utils/bookCover'
import type { Book, PaginatedResponse } from '../../types'
import type { WebSerial } from '../../types/api'

// ---------------------------------------------------------------------------
// Context — lets any nav element open the overlay
// ---------------------------------------------------------------------------

const QuickSearchContext = createContext<{ open: () => void }>({
  open: () => {},
})

export function useQuickSearch() {
  return useContext(QuickSearchContext)
}

interface SeriesNode {
  id: number
  name: string
  book_count?: number
  children?: SeriesNode[]
}

interface Result {
  key: string
  kind: 'book' | 'series' | 'serial'
  title: string
  subtitle: string | null
  to: string
  coverUrl: string | null
}

const KIND_LABEL: Record<Result['kind'], string> = {
  book: 'Books',
  series: 'Series',
  serial: 'Web Serials',
}

function flattenSeries(nodes: SeriesNode[]): SeriesNode[] {
  return nodes.flatMap((n) => [n, ...flattenSeries(n.children ?? [])])
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

function QuickSearchDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const debounced = useDebounce(query.trim(), 200)
  const [books, setBooks] = useState<Book[]>([])
  const [loadingBooks, setLoadingBooks] = useState(false)
  const [series, setSeries] = useState<SeriesNode[]>([])
  const [serials, setSerials] = useState<WebSerial[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    inputRef.current?.focus()
    // Series and serials are small lists — load once and filter locally.
    api
      .get<SeriesNode[]>('/api/series/tree')
      .then((d) => setSeries(flattenSeries(Array.isArray(d) ? d : [])))
      .catch(() => {})
    api
      .get<WebSerial[]>('/api/serials')
      .then((d) => setSerials(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!debounced) {
      setBooks([])
      return
    }
    let cancelled = false
    setLoadingBooks(true)
    const params = new URLSearchParams({
      search: debounced,
      per_page: '6',
      sort: 'title',
    })
    api
      .get<PaginatedResponse<Book>>(`/api/books?${params}`)
      .then((d) => {
        if (!cancelled) setBooks(d?.items ?? [])
      })
      .catch(() => {
        if (!cancelled) setBooks([])
      })
      .finally(() => {
        if (!cancelled) setLoadingBooks(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  const results = useMemo<Result[]>(() => {
    if (!debounced) return []
    const q = debounced.toLowerCase()
    const out: Result[] = books.map((b) => ({
      key: `book-${b.id}`,
      kind: 'book',
      title: b.title,
      subtitle: b.author,
      to: `/books/${b.id}`,
      coverUrl: getBookCoverUrl(b.id, b.cover_path),
    }))
    const seenSeries = new Set<number>()
    for (const s of series) {
      if (seenSeries.has(s.id) || !s.name.toLowerCase().includes(q)) continue
      seenSeries.add(s.id)
      out.push({
        key: `series-${s.id}`,
        kind: 'series',
        title: s.name,
        subtitle:
          s.book_count != null
            ? `${s.book_count} book${s.book_count === 1 ? '' : 's'}`
            : null,
        to: `/series/${s.id}`,
        coverUrl: null,
      })
      if (seenSeries.size >= 4) break
    }
    let serialCount = 0
    for (const s of serials) {
      const hay = `${s.title ?? ''} ${s.author ?? ''}`.toLowerCase()
      if (!hay.includes(q)) continue
      out.push({
        key: `serial-${s.id}`,
        kind: 'serial',
        title: s.title ?? 'Untitled serial',
        subtitle: s.author,
        to: `/serials/${s.id}`,
        coverUrl: `/api/serials/${s.id}/cover`,
      })
      if (++serialCount >= 4) break
    }
    return out
  }, [debounced, books, series, serials])

  useEffect(() => setActive(0), [results.length, debounced])

  const go = useCallback(
    (to: string) => {
      onClose()
      navigate(to)
    },
    [navigate, onClose]
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[active]
      if (hit) go(hit.to)
      else if (debounced) go(`/library?search=${encodeURIComponent(debounced)}`)
    }
  }

  let lastKind: Result['kind'] | null = null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/80 p-3 pt-[8vh] animate-fade-in sm:p-6 sm:pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Quick search"
      data-testid="quick-search"
    >
      <div className="w-full max-w-xl border border-white bg-black animate-scale-in">
        <div className="flex items-center gap-3 border-b-2 border-white px-4">
          <Search size={18} className="shrink-0 text-primary-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search books, authors, series, genres, tags…"
            className="w-full bg-transparent py-4 text-base text-white placeholder-white/35 focus:outline-none"
            aria-label="Search"
            data-testid="quick-search-input"
          />
          {loadingBooks && (
            <Loader2
              size={16}
              className="shrink-0 animate-spin text-white/40"
            />
          )}
          <button
            onClick={onClose}
            aria-label="Close search"
            className="grid size-8 shrink-0 place-items-center text-white/50 hover:bg-white hover:text-black"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {!debounced ? (
            <p className="px-4 py-6 text-sm text-white/45">
              Type to search your whole library.{' '}
              <span className="hidden sm:inline">
                Press <kbd className="border border-white/25 px-1">↑</kbd>{' '}
                <kbd className="border border-white/25 px-1">↓</kbd> to move and{' '}
                <kbd className="border border-white/25 px-1">Enter</kbd> to
                open.
              </span>
            </p>
          ) : results.length === 0 && !loadingBooks ? (
            <p className="px-4 py-6 text-sm text-white/45">
              Nothing matches &ldquo;{debounced}&rdquo;.
            </p>
          ) : (
            <ul role="listbox" aria-label="Search results">
              {results.map((r, i) => {
                const header = r.kind !== lastKind ? KIND_LABEL[r.kind] : null
                lastKind = r.kind
                const Icon =
                  r.kind === 'series'
                    ? BookMarked
                    : r.kind === 'serial'
                      ? Scroll
                      : BookOpen
                return (
                  <li key={r.key}>
                    {header && (
                      <p className="border-t border-white/[0.14] px-4 pb-1 pt-3 text-[10px] font-semibold tracking-widest text-white/40 first:border-t-0">
                        {header}
                      </p>
                    )}
                    <button
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r.to)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        i === active ? 'bg-primary text-white' : 'text-white'
                      }`}
                      data-testid="quick-search-result"
                    >
                      <span className="relative grid h-10 w-7 shrink-0 place-items-center overflow-hidden bg-white/[0.08]">
                        <Icon size={13} className="text-white/40" />
                        {r.coverUrl && (
                          <img
                            src={r.coverUrl}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                            }}
                          />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {r.title}
                        </span>
                        {r.subtitle && (
                          <span
                            className={`block truncate text-xs ${i === active ? 'text-white/80' : 'text-white/45'}`}
                          >
                            {r.subtitle}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {debounced && (
          <button
            onClick={() =>
              go(`/library?search=${encodeURIComponent(debounced)}`)
            }
            className="flex w-full items-center justify-between border-t border-white/[0.14] px-4 py-3 text-xs font-semibold text-white/70 hover:bg-white hover:text-black"
          >
            <span>See all matching books in the library</span>
            <span aria-hidden="true">→</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Provider — keyboard shortcuts (⌘K / Ctrl+K and "/") and the overlay
// ---------------------------------------------------------------------------

export function QuickSearchProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setIsOpen((v) => !v)
      } else if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault()
        setIsOpen(true)
      } else if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const value = useMemo(() => ({ open }), [open])

  return (
    <QuickSearchContext.Provider value={value}>
      {children}
      {isOpen && <QuickSearchDialog onClose={close} />}
    </QuickSearchContext.Provider>
  )
}
