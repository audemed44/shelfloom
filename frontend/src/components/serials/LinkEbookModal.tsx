import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, Loader2, Search, Upload, X } from 'lucide-react'
import { api } from '../../api/client'
import { useDebounce } from '../../hooks/useDebounce'
import { getBookCoverUrl } from '../../utils/bookCover'
import type { Book, PaginatedResponse } from '../../types'
import type { SerialVolume } from '../../types/api'

interface LinkEbookModalProps {
  serialId: number
  serialTitle: string | null
  volumes: SerialVolume[]
  stubbedChapterCount: number
  onClose: () => void
  onLinked: () => void
}

type Source = 'library' | 'upload'

const label =
  'block text-[10px] font-semibold tracking-widest text-white/50 mb-1.5'
const input =
  'bg-black border border-white/25 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary'

/**
 * Attach a book the user owns (typically the author's published ebook) to a
 * web serial as a volume, e.g. books 1–3 whose chapters were stubbed online.
 */
export default function LinkEbookModal({
  serialId,
  serialTitle,
  volumes,
  stubbedChapterCount,
  onClose,
  onLinked,
}: LinkEbookModalProps) {
  const [source, setSource] = useState<Source>('library')
  const [query, setQuery] = useState(serialTitle ?? '')
  const debouncedQuery = useDebounce(query.trim(), 250)
  const [results, setResults] = useState<Book[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Book | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Default position: right after the ebooks already linked (books 1, 2, 3…).
  const defaultNumber = useMemo(() => {
    const ebookNumbers = volumes
      .filter((v) => v.kind === 'ebook')
      .map((v) => v.volume_number)
    return ebookNumbers.length > 0 ? Math.max(...ebookNumbers) + 1 : 1
  }, [volumes])
  const [volumeNumber, setVolumeNumber] = useState(String(defaultNumber))
  const [chapterStart, setChapterStart] = useState('')
  const [chapterEnd, setChapterEnd] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const linkedBookIds = useMemo(
    () => new Set(volumes.map((v) => v.book_id).filter(Boolean)),
    [volumes]
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    if (source !== 'library') return
    let cancelled = false
    setSearching(true)
    const params = new URLSearchParams({ per_page: '8', sort: 'title' })
    if (debouncedQuery) params.set('search', debouncedQuery)
    api
      .get<PaginatedResponse<Book>>(`/api/books?${params}`)
      .then((d) => {
        if (!cancelled) setResults(d?.items ?? [])
      })
      .catch(() => {
        if (!cancelled) setResults([])
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, source])

  const position = parseInt(volumeNumber, 10)
  // Mirrors the server: only the consecutive run of volumes starting at the
  // chosen number moves down; an existing gap absorbs the shift.
  const shifted = useMemo(() => {
    if (isNaN(position)) return []
    const taken = new Set(volumes.map((v) => v.volume_number))
    const moved: number[] = []
    for (let n = position; taken.has(n); n++) moved.push(n)
    return moved
  }, [position, volumes])

  const handleUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const book = await api.upload<Book>('/api/books', formData)
      if (book) setSelected(book)
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async () => {
    if (!selected) {
      setError('Choose a book first')
      return
    }
    const start = chapterStart ? parseInt(chapterStart, 10) : null
    const end = chapterEnd ? parseInt(chapterEnd, 10) : null
    if ((start === null) !== (end === null)) {
      setError('Enter both the first and last chapter, or leave both empty')
      return
    }
    if (start !== null && end !== null && (start < 1 || end < start)) {
      setError('Enter a valid chapter range (first ≤ last)')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.post(`/api/serials/${serialId}/volumes/link-ebook`, {
        book_id: selected.id,
        volume_number: isNaN(position) ? null : position,
        name: name.trim() || null,
        chapter_start: start,
        chapter_end: end,
      })
      onLinked()
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Failed to link ebook')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-3 animate-fade-in sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-ebook-title"
      data-testid="link-ebook-modal"
    >
      <div className="w-full max-w-2xl border border-white bg-black animate-scale-in">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b-2 border-white px-5 py-4">
          <div>
            <h2
              id="link-ebook-title"
              className="text-xl font-bold tracking-tight text-white"
            >
              Link an ebook
            </h2>
            <p className="mt-1 text-sm text-white/55">
              Add a book you own, such as the author&rsquo;s published edition,
              as a volume of this serial. Shelfloom never rebuilds or overwrites
              it.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center text-white/60 hover:bg-white hover:text-black"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">
          {/* 01 Book */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">
                <span className="mr-2 text-xs tabular-nums text-primary-400">
                  01
                </span>
                Book
              </p>
              <div className="flex border border-white/25" role="group">
                {(
                  [
                    ['library', 'From library'],
                    ['upload', 'Upload file'],
                  ] as const
                ).map(([id, text]) => (
                  <button
                    key={id}
                    onClick={() => setSource(id)}
                    aria-pressed={source === id}
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                      source === id
                        ? 'bg-white text-black'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>

            {selected && (
              <div
                className="mb-3 flex items-center gap-3 border border-primary bg-primary/10 p-2"
                data-testid="link-ebook-selected"
              >
                <img
                  src={getBookCoverUrl(selected.id, selected.cover_path)}
                  alt=""
                  className="h-14 w-10 shrink-0 bg-white/10 object-cover"
                  onError={(e) => {
                    e.currentTarget.style.visibility = 'hidden'
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    {selected.title}
                  </p>
                  {selected.author && (
                    <p className="truncate text-xs text-white/55">
                      {selected.author}
                    </p>
                  )}
                </div>
                <Check size={16} className="mr-1 shrink-0 text-primary-400" />
              </div>
            )}

            {source === 'library' ? (
              <div>
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search your library by title, author or series"
                    className={`${input} w-full pl-9`}
                    aria-label="Search library"
                    data-testid="link-ebook-search"
                  />
                  {searching && (
                    <Loader2
                      size={14}
                      className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-white/40"
                    />
                  )}
                </div>
                <ul className="mt-2 max-h-64 overflow-y-auto border border-white/[0.14]">
                  {results.length === 0 && !searching && (
                    <li className="px-3 py-4 text-sm text-white/45">
                      No matching books. Try another search, or upload the file.
                    </li>
                  )}
                  {results.map((book) => {
                    const alreadyLinked = linkedBookIds.has(book.id)
                    const isSelected = selected?.id === book.id
                    return (
                      <li key={book.id}>
                        <button
                          onClick={() => setSelected(book)}
                          disabled={alreadyLinked}
                          className={`flex w-full items-center gap-3 border-b border-white/[0.08] px-3 py-2 text-left transition-colors last:border-0 disabled:opacity-40 ${
                            isSelected
                              ? 'bg-primary text-white'
                              : 'hover:bg-white/[0.06]'
                          }`}
                          data-testid="link-ebook-result"
                        >
                          <img
                            src={getBookCoverUrl(book.id, book.cover_path)}
                            alt=""
                            className="h-10 w-7 shrink-0 bg-white/10 object-cover"
                            onError={(e) => {
                              e.currentTarget.style.visibility = 'hidden'
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {book.title}
                            </span>
                            <span
                              className={`block truncate text-xs ${isSelected ? 'text-white/80' : 'text-white/45'}`}
                            >
                              {alreadyLinked
                                ? 'Already a volume of this serial'
                                : [book.author, book.format?.toUpperCase()]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : (
              <div>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex w-full flex-col items-center gap-2 border-2 border-dashed border-white/25 px-4 py-8 text-sm text-white/60 transition-colors hover:border-white hover:text-white disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <Upload size={20} />
                  )}
                  {uploading
                    ? 'Uploading…'
                    : 'Choose an EPUB or PDF to add to your library'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".epub,.pdf"
                  className="hidden"
                  data-testid="link-ebook-file"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleUpload(file)
                    e.target.value = ''
                  }}
                />
              </div>
            )}
          </section>

          {/* 02 Position */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-3 text-sm font-semibold text-white">
                <span className="mr-2 text-xs tabular-nums text-primary-400">
                  02
                </span>
                Position
              </p>
              <label className={label} htmlFor="link-ebook-number">
                Book number in the serial
              </label>
              <input
                id="link-ebook-number"
                type="number"
                min={1}
                value={volumeNumber}
                onChange={(e) => setVolumeNumber(e.target.value)}
                className={`${input} w-28`}
              />
              <p className="mt-2 text-xs text-white/45">
                {shifted.length === 0
                  ? 'No existing volumes move.'
                  : shifted.length === 1
                    ? `Volume #${shifted[0]} moves down to #${shifted[0] + 1}.`
                    : `Volumes #${shifted[0]}–#${shifted[shifted.length - 1]} move down one.`}
              </p>
            </div>
            <div>
              <label className={label} htmlFor="link-ebook-name">
                Name (optional)
              </label>
              <input
                id="link-ebook-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={selected?.title ?? 'Defaults to the book title'}
                className={`${input} w-full`}
              />
            </div>
          </section>

          {/* 03 Chapters */}
          <section>
            <p className="mb-1 text-sm font-semibold text-white">
              <span className="mr-2 text-xs tabular-nums text-primary-400">
                03
              </span>
              Chapters it covers{' '}
              <span className="font-normal text-white/45">(optional)</span>
            </p>
            <p className="mb-3 text-xs text-white/45">
              Marks those chapters as covered by this book, and makes Auto split
              start after them.
              {stubbedChapterCount > 0 &&
                ` This serial has ${stubbedChapterCount} stubbed chapter${stubbedChapterCount === 1 ? '' : 's'}.`}{' '}
              Leave empty if you don&rsquo;t know.
            </p>
            <div className="flex items-end gap-3">
              <div>
                <label className={label} htmlFor="link-ebook-start">
                  First
                </label>
                <input
                  id="link-ebook-start"
                  type="number"
                  min={1}
                  value={chapterStart}
                  onChange={(e) => setChapterStart(e.target.value)}
                  className={`${input} w-24`}
                />
              </div>
              <span className="pb-2 text-white/40">–</span>
              <div>
                <label className={label} htmlFor="link-ebook-end">
                  Last
                </label>
                <input
                  id="link-ebook-end"
                  type="number"
                  min={1}
                  value={chapterEnd}
                  onChange={(e) => setChapterEnd(e.target.value)}
                  className={`${input} w-24`}
                />
              </div>
            </div>
          </section>

          {error && (
            <p className="border border-red-400/40 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-white/[0.14] px-5 py-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white/60 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selected || saving}
            className="flex items-center gap-2 bg-primary px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-40"
            data-testid="link-ebook-submit"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <BookOpen size={14} />
            )}
            Link ebook
          </button>
        </div>
      </div>
    </div>
  )
}
