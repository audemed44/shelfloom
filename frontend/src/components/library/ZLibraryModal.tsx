import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Check, Download, Loader2, Search, X } from 'lucide-react'
import { api } from '../../api/client'
import { usePersistedState } from '../../hooks/usePersistedState'
import type {
  BookDetail,
  ZLibraryAddResponse,
  ZLibraryResult,
  ZLibrarySearchResponse,
  ZLibraryStatus,
} from '../../types/api'
import EditBookModal from '../book-detail/EditBookModal'
import CoverFallback from '../shared/CoverFallback'

interface Props {
  onClose: () => void
  /** Called whenever a book was added, so the library can refresh. */
  onAdded: () => void
  /** Searched for straight away when given. */
  initialQuery?: string
}

const FORMATS = [
  { value: 'epub', label: 'EPUB' },
  { value: 'pdf', label: 'PDF' },
  { value: 'any', label: 'Any' },
]

const LANGUAGES = [
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'any', label: 'Any language' },
]

function errorText(err: unknown, fallback: string) {
  return (err as { data?: { detail?: string } }).data?.detail ?? fallback
}

function ResultCover({ result }: { result: ZLibraryResult }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="relative w-16 sm:w-20 aspect-[2/3] shrink-0 overflow-hidden bg-white/[0.04]">
      {result.cover_url && !failed ? (
        <img
          src={result.cover_url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <CoverFallback title={result.title} author={result.author} />
      )}
    </div>
  )
}

