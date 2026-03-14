import { useState, useMemo, useRef, useCallback } from 'react'
import {
  Search,
  LayoutGrid,
  LayoutList,
  ChevronLeft,
  ChevronRight,
  BookOpen,
} from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { useDebounce } from '../hooks/useDebounce'
import BookCard from '../components/library/BookCard'
import BookRow from '../components/library/BookRow'
import { SkeletonCard, SkeletonRow } from '../components/library/SkeletonCard'
import UploadZone from '../components/library/UploadZone'
import type { Book, Shelf, PaginatedResponse } from '../types'

const PER_PAGE = 24

const SORT_OPTIONS = [
  { value: 'last_read', label: 'Last Read' },
  { value: 'created_at', label: 'Newest' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'author', label: 'Author A–Z' },
]

const STATUS_OPTIONS = [
  { value: null, label: 'All' },
  { value: 'reading', label: 'Reading' },
  { value: 'unread', label: 'Unread' },
  { value: 'completed', label: 'Completed' },
]

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ShelfTabsProps {
  shelves: Shelf[]
  selectedId: number | null
  onSelect: (id: number | null) => void
}

function ShelfTabs({ shelves, selectedId, onSelect }: ShelfTabsProps) {
  return (
    <div className="flex gap-0 border-b border-white/10 mb-6 overflow-x-auto no-scrollbar">
      <TabButton
        active={!selectedId}
        onClick={() => onSelect(null)}
        data-testid="shelf-tab-all"
      >
        All
      </TabButton>
      {shelves.map((s) => (
        <TabButton
          key={s.id}
          active={selectedId === s.id}
          onClick={() => onSelect(s.id)}
        >
          {s.name}
        </TabButton>
      ))}
    </div>
  )
}

interface TabButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

function TabButton({ active, onClick, children, ...rest }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      {...rest}
      className={`px-5 py-3 text-xs font-black tracking-widest whitespace-nowrap border-b-2 -mb-px transition-colors ${
        active
          ? 'text-primary border-primary'
          : 'text-white/40 border-transparent hover:text-white/60'
      }`}
    >
      {children}
    </button>
  )
}

interface ControlsProps {
  search: string
  onSearch: (v: string) => void
  sort: string
  onSort: (v: string) => void
  view: string
  onView: (v: string) => void
}

function Controls({
  search,
  onSearch,
  sort,
  onSort,
  view,
  onView,
}: ControlsProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 mb-6">
      {/* Search — full width on mobile */}
      <div className="relative flex-1">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
        />
        <input
          type="text"
          placeholder="Search by title or author..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full bg-white/5 border border-white/10 pl-9 pr-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-primary/60 normal-case"
          data-testid="search-input"
        />
      </div>

      <div className="flex gap-3">
        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value)}
          className="flex-1 sm:flex-none bg-black border border-white/10 px-3 py-2.5 text-xs font-black tracking-widest text-white/60 focus:outline-none focus:border-primary/60"
          data-testid="sort-select"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} className="bg-black">
              {o.label}
            </option>
          ))}
        </select>

        {/* View toggle */}
        <div className="flex border border-white/10" data-testid="view-toggle">
          <button
            onClick={() => onView('grid')}
            className={`p-2.5 transition-colors ${
              view === 'grid'
                ? 'bg-primary text-white'
                : 'text-white/40 hover:text-white hover:bg-white/5'
            }`}
            aria-label="Grid view"
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => onView('list')}
            className={`p-2.5 transition-colors ${
              view === 'list'
                ? 'bg-primary text-white'
                : 'text-white/40 hover:text-white hover:bg-white/5'
            }`}
            aria-label="List view"
          >
            <LayoutList size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

interface EmptyStateProps {
  search: string
}

function EmptyState({ search }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-24 text-center"
      data-testid="empty-state"
    >
      <BookOpen size={48} className="text-white/10 mb-4" />
      {search ? (
        <>
          <p className="font-black tracking-widest text-white/30">No Results</p>
          <p className="text-xs text-white/20 mt-1 normal-case">
            No books matching &ldquo;{search}&rdquo;
          </p>
        </>
      ) : (
        <>
          <p className="font-black tracking-widest text-white/30">
            No Books Yet
          </p>
          <p className="text-xs text-white/20 mt-1 normal-case">
            Upload books or run a shelf scan to get started
          </p>
        </>
      )}
    </div>
  )
}

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  onPage: React.Dispatch<React.SetStateAction<number>>
}

