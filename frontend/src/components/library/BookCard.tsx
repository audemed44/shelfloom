import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { Book } from '../../types'
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
  const coverSrc = `/api/books/${book.id}/cover`
  const progress = book.reading_progress
  const isDnf = book.status === 'dnf'
  const isComplete = !isDnf && progress != null && progress >= 100
  const isInProgress =
    !isDnf && progress != null && progress > 0 && progress < 100
  const genres = book.genres ?? []
  const [rating, setRating] = useState<number | null>(book.rating)
  const [savingRating, setSavingRating] = useState(false)
  const [mobileRateOpen, setMobileRateOpen] = useState(false)

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

      {/* Selection checkbox — visible on hover or when selecting */}
      {onToggle && (
        <div
          className={`absolute top-2 left-2 size-6 rounded-full flex items-center justify-center shadow-lg cursor-pointer transition-opacity ${
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
        <div className="absolute bottom-2 right-2 size-5 rounded-full bg-red-500 flex items-center justify-center shadow-lg">
          <X size={10} strokeWidth={3} className="text-white" />
        </div>
      )}

      {/* Complete checkmark — moves to bottom-right when checkbox occupies top-left */}
      {!onToggle && isComplete && (
        <div className="absolute top-2 left-2 size-6 rounded-full bg-primary flex items-center justify-center shadow-lg">
          <Check size={12} strokeWidth={3} className="text-white" />
        </div>
      )}
      {onToggle && isComplete && (
        <div className="absolute bottom-2 right-2 size-5 rounded-full bg-primary flex items-center justify-center shadow-lg">
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
    <div className="mt-2 px-0.5">
      <p className="text-sm font-black tracking-tighter leading-tight line-clamp-2">
        {book.title}
      </p>
      {book.author && (
        <p className="text-xs text-white/40 mt-0.5 normal-case truncate">
          {book.author}
        </p>
      )}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {showRatings && rating != null ? (
            <div className="flex items-center gap-1.5">
              <StarRating value={rating} readOnly size={12} />
              <span className="text-[10px] font-black tracking-widest text-white/40">
                {rating.toFixed(1)}
              </span>
            </div>
          ) : isDnf ? (
            <span className="text-[10px] font-black tracking-widest text-red-400">
              DNF
            </span>
          ) : null}
          {book.has_review && (
            <span className="text-[10px] font-black tracking-widest text-white/25">
              NOTE
            </span>
          )}
        </div>

        {!isSelecting && showRatings && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMobileRateOpen((prev) => !prev)
            }}
            className="sm:hidden text-[9px] font-black tracking-widest uppercase text-white/40 border border-white/10 px-2 py-1"
          >
            Rate
          </button>
        )}
      </div>

      {!isSelecting && showRatings && (
        <>
          <div
            className="hidden sm:flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <span className="text-[9px] font-black tracking-widest uppercase text-white/25">
              Quick Rate
            </span>
            <StarRating
              value={rating}
              onChange={(value) => void handleRate(value)}
            />
            {savingRating && (
              <span className="text-[9px] font-black tracking-widest text-white/25">
                SAVING
              </span>
            )}
          </div>

          {mobileRateOpen && (
            <div
              className="sm:hidden flex items-center gap-2 mt-2"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              <StarRating
                value={rating}
                onChange={(value) => void handleRate(value)}
                size={16}
              />
            </div>
          )}
        </>
      )}
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
