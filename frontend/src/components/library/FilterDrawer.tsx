import { useState, useEffect, useMemo, useCallback } from 'react'
import { X, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { api } from '../../api/client'
import type {
  Genre,
  Tag,
  Shelf,
  SeriesWithCount,
  Author,
  FilterState,
  FilterLabels,
} from '../../types/api'

interface FilterDrawerProps {
  open: boolean
  onClose: () => void
  filters: FilterState
  onApply: (filters: FilterState, labels: FilterLabels) => void
  shelves: Shelf[]
  shelfId: number | null
  onShelfChange: (id: number | null) => void
  status: string | null
  onStatusChange: (s: string | null) => void
}

const STATUS_OPTIONS = [
  { value: null, label: 'All' },
  { value: 'reading', label: 'Reading' },
  { value: 'unread', label: 'Unread' },
  { value: 'completed', label: 'Completed' },
]

const EMPTY_FILTERS: FilterState = {
  genres: [],
  tags: [],
  seriesIds: [],
  authors: [],
  formats: [],
  mode: 'and',
}

// ---------------------------------------------------------------------------
// Accordion section
// ---------------------------------------------------------------------------

interface AccordionSectionProps {
  number: string
  label: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
}

function AccordionSection({
  number,
  label,
  count,
  children,
  defaultOpen = false,
}: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-white/10 pb-4 mb-4 last:border-0 last:mb-0 last:pb-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left"
        data-testid={`accordion-${label.toLowerCase()}`}
      >
        {open ? (
          <ChevronDown size={14} className="text-white/40 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-white/40 shrink-0" />
        )}
        <span className="text-[10px] font-black tracking-widest uppercase text-white/40">
          {number} {label}
        </span>
        {count > 0 && (
          <span className="text-[10px] font-black tracking-widest text-primary ml-auto">
            {count}
          </span>
        )}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Searchable checkbox list
// ---------------------------------------------------------------------------

interface CheckboxListProps {
  items: { id: string | number; name: string }[]
  selected: Set<string | number>
  onToggle: (id: string | number) => void
  searchable?: boolean
}

function CheckboxList({
  items,
  selected,
  onToggle,
  searchable = true,
}: CheckboxListProps) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    if (!query) return items
    const q = query.toLowerCase()
    return items.filter((i) => i.name.toLowerCase().includes(q))
  }, [items, query])

  return (
    <div>
      {searchable && items.length > 5 && (
        <div className="relative mb-2">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="w-full bg-black border border-white/10 pl-8 pr-3 py-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-primary/60 normal-case"
            data-testid="filter-search-input"
          />
        </div>
      )}
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {filtered.map((item) => (
          <label
            key={item.id}
            className="flex items-center gap-2.5 px-1 py-1.5 hover:bg-white/5 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => onToggle(item.id)}
              className="accent-primary shrink-0"
            />
            <span
              className={`text-xs normal-case ${
                selected.has(item.id) ? 'text-primary' : 'text-white/60'
              }`}
            >
              {item.name}
            </span>
          </label>
        ))}
        {filtered.length === 0 && (
          <p className="text-[10px] text-white/20 px-1 py-2 normal-case">
            No matches
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Radio list (for shelf / status — single select)
// ---------------------------------------------------------------------------

interface RadioListProps {
  items: { value: string | number | null; label: string }[]
  selected: string | number | null
  onSelect: (v: string | number | null) => void
}

function RadioList({ items, selected, onSelect }: RadioListProps) {
  return (
    <div className="space-y-0.5">
      {items.map((item) => (
        <label
          key={String(item.value)}
          className="flex items-center gap-2.5 px-1 py-1.5 hover:bg-white/5 cursor-pointer"
        >
          <input
            type="radio"
            checked={selected === item.value}
            onChange={() => onSelect(item.value)}
            className="accent-primary shrink-0"
          />
          <span
            className={`text-xs normal-case ${
              selected === item.value ? 'text-primary' : 'text-white/60'
            }`}
          >
            {item.label}
          </span>
        </label>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FilterDrawer
// ---------------------------------------------------------------------------

export default function FilterDrawer({
  open,
  onClose,
  filters,
  onApply,
  shelves,
  shelfId,
  onShelfChange,
  status,
  onStatusChange,
}: FilterDrawerProps) {
  // Draft state — committed on Apply
  const [draft, setDraft] = useState<FilterState>(filters)
  const [draftShelf, setDraftShelf] = useState<number | null>(shelfId)
  const [draftStatus, setDraftStatus] = useState<string | null>(status)

  // Fetched filter options
  const [genres, setGenres] = useState<Genre[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [seriesList, setSeriesList] = useState<SeriesWithCount[]>([])
  const [authorList, setAuthorList] = useState<Author[]>([])

  // Reset draft when drawer opens
  useEffect(() => {
    if (open) {
      setDraft(filters)
      setDraftShelf(shelfId)
      setDraftStatus(status)
    }
  }, [open, filters, shelfId, status])

  // Fetch filter options when opened
  useEffect(() => {
    if (!open) return
    api.get<Genre[]>('/api/genres').then((data) => data && setGenres(data))
    api.get<Tag[]>('/api/tags').then((data) => data && setTags(data))
    api
      .get<SeriesWithCount[]>('/api/series/tree')
      .then((data) => data && setSeriesList(data))
    api
      .get<Author[]>('/api/authors')
      .then((data) => data && setAuthorList(data))
  }, [open])

  // Escape key
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Toggle helpers
  const toggleSet = useCallback(
    <T extends string | number>(key: keyof FilterState, value: T) => {
      setDraft((prev) => {
        const arr = prev[key] as T[]
        const next = arr.includes(value)
          ? arr.filter((v) => v !== value)
          : [...arr, value]
        return { ...prev, [key]: next }
      })
    },
    []
  )

  const selectedGenres = useMemo(() => new Set(draft.genres), [draft.genres])
  const selectedTags = useMemo(() => new Set(draft.tags), [draft.tags])
  const selectedSeries = useMemo(
    () => new Set(draft.seriesIds),
    [draft.seriesIds]
  )
  const selectedAuthors = useMemo(() => new Set(draft.authors), [draft.authors])
  const selectedFormats = useMemo(() => new Set(draft.formats), [draft.formats])

  const activeFilterCount =
    draft.genres.length +
    draft.tags.length +
    draft.seriesIds.length +
    draft.authors.length +
    draft.formats.length

  const handleApply = () => {
    // Build labels for chips
    const labels: FilterLabels = {
      genres: Object.fromEntries(
        genres
          .filter((g) => draft.genres.includes(g.id))
          .map((g) => [g.id, g.name])
      ),
      tags: Object.fromEntries(
        tags.filter((t) => draft.tags.includes(t.id)).map((t) => [t.id, t.name])
      ),
      series: Object.fromEntries(
        seriesList
          .filter((s) => draft.seriesIds.includes(s.id))
          .map((s) => [s.id, s.name])
      ),
    }
    onApply(draft, labels)
    // Also sync shelf/status immediately (these apply without Apply button)
    onShelfChange(draftShelf)
    onStatusChange(draftStatus)
    onClose()
  }

  const handleClear = () => {
    setDraft(EMPTY_FILTERS)
    setDraftShelf(null)
    setDraftStatus(null)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" data-testid="filter-drawer">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80"
        onClick={onClose}
        data-testid="filter-drawer-backdrop"
      />

      {/* Panel */}
      <div className="absolute top-0 right-0 bottom-0 w-full sm:w-80 bg-black border-l border-white/10 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <h3 className="text-sm font-black tracking-widest text-white">
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-2 text-primary">({activeFilterCount})</span>
            )}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-white/40 hover:text-white transition-colors"
            aria-label="Close filters"
            data-testid="filter-drawer-close"
          >
            <X size={18} />
          </button>
        </div>

        {/* AND/OR toggle */}
        <div className="flex gap-2 px-5 py-3 border-b border-white/10 shrink-0">
          <button
            onClick={() => setDraft((d) => ({ ...d, mode: 'and' }))}
            className={`flex-1 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase transition-colors ${
              draft.mode === 'and'
                ? 'bg-primary text-white'
                : 'bg-white/5 border border-white/10 text-white/40 hover:text-white'
            }`}
            data-testid="filter-mode-and"
          >
            Match All
          </button>
          <button
            onClick={() => setDraft((d) => ({ ...d, mode: 'or' }))}
            className={`flex-1 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase transition-colors ${
              draft.mode === 'or'
                ? 'bg-primary text-white'
                : 'bg-white/5 border border-white/10 text-white/40 hover:text-white'
            }`}
            data-testid="filter-mode-or"
          >
            Match Any
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* 01 Shelves */}
          <AccordionSection
            number="01"
            label="Shelves"
            count={draftShelf != null ? 1 : 0}
          >
            <RadioList
              items={[
                { value: null, label: 'All Shelves' },
                ...shelves.map((s) => ({ value: s.id, label: s.name })),
              ]}
              selected={draftShelf}
              onSelect={(v) => setDraftShelf(v as number | null)}
            />
          </AccordionSection>

          {/* 02 Status */}
          <AccordionSection
            number="02"
            label="Status"
            count={draftStatus != null ? 1 : 0}
          >
            <RadioList
              items={STATUS_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              selected={draftStatus}
              onSelect={(v) => setDraftStatus(v as string | null)}
            />
          </AccordionSection>

          {/* 03 Genre */}
          <AccordionSection
            number="03"
            label="Genre"
            count={draft.genres.length}
          >
            <CheckboxList
              items={genres.map((g) => ({ id: g.id, name: g.name }))}
              selected={selectedGenres}
              onToggle={(id) => toggleSet('genres', id as number)}
            />
          </AccordionSection>

          {/* 04 Tags */}
          <AccordionSection number="04" label="Tags" count={draft.tags.length}>
            <CheckboxList
              items={tags.map((t) => ({ id: t.id, name: t.name }))}
              selected={selectedTags}
              onToggle={(id) => toggleSet('tags', id as number)}
            />
          </AccordionSection>

          {/* 05 Series */}
          <AccordionSection
            number="05"
            label="Series"
            count={draft.seriesIds.length}
          >
            <CheckboxList
              items={seriesList.map((s) => ({ id: s.id, name: s.name }))}
              selected={selectedSeries}
              onToggle={(id) => toggleSet('seriesIds', id as number)}
            />
          </AccordionSection>

          {/* 06 Author */}
          <AccordionSection
            number="06"
            label="Author"
            count={draft.authors.length}
          >
            <CheckboxList
              items={authorList.map((a) => ({ id: a.name, name: a.name }))}
              selected={selectedAuthors}
              onToggle={(id) => toggleSet('authors', id as string)}
            />
          </AccordionSection>

          {/* 07 Format */}
          <AccordionSection
            number="07"
            label="Format"
            count={draft.formats.length}
          >
            <CheckboxList
              items={[
                { id: 'epub', name: 'EPUB' },
                { id: 'pdf', name: 'PDF' },
              ]}
              selected={selectedFormats}
              onToggle={(id) => toggleSet('formats', id as string)}
              searchable={false}
            />
          </AccordionSection>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/10 shrink-0">
          <button
            onClick={handleClear}
            className="px-4 py-2 text-[10px] font-black tracking-widest uppercase border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-colors"
            data-testid="filter-clear-all"
          >
            Clear All
          </button>
          <button
            onClick={handleApply}
            className="px-6 py-2 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/90 transition-colors"
            data-testid="filter-apply"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
