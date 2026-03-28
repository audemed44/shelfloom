import { useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ChevronLeft,
  LayoutGrid,
  LayoutList,
  Layers,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import GroupedBookContent from '../components/shared/GroupedBookContent'
import SaveLensModal from '../components/lenses/SaveLensModal'
import type { Lens, Book, PaginatedResponse } from '../types/api'
import { usePersistedState } from '../hooks/usePersistedState'

const PER_PAGE = 25

export default function LensDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: lens, loading: lensLoading } = useApi<Lens>(
    id ? `/api/lenses/${id}` : null
  )

  const [page, setPage] = useState(1)
  const [view, setView] = usePersistedState('shelfloom:view', 'grid')
  const [groupBySeries, setGroupBySeries] = usePersistedState(
    'shelfloom:groupBySeries',
    false
  )
  const [showEditModal, setShowEditModal] = useState(false)
  const [expandedSeriesIds, setExpandedSeriesIds] = useState<Set<number>>(
    new Set()
  )

  const booksPath = useMemo(() => {
    if (!id) return null
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(PER_PAGE),
    })
    if (groupBySeries) params.set('group_by_series', 'true')
    return `/api/lenses/${id}/books?${params}`
  }, [id, page, groupBySeries])

  const { data: booksData, loading: booksLoading } =
    useApi<PaginatedResponse<Book>>(booksPath)
  const books = booksData?.items ?? []
  const total = booksData?.total ?? 0
  const totalPages =
    booksData?.pages ?? Math.max(1, Math.ceil(total / PER_PAGE))

  const toggleSeriesExpanded = (seriesId: number) => {
    setExpandedSeriesIds((prev) => {
      const next = new Set(prev)
      if (next.has(seriesId)) {
        next.delete(seriesId)
      } else {
        next.add(seriesId)
      }
      return next
    })
  }

  const handleDelete = async () => {
    if (!lens || !confirm(`Delete "${lens.name}"?`)) return
    await api.delete(`/api/lenses/${lens.id}`)
    navigate('/lenses')
  }

  const handleSaved = () => {
    setShowEditModal(false)
    // Force re-fetch of lens by navigating to same page
    window.location.reload()
  }

  if (!lensLoading && !lens) {
    return (
      <div className="p-4 sm:p-6 lg:p-12">
        <p className="text-white/40 font-black tracking-widest">
          Lens not found
        </p>
        <Link to="/lenses" className="text-primary text-sm mt-4 block">
          ← Back to Lenses
        </Link>
      </div>
    )
  }

  // Build a human-readable filter summary
  const filterSummary = lens
    ? (() => {
        const fs = lens.filter_state
        const parts: string[] = []
        if (fs.genres.length > 0) parts.push(`${fs.genres.length} genre(s)`)
        if (fs.tags.length > 0) parts.push(`${fs.tags.length} tag(s)`)
        if (fs.series_ids.length > 0)
          parts.push(`${fs.series_ids.length} series`)
        if (fs.authors.length > 0) parts.push(`${fs.authors.length} author(s)`)
        if (fs.formats.length > 0)
          parts.push(fs.formats.map((f) => f.toUpperCase()).join(', '))
        if (fs.has_rating === true) parts.push('rated')
        if (fs.has_rating === false) parts.push('unrated')
        if (fs.min_rating != null)
          parts.push(`rating ${fs.min_rating.toFixed(1)}+`)
        if (fs.has_review === true) parts.push('has review')
        if (fs.has_review === false) parts.push('no review')
        if (fs.shelf_id != null) parts.push('shelf filter')
        if (fs.status != null) parts.push(`status: ${fs.status}`)
        return parts.length > 0 ? parts.join(' · ') : 'All books'
      })()
    : ''

  return (
    <div className="p-4 sm:p-6 lg:p-12">
      {/* Back link */}
      <Link
        to="/lenses"
        className="flex items-center gap-2 text-[10px] font-black tracking-widest uppercase text-white/30 hover:text-white transition-colors mb-6"
      >
        <ChevronLeft size={14} />
        Lenses
      </Link>

      {/* Header */}
      <header className="mb-6 sm:mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-4xl sm:text-6xl font-black tracking-tighter text-white">
            {lens?.name ?? '…'}
          </h2>
          {lens && (
            <p className="text-white/40 text-sm font-medium mt-2 normal-case">
              {filterSummary} · {lens.book_count}{' '}
              {lens.book_count === 1 ? 'book' : 'books'}
            </p>
          )}
        </div>

        {/* Actions */}
        {lens && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowEditModal(true)}
              className="p-2.5 border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-colors"
              aria-label="Edit lens"
              data-testid="lens-edit-btn"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={handleDelete}
              className="p-2.5 border border-white/10 text-red-400/60 hover:text-red-400 hover:border-red-400/30 transition-colors"
              aria-label="Delete lens"
              data-testid="lens-delete-btn"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </header>

      {/* View controls */}
      <div className="flex justify-end mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setGroupBySeries((prev) => !prev)
              setPage(1)
            }}
            className={`border p-2.5 transition-colors ${
              groupBySeries
                ? 'bg-primary text-white'
                : 'border-white/10 text-white/40 hover:bg-white/5 hover:text-white'
            }`}
            aria-label="Group by series"
            data-testid="group-by-series-toggle"
          >
            <Layers size={16} />
          </button>
          <div
            className="flex border border-white/10"
            data-testid="view-toggle"
          >
            <button
              onClick={() => setView('grid')}
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
              onClick={() => setView('list')}
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

      {/* Books */}
      {booksLoading ? (
        view === 'grid' ? (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4"
            data-testid="book-grid"
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[2/3] bg-white/5 border border-white/10 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-px" data-testid="book-list">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-[88px] bg-white/5 border border-white/10 animate-pulse"
              />
            ))}
          </div>
        )
      ) : books.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-24 text-center"
          data-testid="empty-state"
        >
          <p className="font-black tracking-widest text-white/30">
            No books match this lens
          </p>
        </div>
      ) : (
        <div>
          <GroupedBookContent
            books={books}
            view={view as 'grid' | 'list'}
            groupBySeries={groupBySeries}
            expandedSeriesIds={expandedSeriesIds}
            onToggleSeriesExpanded={toggleSeriesExpanded}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/10">
              <p className="text-xs text-white/30 font-bold tracking-widest">
                {total} Books
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
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
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                  disabled={page === totalPages}
                  className="p-2 text-white/40 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                  aria-label="Next page"
                >
                  <ChevronLeft size={16} className="rotate-180" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit modal */}
      {showEditModal && lens && (
        <SaveLensModal
          existingLens={lens}
          filterState={lens.filter_state}
          onClose={() => setShowEditModal(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
