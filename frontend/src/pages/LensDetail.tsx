import { useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ChevronLeft,
  LayoutGrid,
  LayoutList,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import BookGrid from '../components/shared/BookGrid'
import SaveLensModal from '../components/lenses/SaveLensModal'
import type { Lens, Book, PaginatedResponse } from '../types/api'
import { usePersistedState } from '../hooks/usePersistedState'

const PER_PAGE = 24

export default function LensDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: lens, loading: lensLoading } = useApi<Lens>(
    id ? `/api/lenses/${id}` : null
  )

  const [page, setPage] = useState(1)
  const [view, setView] = usePersistedState('shelfloom:view', 'grid')
  const [showEditModal, setShowEditModal] = useState(false)

  const booksPath = useMemo(() => {
    if (!id) return null
    return `/api/lenses/${id}/books?page=${page}&per_page=${PER_PAGE}`
  }, [id, page])

  const { data: booksData, loading: booksLoading } =
    useApi<PaginatedResponse<Book>>(booksPath)
  const books = booksData?.items ?? []
  const total = booksData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

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

      {/* View toggle */}
      <div className="flex justify-end mb-4">
        <div className="flex border border-white/10" data-testid="view-toggle">
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

      {/* Books */}
      <BookGrid
        books={books}
        view={view as 'grid' | 'list'}
        loading={booksLoading}
        total={total}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage="No books match this lens"
      />

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
