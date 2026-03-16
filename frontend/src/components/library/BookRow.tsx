import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Book } from '../../types'

function fmtFormat(format: string | null | undefined): string {
  if (!format) return ''
  return format.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface BookRowProps {
  book: Book
}

export default function BookRow({ book }: BookRowProps) {
  const coverSrc = `/api/books/${book.id}/cover`

  return (
    <Link
      to={`/books/${book.id}`}
      className="group flex items-center gap-4 p-4 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
      data-testid="book-row"
    >
      {/* Small cover */}
      <div className="w-10 h-14 bg-white/10 border border-white/10 group-hover:border-primary transition-colors shrink-0 overflow-hidden">
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
        {book.genre && (
          <div className="flex flex-wrap gap-1 mt-1">
            {book.genre
              .split(',')
              .map((g) => g.trim())
              .filter(Boolean)
              .slice(0, 3)
              .map((g) => (
                <span
                  key={g}
                  className="bg-primary/15 border border-primary/30 text-[9px] font-black tracking-widest px-1.5 py-0.5 text-primary normal-case"
                >
                  {g}
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
        {book.reading_progress != null && book.reading_progress >= 100 ? (
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
    </Link>
  )
}
