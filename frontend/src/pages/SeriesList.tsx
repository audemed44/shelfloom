import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Edit2, PlusCircle, Search, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import SeriesModal from '../components/series/SeriesModal'
import type { SeriesWithCount } from '../types/api'
import { getBookCoverUrl } from '../utils/bookCover'

const PER_PAGE = 20

interface SeriesGroup {
  parent: SeriesWithCount
  children: SeriesWithCount[]
  totalBooks: number
}

function buildGroups(flat: SeriesWithCount[]): SeriesGroup[] {
  const roots = flat.filter((s) => s.parent_id == null)
  const addedIds = new Set<number>()
  const groups: SeriesGroup[] = []

  for (const root of roots) {
    const children = flat.filter((s) => s.parent_id === root.id)
    const totalBooks =
      root.book_count + children.reduce((sum, c) => sum + c.book_count, 0)
    groups.push({ parent: root, children, totalBooks })
    addedIds.add(root.id)
    children.forEach((c) => addedIds.add(c.id))
  }

  // Orphaned children (parent was deleted etc.)
  for (const s of flat) {
    if (!addedIds.has(s.id)) {
      groups.push({ parent: s, children: [], totalBooks: s.book_count })
    }
  }

  return groups
}

function CoverThumb({
  bookId,
  coverPath,
  size = 'md',
}: {
  bookId: string | null
  coverPath: string | null
  size?: 'sm' | 'md'
}) {
  const dims = size === 'sm' ? 'w-8 h-[44px]' : 'w-9 h-[52px]'
  return bookId ? (
    <img
      src={getBookCoverUrl(bookId, coverPath)}
      alt=""
      className={`${dims} object-cover bg-white/5 shrink-0`}
    />
  ) : (
    <div
      className={`${dims} bg-white/5 border border-white/10 flex items-center justify-center shrink-0`}
    >
      <BookOpen size={12} className="text-white/20" />
    </div>
  )
}

function RowActions({
  series,
  onEdit,
  onDelete,
}: {
  series: SeriesWithCount
  onEdit: (s: SeriesWithCount) => void
  onDelete: (s: SeriesWithCount) => void
}) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        onClick={() => onEdit(series)}
        aria-label={`Edit ${series.name}`}
        className="p-1.5 text-white/40 hover:text-white transition-colors"
      >
        <Edit2 size={13} />
      </button>
      <button
        onClick={() => onDelete(series)}
        aria-label={`Delete ${series.name}`}
        className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function GroupCard({
  group,
  onEdit,
  onDelete,
}: {
  group: SeriesGroup
  onEdit: (s: SeriesWithCount) => void
  onDelete: (s: SeriesWithCount) => void
}) {
  const { parent, children, totalBooks } = group
  const hasChildren = children.length > 0

  if (!hasChildren) {
    // Standalone series — simple flat row
    return (
      <div
        className="flex items-center gap-4 px-4 py-3 border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
        data-testid={`series-row-${parent.id}`}
      >
        <Link to={`/series/${parent.id}`} className="shrink-0">
          <CoverThumb
            bookId={parent.first_book_id}
            coverPath={parent.first_book_cover_path}
          />
        </Link>
        <div className="flex-1 min-w-0">
          <Link
            to={`/series/${parent.id}`}
            className="text-sm text-white/80 normal-case hover:text-white transition-colors truncate block"
          >
            {parent.name}
          </Link>
        </div>
        <span className="shrink-0 text-[10px] font-black tracking-widest uppercase text-white/30 bg-white/5 px-1.5 py-0.5">
          {totalBooks} {totalBooks === 1 ? 'book' : 'books'}
        </span>
        <RowActions series={parent} onEdit={onEdit} onDelete={onDelete} />
      </div>
    )
  }

  // Parent + children grouped card
  return (
    <div
      className="border-b border-white/5 last:border-0"
      data-testid={`series-row-${parent.id}`}
    >
      {/* Parent header */}
      <div className="flex items-center gap-4 px-4 py-3 bg-white/[0.03] border-b border-white/10">
        <Link to={`/series/${parent.id}`} className="shrink-0">
          {/* TODO: decide proper parent cover logic (dedicated upload, or inherit from parent's own books) */}
          <CoverThumb
            bookId={children[0]?.first_book_id ?? parent.first_book_id}
            coverPath={
              children[0]?.first_book_cover_path ?? parent.first_book_cover_path
            }
          />
        </Link>
        <div className="flex-1 min-w-0">
          <Link
            to={`/series/${parent.id}`}
            className="text-sm font-bold text-white normal-case hover:text-primary transition-colors truncate block"
          >
            {parent.name}
          </Link>
          <p className="text-[10px] font-black tracking-widest uppercase text-white/30 mt-0.5">
            {children.length} {children.length === 1 ? 'series' : 'series'} ·{' '}
            {totalBooks} {totalBooks === 1 ? 'book' : 'books'} total
          </p>
        </div>
        <RowActions series={parent} onEdit={onEdit} onDelete={onDelete} />
      </div>

      {/* Children */}
      {children.map((child) => (
        <div
          key={child.id}
          className="flex items-center gap-4 pl-8 pr-4 py-3 border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
          data-testid={`series-row-${child.id}`}
        >
          <Link to={`/series/${child.id}`} className="shrink-0">
            <CoverThumb
              bookId={child.first_book_id}
              coverPath={child.first_book_cover_path}
              size="sm"
            />
          </Link>
          <div className="flex-1 min-w-0">
            <Link
              to={`/series/${child.id}`}
              className="text-sm text-white/70 normal-case hover:text-white transition-colors truncate block"
            >
              {child.name}
            </Link>
          </div>
          <span className="shrink-0 text-[10px] font-black tracking-widest uppercase text-white/30 bg-white/5 px-1.5 py-0.5">
            {child.book_count} {child.book_count === 1 ? 'book' : 'books'}
          </span>
          <RowActions series={child} onEdit={onEdit} onDelete={onDelete} />
        </div>
      ))}
    </div>
  )
}

