import { Check, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Book } from '../../types'

interface SeriesCardProps {
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

export default function SeriesCard({
  seriesId,
  seriesName,
  books,
  totalBookCount,
  onExpand,
  isSelecting,
  isAllSelected,
  isPartiallySelected,
  onToggleAll,
}: SeriesCardProps) {
  // Use first book by sequence for cover
  const sorted = [...books].sort(
    (a, b) => (a.series_sequence ?? Infinity) - (b.series_sequence ?? Infinity)
  )
  const firstBook = sorted[0]
  const coverSrc = firstBook ? `/api/books/${firstBook.id}/cover` : undefined

  const count = totalBookCount ?? books.length
  const readCount = books.filter(
    (b) =>
      b.status !== 'dnf' &&
      b.reading_progress != null &&
      b.reading_progress >= 100
  ).length

  // Sequence range
  const sequences = sorted
    .map((b) => b.series_sequence)
    .filter((s): s is number => s != null)
  const seqRange =
    sequences.length > 0
      ? sequences.length === 1
        ? `#${sequences[0]}`
        : `#${sequences[0]}–${sequences[sequences.length - 1]}`
      : null

  return (
    <div className="group block" data-testid="series-card">
      {/* Cover with stacked effect */}
      <button
        onClick={onExpand}
        className="w-full text-left cursor-pointer bg-transparent border-0 p-0"
        aria-label={`Expand ${seriesName}`}
      >
        <div className="relative">
          {/* Stacked layers */}
          <div
            className="aspect-[2/3] bg-white/5 border border-white/10 group-hover:border-primary transition-colors overflow-hidden relative"
            style={{
              boxShadow:
                '4px -4px 0 0 rgba(255,255,255,0.05), 8px -8px 0 0 rgba(255,255,255,0.03)',
            }}
          >
            {coverSrc && (
              <img
                src={coverSrc}
                alt={seriesName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}

            {/* Overlay gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

            {/* Book count badge — hidden when checkbox is present */}
            {!onToggleAll && (
              <div className="absolute top-2 left-2">
                <span className="bg-primary/90 text-[9px] font-black tracking-widest px-1.5 py-0.5 text-white">
                  {count} {count === 1 ? 'BOOK' : 'BOOKS'}
                </span>
              </div>
            )}

            {/* Series link */}
            <Link
              to={`/series/${seriesId}`}
              className="absolute top-2 right-2 p-1 bg-black/60 text-white/50 hover:text-primary transition-colors"
              onClick={(e) => e.stopPropagation()}
              aria-label={`View ${seriesName} series page`}
              data-testid="series-link"
            >
              <ExternalLink size={12} />
            </Link>

            {/* Selection checkbox */}
            {onToggleAll && (
              <div
                className={`absolute top-2 left-2 size-6 rounded-full flex items-center justify-center shadow-lg cursor-pointer transition-opacity z-10 ${
                  isAllSelected
                    ? 'bg-primary opacity-100'
                    : isPartiallySelected
                      ? 'bg-primary/50 opacity-100'
                      : isSelecting
                        ? 'bg-black/60 border border-white/30 opacity-100'
                        : 'bg-black/60 border border-white/30 opacity-0 group-hover:opacity-100'
                }`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onToggleAll()
                }}
                data-testid="series-select-checkbox"
              >
                {(isAllSelected || isPartiallySelected) && (
                  <Check size={12} strokeWidth={3} className="text-white" />
                )}
              </div>
            )}

            {/* Bottom info */}
            <div className="absolute bottom-0 left-0 right-0 px-2 py-2">
              {seqRange && (
                <span className="text-[9px] font-bold tracking-wider text-white/50">
                  {seqRange}
                </span>
              )}
              {readCount > 0 && (
                <span className="text-[9px] font-bold tracking-wider text-white/50 ml-2">
                  {readCount}/{books.length} read
                </span>
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Meta */}
      <div className="mt-2 px-0.5">
        <p className="text-sm font-black tracking-tighter leading-tight line-clamp-2">
          {seriesName}
        </p>
        <p className="text-xs text-white/40 mt-0.5 normal-case truncate">
          {count} {count === 1 ? 'book' : 'books'}
          {readCount > 0 && ` \u00B7 ${readCount} read`}
        </p>
      </div>
    </div>
  )
}
