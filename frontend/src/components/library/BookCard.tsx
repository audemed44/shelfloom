import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Book } from '../../types'

interface BookCardProps {
  book: Book
}

export default function BookCard({ book }: BookCardProps) {
  const coverSrc = `/api/books/${book.id}/cover`
  const progress = book.reading_progress
  const isComplete = progress != null && progress >= 100
  const isInProgress = progress != null && progress > 0 && progress < 100

  return (
    <Link
      to={`/books/${book.id}`}
      className="group block"
      data-testid="book-card"
    >
      {/* Cover */}
      <div className="aspect-[2/3] bg-white/5 border border-white/10 group-hover:border-primary transition-colors overflow-hidden relative">
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
            {book.format?.toUpperCase()}
          </span>
        </div>

        {/* Complete checkmark */}
        {isComplete && (
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
    </Link>
  )
}
