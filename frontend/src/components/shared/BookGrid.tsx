/**
 * BookGrid — simple paginated book grid/list without series grouping or bulk selection.
 * Used by LensDetail and other simple book list pages.
 */

import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import BookCard from '../library/BookCard'
import BookRow from '../library/BookRow'
import { SkeletonCard, SkeletonRow } from '../library/SkeletonCard'
import type { Book } from '../../types'

interface BookGridProps {
  books: Book[]
  view: 'grid' | 'list'
  loading: boolean
  total: number
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  emptyMessage?: string
}

export default function BookGrid({
  books,
  view,
  loading,
  total,
  page,
  totalPages,
  onPageChange,
  emptyMessage = 'No books found',
}: BookGridProps) {
  if (loading) {
    return view === 'grid' ? (
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
  }

  if (books.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-24 text-center"
        data-testid="empty-state"
      >
        <BookOpen size={48} className="text-white/10 mb-4" />
        <p className="font-black tracking-widest text-white/30">
          {emptyMessage}
        </p>
      </div>
    )
  }

  return (
    <div>
      {view === 'grid' ? (
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

      {total > books.length || page > 1 ? (
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/10">
          <p className="text-xs text-white/30 font-bold tracking-widest">
            {total} Books
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onPageChange(Math.max(1, page - 1))}
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
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="p-2 text-white/40 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
