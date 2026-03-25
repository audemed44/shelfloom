import { ExternalLink, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Book } from '../../types'

interface SeriesRowProps {
  seriesId: number
  seriesName: string
  books: Book[]
  totalBookCount?: number
  onExpand: () => void
  isSelecting?: boolean
  isAllSelected?: boolean
  isPartiallySelected?: boolean
  onToggleAll?: () => void
}

export default function SeriesRow({
  seriesId,
  seriesName,
  books,
  totalBookCount,
  onExpand,
  isSelecting,
  isAllSelected,
  isPartiallySelected,
  onToggleAll,
}: SeriesRowProps) {
  const sorted = [...books].sort(
    (a, b) => (a.series_sequence ?? Infinity) - (b.series_sequence ?? Infinity)
  )
  const firstBook = sorted[0]
  const coverSrc = firstBook ? `/api/books/${firstBook.id}/cover` : undefined

  const count = totalBookCount ?? books.length
  const readCount = books.filter(
    (b) => b.reading_progress != null && b.reading_progress >= 100
  ).length
  const allRead = readCount === books.length && books.length > 0

  return (
    <div
      className="group flex items-center gap-4 p-4 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer"
      data-testid="series-row"
    >
      {/* Selection checkbox */}
      {onToggleAll && (
        <div
          className={`size-5 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-opacity ${
            isAllSelected
              ? 'bg-primary opacity-100'
              : isPartiallySelected
                ? 'bg-primary/50 opacity-100'
                : isSelecting
                  ? 'border border-white/30 opacity-100'
                  : 'border border-white/30 opacity-0 group-hover:opacity-100'
          }`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggleAll()
          }}
          data-testid="series-select-checkbox"
        >
          {(isAllSelected || isPartiallySelected) && (
            <Check size={10} strokeWidth={3} className="text-white" />
          )}
        </div>
      )}

      <button
        onClick={onExpand}
        className="flex items-center gap-4 flex-1 min-w-0 bg-transparent border-0 p-0 text-left cursor-pointer"
        aria-label={`Expand ${seriesName}`}
      >
        {/* Small cover */}
        <div
          className="w-10 h-14 bg-white/10 border border-white/10 group-hover:border-primary transition-colors shrink-0 overflow-hidden relative"
          style={{
            boxShadow:
              '2px -2px 0 0 rgba(255,255,255,0.05), 4px -4px 0 0 rgba(255,255,255,0.03)',
          }}
        >
          {coverSrc && (
            <img
              src={coverSrc}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-black tracking-tighter truncate text-white">
            {seriesName}
          </p>
          <p className="text-xs text-white/40 mt-0.5 normal-case truncate">
            {count} {count === 1 ? 'book' : 'books'}
            {readCount > 0 && ` \u00B7 ${readCount} read`}
          </p>
        </div>
      </button>

      {/* Right side */}
      <div className="hidden sm:flex items-center gap-4 shrink-0">
        {allRead && <Check size={14} className="text-primary" />}
        <Link
          to={`/series/${seriesId}`}
          className="p-1 text-white/30 hover:text-primary transition-colors"
          onClick={(e) => e.stopPropagation()}
          aria-label={`View ${seriesName} series page`}
          data-testid="series-link"
        >
          <ExternalLink size={14} />
        </Link>
      </div>
    </div>
  )
}
