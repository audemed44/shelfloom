import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Book } from '../../types'

function fmtFormat(format: string | null | undefined): string {
  if (!format) return ''
  return format.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface BookCardProps {
  book: Book
  isSelecting?: boolean
  isSelected?: boolean
  onToggle?: (id: string) => void
}

export default function BookCard({
  book,
  isSelecting,
  isSelected,
  onToggle,
}: BookCardProps) {
  const coverSrc = `/api/books/${book.id}/cover`
  const progress = book.reading_progress
  const isComplete = progress != null && progress >= 100
  const isInProgress = progress != null && progress > 0 && progress < 100
  const genres = book.genres ?? []

  const cardContent = (
    <>
      {/* Cover */}
      <div
        className={`aspect-[2/3] bg-white/5 border transition-colors overflow-hidden relative ${
          isSelected
            ? 'border-primary'
            : 'border-white/10 group-hover:border-primary'
        }`}
      >
        <img
          src={coverSrc}
          alt={book.title}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
        {/* Format badge */}
        <div className="absolute top-2 right-2">
          <span className="bg-black/70 text-[9px] font-black tracking-widest px-1.5 py-0.5 text-white/50">
            {fmtFormat(book.format)}
          </span>
        </div>

        {/* Genre + tag badges */}
        {(genres.length > 0 || book.tags?.length > 0) && (
          <div className="absolute bottom-0 left-0 right-0 flex flex-wrap gap-1 px-2 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
            {genres.slice(0, 2).map((genre) => (
              <span
                key={genre.id}
                className="bg-primary/80 text-[8px] font-black tracking-widest px-1.5 py-0.5 text-white normal-case leading-tight"
              >
                {genre.name}
              </span>
            ))}
            {book.tags?.slice(0, 2).map((t) => (
              <span
                key={t.id}
                className="bg-amber-500/80 text-[8px] font-black tracking-widest px-1.5 py-0.5 text-white normal-case leading-tight"
              >
                {t.name}
              </span>
            ))}
          </div>
        )}

        {/* Selection checkbox */}
        {isSelecting && (
          <div
            className={`absolute top-2 left-2 size-6 rounded-full flex items-center justify-center shadow-lg ${
              isSelected ? 'bg-primary' : 'bg-black/60 border border-white/30'
            }`}
            data-testid="book-select-checkbox"
          >
            {isSelected && (
              <Check size={12} strokeWidth={3} className="text-white" />
            )}
          </div>
        )}

        {/* Complete checkmark (hidden when selecting) */}
        {!isSelecting && isComplete && (
          <div className="absolute top-2 left-2 size-6 rounded-full bg-primary flex items-center justify-center shadow-lg">
            <Check size={12} strokeWidth={3} className="text-white" />
          </div>
        )}

        {/* Reading progress bar */}
        {isInProgress && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="mt-2 px-0.5">
        <p className="text-sm font-black tracking-tighter leading-tight line-clamp-2">
          {book.title}
        </p>
        {book.author && (
          <p className="text-xs text-white/40 mt-0.5 normal-case truncate">
            {book.author}
          </p>
        )}
      </div>
    </>
  )

  if (isSelecting) {
    return (
      <div
        className="group block cursor-pointer"
        data-testid="book-card"
        onClick={() => onToggle?.(book.id)}
      >
        {cardContent}
      </div>
    )
  }

  return (
    <Link
      to={`/books/${book.id}`}
      className="group block"
      data-testid="book-card"
    >
      {cardContent}
    </Link>
  )
}