export default function SeriesList() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [editingSeries, setEditingSeries] = useState<
    SeriesWithCount | null | undefined
  >(undefined)
  const [showCreate, setShowCreate] = useState(false)
  const [purgeResult, setPurgeResult] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data: flatList } = useApi<SeriesWithCount[]>(
    `/api/series/tree?_k=${refreshKey}`
  )
  const allSeries = useMemo<SeriesWithCount[]>(() => flatList ?? [], [flatList])
  const groups = useMemo(() => buildGroups(allSeries), [allSeries])

  const filtered = useMemo(() => {
    if (!search.trim()) return groups
    const q = search.toLowerCase()
    return groups.filter(
      (g) =>
        g.parent.name.toLowerCase().includes(q) ||
        g.children.some((c) => c.name.toLowerCase().includes(q))
    )
  }, [groups, search])

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const currentPage = Math.min(page, pages)
  const pageItems = filtered.slice(
    (currentPage - 1) * PER_PAGE,
    currentPage * PER_PAGE
  )

  const handleSearch = (q: string) => {
    setSearch(q)
    setPage(1)
  }

  const handleDelete = async (s: SeriesWithCount) => {
    if (!window.confirm(`Delete series "${s.name}"?`)) return
    try {
      await api.delete(`/api/series/${s.id}`)
      setRefreshKey((k) => k + 1)
    } catch {
      // ignore
    }
  }

  const handlePurge = async () => {
    try {
      const result = await api.delete<{ deleted: string[]; count: number }>(
        '/api/series/empty'
      )
      if (result && result.count > 0) {
        setPurgeResult(`Deleted ${result.count}: ${result.deleted.join(', ')}`)
      } else {
        setPurgeResult('No empty series found')
      }
      setRefreshKey((k) => k + 1)
    } catch {
      setPurgeResult('Failed to purge.')
    }
  }

  const handleSaved = () => {
    setShowCreate(false)
    setEditingSeries(undefined)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="p-4 sm:p-6 lg:p-12">
      {/* Header */}
      <header className="mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-4xl sm:text-6xl font-black tracking-tighter text-white">
              Series
            </h1>
            <p className="text-white/40 text-base sm:text-lg font-medium mt-2 normal-case">
              {allSeries.length > 0
                ? `${allSeries.length} series in your library`
                : 'Organize books into series'}
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 sm:shrink-0 sm:mt-2">
            <button
              onClick={handlePurge}
              data-testid="purge-btn"
              className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm font-semibold border border-white/20 text-white/60 hover:text-white hover:border-white/40 rounded-lg transition-colors normal-case"
            >
              Purge Empty
            </button>
            <button
              onClick={() => setShowCreate(true)}
              data-testid="new-series-btn"
              className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm font-semibold bg-primary text-white hover:bg-primary/80 rounded-lg transition-colors normal-case"
            >
              <PlusCircle size={16} />
              New Series
            </button>
          </div>
        </div>
      </header>

      {/* Purge result banner */}
      {purgeResult && (
        <div
          className="px-4 py-3 mb-6 border border-white/10 bg-white/5 text-sm text-white/70 normal-case"
          data-testid="purge-result"
        >
          {purgeResult}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-5xl mb-4">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
        />
        <input
          type="text"
          placeholder="Search series..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full bg-black border border-white/10 pl-9 pr-4 py-2.5 text-sm text-white placeholder-white/20 focus:border-primary focus:outline-none normal-case"
        />
      </div>

      {/* Series list */}
      <div
        className="border border-white/10 bg-black max-w-5xl"
        data-testid="series-list"
      >
        {pageItems.length === 0 ? (
          <p className="text-sm text-white/30 text-center py-12 normal-case">
            {search ? 'No series match your search' : 'No series yet'}
          </p>
        ) : (
          pageItems.map((group) => (
            <GroupCard
              key={group.parent.id}
              group={group}
              onEdit={(s) => setEditingSeries(s)}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between max-w-5xl mt-4">
          <span className="text-[10px] font-black tracking-widest uppercase text-white/30">
            {(currentPage - 1) * PER_PAGE + 1}–
            {Math.min(currentPage * PER_PAGE, filtered.length)} of{' '}
            {filtered.length}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-xs font-bold border border-white/10 text-white/40 hover:text-white hover:border-white/30 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={currentPage === pages}
              className="px-3 py-1.5 text-xs font-bold border border-white/10 text-white/40 hover:text-white hover:border-white/30 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <SeriesModal
          allSeries={allSeries}
          onClose={() => setShowCreate(false)}
          onSaved={handleSaved}
        />
      )}
      {editingSeries !== undefined && editingSeries !== null && (
        <SeriesModal
          series={editingSeries}
          allSeries={allSeries}
          onClose={() => setEditingSeries(undefined)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
