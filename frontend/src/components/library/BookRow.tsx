import { useEffect, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { Book } from '../../types'
import StarRating from '../shared/StarRating'

function fmtFormat(format: string | null | undefined): string {
  if (!format) return ''
  return format.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface BookRowProps {
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

export default function BookRow({
  book,
  isSelecting,
  isSelected,
  onToggle,
  showRatings = true,
  onQuickRate,
}: BookRowProps) {
  const coverSrc = `/api/books/${book.id}/cover`
  const genres = book.genres ?? []
  const [rating, setRating] = useState<number | null>(book.rating)
  const [savingRating, setSavingRating] = useState(false)

  useEffect(() => {
    setRating(book.rating)
  }, [book.rating])

  const isDnf = book.status === 'dnf'

  const handleRate = async (nextRating: number) => {
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

  const rowContent = (
    <>
      {/* Selection checkbox — always present when onToggle provided */}
      {onToggle && (
        <div
          className={`size-5 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-opacity ${
            isSelected
              ? 'bg-primary opacity-100'
              : isSelecting
                ? 'border border-white/30 opacity-100'
                : 'border border-white/30 opacity-0 group-hover:opacity-100'
          }`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggle(book.id)
          }}
          data-testid="book-select-checkbox"
        >
          {isSelected && (
            <Check size={10} strokeWidth={3} className="text-white" />
          )}
        </div>
      )}

      {/* Small cover */}
      <div
        className={`w-10 h-14 bg-white/10 border transition-colors shrink-0 overflow-hidden ${
          isSelected
            ? 'border-primary'
            : 'border-white/10 group-hover:border-primary'
        }`}
      >
        <img
          src={coverSrc}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-black tracking-tighter truncate">{book.title}</p>
        {book.author && (
          <p className="text-xs text-white/40 mt-0.5 normal-case truncate">
            {book.author}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
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
                <span className="text-[10px] font-black tracking-widest text-white/35">
                  {rating.toFixed(1)}
                </span>
              )}
            </div>
          ) : null}
          {isDnf && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black tracking-widest text-red-400">
              <AlertTriangle size={10} />
              DNF
            </span>
          )}
          {book.has_review && (
            <span className="text-[10px] font-black tracking-widest text-white/25">
              NOTE
            </span>
          )}
          {savingRating && (
            <span className="text-[9px] font-black tracking-widest text-white/25">
              SAVING
            </span>
          )}
        </div>
        {(genres.length > 0 || book.tags?.length > 0) && (
          <div className="flex flex-wrap gap-1 mt-1">
            {genres.slice(0, 3).map((genre) => (
              <span
                key={genre.id}
                className="bg-primary/15 border border-primary/30 text-[9px] font-black tracking-widest px-1.5 py-0.5 text-primary normal-case"
              >
                {genre.name}
              </span>
            ))}
            {book.tags?.slice(0, 3).map((t) => (
              <span
                key={t.id}
                className="bg-amber-500/15 border border-amber-500/30 text-[9px] font-black tracking-widest px-1.5 py-0.5 text-amber-400 normal-case"
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="hidden sm:flex items-center gap-6 shrink-0 text-white/30">
        {book.format && (
          <span className="text-[10px] font-black tracking-widest">
            {fmtFormat(book.format)}
          </span>
        )}
        {book.page_count != null && book.page_count > 0 && (
          <span className="text-[10px] font-bold tracking-wider">
            {book.page_count} Pages
          </span>
        )}
        {isDnf ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-black tracking-widest text-red-400">
            <AlertTriangle size={10} />
            DNF
          </span>
        ) : book.reading_progress != null && book.reading_progress >= 100 ? (
          <Check
            size={14}
            className="text-primary"
            data-testid="book-row-complete"
          />
        ) : book.reading_progress != null && book.reading_progress > 0 ? (
          <div
            className="flex flex-col items-end gap-0.5 min-w-[80px]"
            data-testid="book-row-progress"
          >
            <span className="text-[10px] font-bold tracking-wider text-white/30">
              {book.page_count != null && book.page_count > 0
                ? `${Math.round((book.reading_progress * book.page_count) / 100)} / ${book.page_count} (${Math.round(book.reading_progress)}%)`
                : `${Math.round(book.reading_progress)}%`}
            </span>
            <div className="w-full h-0.5 bg-white/10 rounded-full">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${Math.min(book.reading_progress, 100)}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </>
  )

  if (isSelecting) {
    return (
      <div
        className={`group flex items-center gap-4 p-4 bg-white/5 border transition-colors cursor-pointer ${
          isSelected
            ? 'border-primary bg-primary/5'
            : 'border-white/10 hover:bg-white/10'
        }`}
        data-testid="book-row"
        onClick={() => onToggle?.(book.id)}
      >
        {rowContent}
      </div>
    )
  }

  return (
    <Link
      to={`/books/${book.id}`}
      className="group flex items-center gap-4 p-4 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
      data-testid="book-row"
    >
      {rowContent}
    </Link>
  )
}
