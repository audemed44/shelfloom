import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { Book } from '../../types'
import { getBookCoverUrl } from '../../utils/bookCover'
import StarRating from '../shared/StarRating'

function fmtFormat(format: string | null | undefined): string {
  if (!format) return ''
  return format.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface BookCardProps {
  book: Book
  isSelecting?: boolean
  isSelected?: boolean
  onToggle?: (id: string) => void
  showRatings?: boolean
  onQuickRate?: (payload: {
    bookId: string
    title: string
    rating: number
  }) => void
}

export default function BookCard({
  book,
  isSelecting,
  isSelected,
  onToggle,
  showRatings = true,
  onQuickRate,
}: BookCardProps) {
  const coverSrc = getBookCoverUrl(book.id, book.cover_path)
  const progress = book.reading_progress
  const isDnf = book.status === 'dnf'
  const isComplete = !isDnf && progress != null && progress >= 100
  const isInProgress =
    !isDnf && progress != null && progress > 0 && progress < 100
  const genres = book.genres ?? []
  const [rating, setRating] = useState<number | null>(book.rating)
  const [savingRating, setSavingRating] = useState(false)

  useEffect(() => {
    setRating(book.rating)
  }, [book.rating])

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onToggle?.(book.id)
  }

  const handleRate = async (
    nextRating: number,
    e?: React.MouseEvent | React.KeyboardEvent
  ) => {
    e?.preventDefault()
    e?.stopPropagation()
    const previous = rating
    setRating(nextRating)
    setSavingRating(true)
    try {
      await api.patch(`/api/books/${book.id}`, { rating: nextRating })
      onQuickRate?.({ bookId: book.id, title: book.title, rating: nextRating })
    } catch {
      setRating(previous)
    } finally {
      setSavingRating(false)
    }
  }

  const coverContent = (
    <div
      className={`book-cover aspect-[2/3] rounded-xl bg-white/5 overflow-hidden transition-all duration-500 ease-out group-hover:-translate-y-1.5 group-hover:shadow-lift ${
        isSelected ? 'outline outline-2 outline-offset-2 outline-primary' : ''
      }`}
    >
      <img
        src={coverSrc}
        alt={book.title}
        loading="lazy"
        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
      {/* Format badge */}
      <div className="absolute top-2 right-2">
        <span className="bg-black text-[9px] font-semibold tracking-widest px-1.5 py-0.5 text-white/80">
          {fmtFormat(book.format)}
        </span>
      </div>

      {/* Genre + tag badges */}
      {(genres.length > 0 || book.tags?.length > 0) && (
        <div className="absolute bottom-0 left-0 right-0 flex flex-wrap gap-1 p-1.5">
          {genres.slice(0, 2).map((genre) => (
            <span
              key={genre.id}
              className="bg-primary text-[9px] font-semibold px-1.5 py-0.5 text-white leading-tight"
            >
              {genre.name}
            </span>
          ))}
          {book.tags?.slice(0, 2).map((t) => (
            <span
              key={t.id}
              className="bg-white text-[9px] font-semibold px-1.5 py-0.5 text-black leading-tight"
            >
              {t.name}
            </span>
          ))}
        </div>
      )}

      {/* Selection checkbox — visible on hover or when selecting */}
      {onToggle && (
        <div
          className={`absolute top-2 left-2 size-6 flex items-center justify-center cursor-pointer transition-opacity ${
            isSelected
              ? 'bg-primary opacity-100'
              : isSelecting
                ? 'bg-black/60 border border-white/30 opacity-100'
                : 'bg-black/60 border border-white/30 opacity-0 group-hover:opacity-100'
          }`}
          onClick={handleCheckboxClick}
          data-testid="book-select-checkbox"
        >
          {isSelected && (
            <Check size={12} strokeWidth={3} className="text-white" />
          )}
        </div>
      )}

      {isDnf && (
        <div
          className="absolute bottom-2 right-2 size-5 bg-red-500 flex items-center justify-center"
          data-testid="book-card-dnf-badge"
        >
          <X size={10} strokeWidth={3} className="text-white" />
        </div>
      )}

      {/* Complete checkmark — moves to bottom-right when checkbox occupies top-left */}
      {!onToggle && isComplete && (
        <div className="absolute top-2 left-2 size-6 bg-primary flex items-center justify-center">
          <Check size={12} strokeWidth={3} className="text-white" />
        </div>
      )}
      {onToggle && isComplete && (
        <div className="absolute bottom-2 right-2 size-5 bg-primary flex items-center justify-center">
          <Check size={10} strokeWidth={3} className="text-white" />
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
  )

  const metaContent = (
    <div className="mt-3 px-0.5">
      <p className="text-sm font-semibold leading-snug text-white/90 line-clamp-2 group-hover:text-white">
        {book.title}
      </p>
      {book.author && (
        <p className="text-xs text-white/45 mt-0.5 truncate">{book.author}</p>
      )}
      <div className="mt-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          {showRatings ? (
            <div className="flex items-center gap-1.5">
              <StarRating
                value={rating}
                onChange={
                  !isSelecting ? (value) => void handleRate(value) : undefined
                }
                size={12}
              />
              {rating != null && (
                <span className="text-[10px] font-black tracking-widest text-white/40">
                  {rating.toFixed(1)}
                </span>
              )}
            </div>
          ) : null}
          {savingRating && (
            <span className="text-[9px] font-black tracking-widest text-white/25">
              SAVING
            </span>
          )}
        </div>
      </div>
    </div>
  )

  if (isSelecting) {
    return (
      <div
        className="group block cursor-pointer"
        data-testid="book-card"
        onClick={() => onToggle?.(book.id)}
      >
        {coverContent}
        {metaContent}
      </div>
    )
  }

  return (
    <Link
      to={`/books/${book.id}`}
      className="group block"
      data-testid="book-card"
    >
      {coverContent}
      {metaContent}
    </Link>
  )
}