export default function ZLibraryModal({
  onClose,
  onAdded,
  initialQuery,
}: Props) {
  const [status, setStatus] = useState<ZLibraryStatus | null>(null)
  const [text, setText] = useState(initialQuery ?? '')
  // Filters are remembered; English unless changed.
  const [format, setFormat] = usePersistedState('shelfloom:zlib-format', 'epub')
  const [language, setLanguage] = usePersistedState(
    'shelfloom:zlib-language',
    'english'
  )
  const [results, setResults] = useState<ZLibraryResult[] | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [added, setAdded] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(
    null
  )
  const [editing, setEditing] = useState<{
    book: BookDetail
    series: { name: string; sequence: string | null } | null
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadStatus = () => {
    api
      .get<ZLibraryStatus>('/api/zlibrary/status')
      .then(setStatus)
      .catch(() => setStatus(null))
  }

  useEffect(() => {
    loadStatus()
    if (initialQuery?.trim()) search(1, initialQuery)
    else inputRef.current?.focus()
    // Once, when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editing) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, editing])

  const search = async (nextPage: number, query = text) => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        q,
        format,
        language,
        page: String(nextPage),
      })
      const data = await api.get<ZLibrarySearchResponse>(
        `/api/zlibrary/search?${params}`
      )
      if (data) {
        setResults((prev) =>
          nextPage > 1 && prev ? [...prev, ...data.results] : data.results
        )
        setHasMore(data.has_more)
        setPage(nextPage)
      }
    } catch (err) {
      setError(errorText(err, 'Search failed.'))
    } finally {
      setSearching(false)
    }
  }

  const add = async (result: ZLibraryResult) => {
    setAddingId(result.id)
    setError(null)
    setNotice(null)
    try {
      const data = await api.post<ZLibraryAddResponse>('/api/zlibrary/books', {
        id: result.id,
        hash: result.hash,
      })
      if (!data) return
      setAdded((a) => ({ ...a, [result.id]: data.book.id }))
      loadStatus()
      if (data.already_in_library) {
        setNotice({
          id: data.book.id,
          text: `“${data.book.title}” is already in your library.`,
        })
        return
      }
      onAdded()
      setEditing({
        book: data.book,
        series: data.series
          ? { name: data.series, sequence: data.series_sequence }
          : null,
      })
    } catch (err) {
      setError(errorText(err, 'Could not add the book.'))
    } finally {
      setAddingId(null)
    }
  }

  const finishEditing = (book: BookDetail) => {
    setEditing(null)
    setNotice({ id: book.id, text: `Added “${book.title}”.` })
    onAdded()
  }

  const selectClass =
    'bg-black border border-white/10 px-3 py-2.5 text-xs text-white focus:outline-none focus:border-primary'

  // On <body>: the page's main area is its own stacking context, so from
  // inside it the modal would sit under the phone's bottom bar.
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/80 sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          className="sm:rounded-2xl shadow-lift ring-1 ring-white/[0.04] animate-scale-in relative flex w-full max-w-3xl flex-col overflow-hidden border border-white/10 bg-ink-900 sm:max-h-[90vh]"
          data-testid="zlibrary-modal"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-4 px-5 sm:px-8 py-4 sm:py-5 border-b border-white/10 shrink-0">
            <div className="min-w-0">
              <h2 className="text-sm font-black tracking-widest uppercase text-white">
                Z-Library
              </h2>
              {status?.enabled && status.downloads_limit != null && (
                <p
                  className="text-xs text-white/40 normal-case mt-0.5"
                  data-testid="zlibrary-downloads"
                >
                  {Math.max(
                    0,
                    status.downloads_limit - (status.downloads_today ?? 0)
                  )}{' '}
                  of {status.downloads_limit} downloads left today
                </p>
              )}
              {status?.error && (
                <p className="text-xs text-red-400 normal-case mt-0.5">
                  {status.error}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Search form */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              search(1)
            }}
            className="px-5 sm:px-8 py-4 border-b border-white/10 space-y-3 shrink-0"
          >
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
                />
                <input
                  ref={inputRef}
                  type="search"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Title, author or ISBN"
                  className="w-full bg-black border border-white/10 pl-9 pr-3 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary"
                  data-testid="zlibrary-search-input"
                />
              </div>
              <button
                type="submit"
                disabled={!text.trim() || searching}
                className="shrink-0 px-5 text-xs font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-40 transition-colors"
              >
                Search
              </button>
            </div>
            <div className="flex gap-2">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className={selectClass}
                aria-label="Format"
              >
                {FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={selectClass}
                aria-label="Language"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </form>

          {/* Results */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-8 py-4 space-y-3">
            {error && (
              <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
                {error}
                {/domain|reach/i.test(error) && (
                  <>
                    {' '}
                    <Link to="/settings" className="font-semibold underline">
                      Change domain in Settings
                    </Link>
                  </>
                )}
              </p>
            )}
            {notice && (
              <p
                className="text-xs text-white/70 border border-primary/30 bg-primary/5 px-3 py-2 normal-case"
                data-testid="zlibrary-notice"
              >
                {notice.text}{' '}
                <Link
                  to={`/books/${notice.id}`}
                  className="text-primary font-semibold"
                >
                  Open book
                </Link>
              </p>
            )}
            {results === null && !searching && (
              <p className="py-10 text-center text-sm text-white/30 normal-case">
                Search Z-Library and add a book straight to your library.
              </p>
            )}
            {results !== null && results.length === 0 && !searching && (
              <p className="py-10 text-center text-sm text-white/30 normal-case">
                Nothing found.
              </p>
            )}
            {results?.map((r) => {
              const libraryId = added[r.id] ?? r.in_library_book_id
              return (
                <div
                  key={r.id}
                  className="flex gap-4 border border-white/10 bg-white/[0.02] p-3"
                  data-testid="zlibrary-result"
                >
                  <ResultCover result={r} />
                  <div className="min-w-0 flex-1 flex flex-col">
                    <p className="text-sm font-bold text-white normal-case line-clamp-2">
                      {r.title}
                    </p>
                    {r.author && (
                      <p className="text-xs text-white/50 normal-case truncate">
                        {r.author}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-white/35 normal-case">
                      {[
                        r.extension.toUpperCase(),
                        r.size,
                        r.year,
                        r.language,
                        r.pages ? `${r.pages} pages` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {r.series && (
                      <p className="text-[11px] text-white/35 normal-case truncate">
                        Series: {r.series}
                      </p>
                    )}
                    <div className="mt-auto pt-2 flex items-center gap-3">
                      <button
                        onClick={() => add(r)}
                        disabled={addingId !== null}
                        className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-40 transition-colors"
                        data-testid="zlibrary-add"
                      >
                        {addingId === r.id ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            Downloading…
                          </>
                        ) : (
                          <>
                            <Download size={12} />
                            Add to library
                          </>
                        )}
                      </button>
                      {libraryId && (
                        <Link
                          to={`/books/${libraryId}`}
                          className="flex items-center gap-1 text-[10px] font-black tracking-widest uppercase text-primary"
                        >
                          <Check size={12} />
                          In library
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {searching && (
              <div className="flex justify-center py-6 text-white/40">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
            {hasMore && !searching && results && results.length > 0 && (
              <button
                onClick={() => search(page + 1)}
                className="w-full border border-white/10 py-3 text-[10px] font-black tracking-widest uppercase text-white/50 hover:text-white hover:border-white/30 transition-colors"
              >
                More results
              </button>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <EditBookModal
          book={editing.book}
          currentSeries={[]}
          heading="Added — review details"
          cancelLabel="Skip"
          suggestedSeries={editing.series}
          onClose={() => finishEditing(editing.book)}
          onSaved={finishEditing}
          onSeriesChange={onAdded}
        />
      )}
    </>,
    document.body
  )
}