function Pagination({ page, totalPages, total, onPage }: PaginationProps) {
  return (
    <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/10">
      <p className="text-xs text-white/30 font-bold tracking-widest">
        {total} Books
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="p-2 text-white/40 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs font-black tracking-widest text-white/60">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
          className="p-2 text-white/40 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Library() {
  const [view, setView] = useState('grid')
  const [search, setSearch] = useState('')
  const [selectedShelfId, setSelectedShelfId] = useState<number | null>(null)
  const [sort, setSort] = useState('last_read')
  const [status, setStatus] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [rev, setRev] = useState(0)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounter = useRef(0)

  const debouncedSearch = useDebounce(search, 300)

  const resetPage = () => setPage(1)

  const handleUploadSuccess = useCallback(() => {
    setRev((r) => r + 1)
  }, [])

  // Page-level drag detection to highlight the upload zone
  const handleDragEnter = () => {
    dragCounter.current++
    setIsDraggingOver(true)
  }
  const handleDragLeave = () => {
    dragCounter.current--
    if (dragCounter.current === 0) setIsDraggingOver(false)
  }
  const handlePageDrop = () => {
    dragCounter.current = 0
    setIsDraggingOver(false)
  }

  // Shelves for tab bar
  const { data: shelves } = useApi<Shelf[]>('/api/shelves')

  // Books — re-fetches whenever any filter/sort/page/rev changes
  const booksPath = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(PER_PAGE),
      sort,
    })
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (selectedShelfId) params.set('shelf_id', String(selectedShelfId))
    if (status) params.set('status', status)
    if (rev > 0) params.set('_rev', String(rev))
    return `/api/books?${params}`
  }, [page, debouncedSearch, selectedShelfId, sort, status, rev])

  const { data: booksData, loading } =
    useApi<PaginatedResponse<Book>>(booksPath)
  const books = booksData?.items ?? []
  const total = booksData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <div
      className="p-4 sm:p-6 lg:p-12"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handlePageDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Header */}
      <header className="mb-6 sm:mb-8">
        <h2 className="text-4xl sm:text-6xl font-black tracking-tighter text-white">
          Library
        </h2>
        {!loading && (
          <p className="text-white/40 text-base sm:text-lg font-medium mt-2 normal-case">
            {total > 0
              ? `${total} books in your collection`
              : 'Your book collection'}
          </p>
        )}
      </header>

      {/* Upload zone */}
      <UploadZone
        onSuccess={handleUploadSuccess}
        highlighted={isDraggingOver}
      />

      {/* Shelf tabs */}
      {shelves && shelves.length > 0 && (
        <ShelfTabs
          shelves={shelves}
          selectedId={selectedShelfId}
          onSelect={(id) => {
            setSelectedShelfId(id)
            resetPage()
          }}
        />
      )}

      {/* Status filter pills */}
      <div className="flex gap-2 mb-5">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={String(opt.value)}
            onClick={() => {
              setStatus(opt.value)
              resetPage()
            }}
            className={`px-3 py-1.5 text-[10px] font-black tracking-widest uppercase rounded transition-colors ${
              status === opt.value
                ? 'bg-primary text-white'
                : 'bg-white/5 border border-white/10 text-white/40 hover:text-white hover:border-white/20'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <Controls
        search={search}
        onSearch={(v) => {
          setSearch(v)
          resetPage()
        }}
        sort={sort}
        onSort={(v) => {
          setSort(v)
          resetPage()
        }}
        view={view}
        onView={setView}
      />

      {/* Content */}
      {loading ? (
        view === 'grid' ? (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4"
            data-testid="book-grid"
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-px" data-testid="book-list">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        )
      ) : books.length === 0 ? (
        <EmptyState search={debouncedSearch} />
      ) : view === 'grid' ? (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4"
          data-testid="book-grid"
        >
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      ) : (
        <div className="space-y-px" data-testid="book-list">
          {books.map((book) => (
            <BookRow key={book.id} book={book} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && total > PER_PAGE && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPage={setPage}
        />
      )}
    </div>
  )
}
