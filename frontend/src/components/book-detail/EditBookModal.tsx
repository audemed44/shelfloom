import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Search, Plus, Trash2, Check } from 'lucide-react'
import { api } from '../../api/client'
import type { BookDetail } from '../../types'
import type { SeriesWithCount, Tag } from '../../types/api'
import GenreCombobox from '../shared/GenreCombobox'
import CreateSeriesModal from '../shared/CreateSeriesModal'

// ── types ──────────────────────────────────────────────────────────────────────

interface SeriesRow {
  series_id: number
  series_name: string
  sequence: number | null
}

interface EditBookModalProps {
  book: BookDetail
  currentSeries: SeriesRow[]
  onClose: () => void
  onSaved: (book: BookDetail) => void
  onSeriesChange: () => void
}

interface EditForm {
  title: string
  author: string
  publisher: string
  language: string
  isbn: string
  date_published: string
  genres: string[]
  description: string
}

// ── Tag combobox (live API) ────────────────────────────────────────────────────

function TagCombobox({
  bookId,
  initialTags,
}: {
  bookId: string
  initialTags: Tag[]
}) {
  const [tags, setTags] = useState<Tag[]>(initialTags)
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get<Tag[]>('/api/tags').then((data) => {
      if (Array.isArray(data)) setAllTags(data)
    })
  }, [])

  const assignedIds = new Set(tags.map((t) => t.id))
  const suggestions = allTags.filter(
    (t) =>
      t.name.toLowerCase().includes(input.toLowerCase()) &&
      !assignedIds.has(t.id)
  )
  const trimmed = input.trim()
  const showAddNew =
    trimmed.length > 0 &&
    !allTags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())

  const addTag = useCallback(
    async (tag: Tag) => {
      if (assignedIds.has(tag.id)) return
      setBusy(true)
      try {
        await api.post(`/api/books/${bookId}/tags/${tag.id}`, {})
        setTags((prev) =>
          [...prev, tag].sort((a, b) => a.name.localeCompare(b.name))
        )
        setAllTags((prev) =>
          prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]
        )
      } finally {
        setBusy(false)
        setInput('')
        setOpen(false)
        inputRef.current?.focus()
      }
    },
    [bookId, assignedIds]
  )

  const createAndAdd = useCallback(
    async (name: string) => {
      setBusy(true)
      try {
        const created = await api.post<Tag>('/api/tags', { name })
        if (created) await addTag(created)
      } catch {
        // tag may already exist (race), try to find it
        const existing = allTags.find(
          (t) => t.name.toLowerCase() === name.toLowerCase()
        )
        if (existing) await addTag(existing)
      } finally {
        setBusy(false)
      }
    },
    [addTag, allTags]
  )

  const removeTag = useCallback(
    async (tag: Tag) => {
      setBusy(true)
      try {
        await api.delete(`/api/books/${bookId}/tags/${tag.id}`)
        setTags((prev) => prev.filter((t) => t.id !== tag.id))
      } finally {
        setBusy(false)
      }
    },
    [bookId]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions.length > 0 && !showAddNew) {
        addTag(suggestions[0])
      } else if (trimmed) {
        createAndAdd(trimmed)
      }
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div>
      <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1.5">
        Tags
      </label>

      <div
        className={`flex flex-wrap gap-1.5 min-h-[46px] bg-black border border-white/10 px-3 py-2 focus-within:border-primary transition-colors cursor-text ${busy ? 'opacity-60 pointer-events-none' : ''}`}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((t) => (
          <span
            key={t.id}
            className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/15 border border-amber-500/30 text-[10px] font-black tracking-widest text-amber-400 normal-case"
          >
            {t.name}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeTag(t)
              }}
              className="text-amber-400/60 hover:text-amber-400 transition-colors"
              aria-label={`Remove ${t.name}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? 'Type to search or add…' : ''}
          className="flex-1 min-w-[120px] bg-transparent text-sm text-white placeholder:text-white/20 focus:outline-none normal-case"
        />
      </div>

      {open && input.length > 0 && (suggestions.length > 0 || showAddNew) && (
        <div className="border border-white/10 border-t-0 bg-black max-h-40 overflow-y-auto">
          {suggestions.map((t) => (
            <button
              key={t.id}
              type="button"
              onMouseDown={() => addTag(t)}
              className="w-full text-left px-4 py-2.5 text-sm text-white/70 normal-case hover:bg-white/5 hover:text-white transition-colors"
            >
              {t.name}
            </button>
          ))}
          {showAddNew && (
            <button
              type="button"
              onMouseDown={() => createAndAdd(trimmed)}
              className="w-full text-left px-4 py-2.5 text-sm text-white/50 normal-case hover:bg-white/5 hover:text-white/80 transition-colors flex items-center gap-2"
            >
              <Plus size={12} className="text-amber-400 shrink-0" />
              Add &ldquo;{trimmed}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Field sub-component ────────────────────────────────────────────────────────

function Field({
  label,
  name,
  value,
  onChange,
  required,
  placeholder,
}: {
  label: string
  name: keyof EditForm
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  required?: boolean
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1.5">
        {label}
      </label>
      <input
        type="text"
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
      />
    </div>
  )
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({ num, title }: { num: string; title: string }) {
  return (
    <div className="flex items-center gap-4 pb-2 border-b border-white/10 mb-6">
      <span className="text-xs font-black tracking-[0.2em] text-white/20">
        {num}
      </span>
      <h3 className="text-base font-bold uppercase tracking-tight text-white">
        {title}
      </h3>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function EditBookModal({
  book,
  currentSeries,
  onClose,
  onSaved,
  onSeriesChange,
}: EditBookModalProps) {
  const [form, setForm] = useState<EditForm>({
    title: book.title ?? '',
    author: book.author ?? '',
    publisher: book.publisher ?? '',
    language: book.language ?? '',
    isbn: book.isbn ?? '',
    date_published: book.date_published ?? '',
    genres: book.genre
      ? book.genre
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean)
      : [],
    description: book.description ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Series state
  const [seriesRows, setSeriesRows] = useState<SeriesRow[]>(currentSeries)
  const [allSeries, setAllSeries] = useState<SeriesWithCount[]>([])
  const [addRow, setAddRow] = useState<{
    search: string
    selectedId: number | null
    sequence: string
  } | null>(null)
  const [showCreateSeries, setShowCreateSeries] = useState(false)
  const [seriesError, setSeriesError] = useState<string | null>(null)
  const [seriesBusy, setSeriesBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // Track in-progress sequence edits: seriesId → current input value
  const [seqEdits, setSeqEdits] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      currentSeries.map((s) => [s.series_id, s.sequence?.toString() ?? ''])
    )
  )

  useEffect(() => {
    api.get<SeriesWithCount[]>('/api/series/tree').then((data) => {
      if (Array.isArray(data)) setAllSeries(data)
    })
  }, [])

  // Close on Escape (unless sub-modal is open)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showCreateSeries) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, showCreateSeries])

  // Focus search input when add row appears
  useEffect(() => {
    if (addRow !== null) searchRef.current?.focus()
  }, [addRow])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const { genres, ...rest } = form
      const payload: Record<string, string | null> = {}
      for (const [k, v] of Object.entries(rest)) {
        if (v !== '') payload[k] = v as string
      }
      payload.genre = genres.length > 0 ? genres.join(', ') : null
      const updated = await api.patch<BookDetail>(
        `/api/books/${book.id}`,
        payload
      )
      onSaved(updated!)
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveSeries = async (seriesId: number) => {
    setSeriesBusy(true)
    setSeriesError(null)
    try {
      await api.delete(`/api/series/${seriesId}/books/${book.id}`)
      setSeriesRows((rows) => rows.filter((r) => r.series_id !== seriesId))
      onSeriesChange()
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setSeriesError(apiErr.data?.detail ?? 'Failed to remove from series.')
    } finally {
      setSeriesBusy(false)
    }
  }

  const handleUpdateSequence = async (seriesId: number) => {
    const row = seriesRows.find((r) => r.series_id === seriesId)
    if (!row) return
    const newVal = seqEdits[seriesId]?.trim() ?? ''
    const newSeq = newVal ? parseFloat(newVal) : null
    if (newSeq === row.sequence) return // unchanged
    setSeriesBusy(true)
    setSeriesError(null)
    try {
      // DELETE + re-POST is the only way to update sequence via current API
      await api.delete(`/api/series/${seriesId}/books/${book.id}`)
      const qs = newVal ? `?sequence=${encodeURIComponent(newVal)}` : ''
      await api.post(`/api/series/${seriesId}/books/${book.id}${qs}`, {})
      setSeriesRows((rows) =>
        rows.map((r) =>
          r.series_id === seriesId ? { ...r, sequence: newSeq } : r
        )
      )
      onSeriesChange()
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setSeriesError(apiErr.data?.detail ?? 'Failed to update sequence.')
      // Revert input to previous value
      setSeqEdits((e) => ({ ...e, [seriesId]: row.sequence?.toString() ?? '' }))
    } finally {
      setSeriesBusy(false)
    }
  }

  const handleAddSeries = async () => {
    if (!addRow?.selectedId) return
    setSeriesBusy(true)
    setSeriesError(null)
    try {
      const seq = addRow.sequence.trim()
        ? `?sequence=${encodeURIComponent(addRow.sequence.trim())}`
        : ''
      await api.post(
        `/api/series/${addRow.selectedId}/books/${book.id}${seq}`,
        {}
      )
      const selected = allSeries.find((s) => s.id === addRow.selectedId)
      if (selected) {
        setSeriesRows((rows) => [
          ...rows,
          {
            series_id: selected.id,
            series_name: selected.name,
            sequence: addRow.sequence.trim()
              ? parseFloat(addRow.sequence.trim())
              : null,
          },
        ])
      }
      setAddRow(null)
      onSeriesChange()
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setSeriesError(apiErr.data?.detail ?? 'Failed to assign series.')
    } finally {
      setSeriesBusy(false)
    }
  }

  const handleSeriesCreated = (newSeries: SeriesWithCount) => {
    setAllSeries((prev) => [...prev, newSeries])
    setShowCreateSeries(false)
    // Auto-select the newly created series in the add row
    setAddRow((row) =>
      row
        ? { ...row, search: newSeries.name, selectedId: newSeries.id }
        : { search: newSeries.name, selectedId: newSeries.id, sequence: '' }
    )
  }

  const filteredSeries = allSeries.filter(
    (s) =>
      s.name.toLowerCase().includes((addRow?.search ?? '').toLowerCase()) &&
      !seriesRows.some((r) => r.series_id === s.id)
  )

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="relative w-full max-w-2xl bg-black border border-white/10 shadow-2xl my-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 sticky top-0 bg-black z-10">
            <div>
              <h2 className="text-sm font-black tracking-widest uppercase text-white">
                Edit Book
              </h2>
              <p className="text-xs text-primary/80 normal-case mt-0.5">
                {book.title}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close modal"
              className="text-white/40 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-6 max-h-[80vh] overflow-y-auto space-y-10">
            {/* ── 01 Basic Information ── */}
            <section>
              <SectionHeader num="01" title="Basic Information" />
              <form
                id="edit-book-form"
                onSubmit={handleSubmit}
                className="space-y-4"
              >
                {error && (
                  <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
                    {error}
                  </p>
                )}
                <Field
                  label="Title"
                  name="title"
                  value={form.title}
                  onChange={handleChange}
                  required
                />
                <Field
                  label="Author"
                  name="author"
                  value={form.author}
                  onChange={handleChange}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="Publisher"
                    name="publisher"
                    value={form.publisher}
                    onChange={handleChange}
                  />
                  <Field
                    label="Language"
                    name="language"
                    value={form.language}
                    onChange={handleChange}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="ISBN"
                    name="isbn"
                    value={form.isbn}
                    onChange={handleChange}
                  />
                  <Field
                    label="Published"
                    name="date_published"
                    value={form.date_published}
                    onChange={handleChange}
                    placeholder="e.g. 2010"
                  />
                </div>
                <GenreCombobox
                  value={form.genres}
                  onChange={(genres) => setForm((f) => ({ ...f, genres }))}
                />
                <TagCombobox
                  bookId={String(book.id)}
                  initialTags={book.tags ?? []}
                />
                <div>
                  <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1.5">
                    Description
                  </label>
                  <textarea
                    name="description"
                    value={form.description}
                    onChange={handleChange}
                    rows={5}
                    className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors resize-none"
                  />
                </div>
              </form>
            </section>

            {/* ── 02 Series Management ── */}
            <section>
              <SectionHeader num="02" title="Series Management" />
              <div className="space-y-3">
                {seriesError && (
                  <p className="text-xs text-red-400 normal-case">
                    {seriesError}
                  </p>
                )}

                {/* Existing series row (one at a time) */}
                {seriesRows.map((row) => (
                  <div
                    key={row.series_id}
                    className="flex items-center gap-3 p-4 border border-white/10 bg-white/[0.02]"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-black tracking-widest uppercase text-white/30 mb-1">
                        Series
                      </p>
                      <p className="text-sm text-white normal-case font-medium">
                        {row.series_name}
                      </p>
                    </div>
                    <div className="w-24 shrink-0">
                      <p className="text-[10px] font-black tracking-widest uppercase text-white/30 mb-1">
                        Sequence
                      </p>
                      <input
                        type="number"
                        step="1"
                        value={seqEdits[row.series_id] ?? ''}
                        onChange={(e) =>
                          setSeqEdits((prev) => ({
                            ...prev,
                            [row.series_id]: e.target.value,
                          }))
                        }
                        onBlur={() => handleUpdateSequence(row.series_id)}
                        disabled={seriesBusy}
                        placeholder="—"
                        className="w-full bg-black border border-white/10 px-2 py-1 text-sm text-white/70 text-center placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors disabled:opacity-40"
                      />
                    </div>
                    <button
                      onClick={() => handleRemoveSeries(row.series_id)}
                      disabled={seriesBusy}
                      className="shrink-0 p-2 text-white/30 hover:text-red-400 disabled:opacity-30 transition-colors"
                      title="Remove from series"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}

                {/* Add series row */}
                {addRow !== null ? (
                  <div className="p-4 border border-white/10 bg-white/[0.02] space-y-3">
                    <div className="flex gap-2">
                      {/* Search input */}
                      <div className="relative flex-1">
                        <Search
                          size={13}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
                        />
                        <input
                          ref={searchRef}
                          type="text"
                          value={addRow.search}
                          onChange={(e) =>
                            setAddRow(
                              (r) =>
                                r && {
                                  ...r,
                                  search: e.target.value,
                                  selectedId: null,
                                }
                            )
                          }
                          placeholder="Search series…"
                          className="w-full bg-black border border-white/10 pl-9 pr-3 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
                        />
                      </div>
                      {/* Create new series button */}
                      <button
                        type="button"
                        onClick={() => setShowCreateSeries(true)}
                        title="Create new series"
                        className="shrink-0 size-[46px] border border-white/10 flex items-center justify-center text-white/30 hover:bg-primary hover:border-primary hover:text-white transition-all"
                      >
                        <Plus size={16} />
                      </button>
                      {/* Sequence */}
                      <input
                        type="number"
                        step="1"
                        value={addRow.sequence}
                        onChange={(e) =>
                          setAddRow(
                            (r) => r && { ...r, sequence: e.target.value }
                          )
                        }
                        placeholder="#"
                        className="w-16 bg-black border border-white/10 px-2 py-3 text-sm text-white text-center placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
                      />
                      {/* Confirm */}
                      <button
                        type="button"
                        onClick={handleAddSeries}
                        disabled={!addRow.selectedId || seriesBusy}
                        className="shrink-0 size-[46px] flex items-center justify-center bg-primary text-white disabled:opacity-30 hover:bg-primary/80 transition-colors"
                      >
                        <Check size={16} />
                      </button>
                    </div>

                    {/* Dropdown results */}
                    {addRow.search &&
                      !addRow.selectedId &&
                      filteredSeries.length > 0 && (
                        <div className="border border-white/10 bg-black max-h-36 overflow-y-auto">
                          {filteredSeries.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() =>
                                setAddRow(
                                  (r) =>
                                    r && {
                                      ...r,
                                      search: s.name,
                                      selectedId: s.id,
                                    }
                                )
                              }
                              className="w-full text-left px-4 py-2.5 text-sm text-white/70 normal-case hover:bg-white/5 hover:text-white transition-colors flex items-center justify-between"
                            >
                              <span>{s.name}</span>
                              <span className="text-[10px] text-white/30">
                                {s.book_count} books
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    {addRow.selectedId && (
                      <p className="text-[10px] text-primary tracking-widest uppercase font-black">
                        ✓ {addRow.search} selected
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => setAddRow(null)}
                      className="text-[10px] text-white/30 hover:text-white/60 uppercase tracking-widest font-black transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : seriesRows.length === 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setAddRow({ search: '', selectedId: null, sequence: '' })
                    }
                    className="w-full border border-dashed border-white/15 p-4 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/30 hover:bg-white/5 hover:text-white/60 transition-colors"
                  >
                    <Plus size={13} />
                    Assign to series
                  </button>
                ) : null}
              </div>
            </section>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3 bg-black">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-xs font-black tracking-widest uppercase border border-white/20 text-white/50 hover:text-white hover:border-white/40 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-book-form"
              disabled={saving}
              className="px-6 py-2.5 text-xs font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Create series sub-modal */}
      {showCreateSeries && (
        <CreateSeriesModal
          allSeries={allSeries}
          onClose={() => setShowCreateSeries(false)}
          onCreated={handleSeriesCreated}
        />
      )}
    </>
  )
}
