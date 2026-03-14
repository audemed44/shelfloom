import { Link } from 'react-router-dom'

export default function BookCard({ book }) {
  const coverSrc = `/api/books/${book.id}/cover`

  return (
    <Link to={`/books/${book.id}`} className="group block" data-testid="book-card">
      {/* Cover */}
      <div className="aspect-[2/3] bg-white/5 border border-white/10 overflow-hidden relative">
        <img
          src={coverSrc}
          alt={book.title}
          className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-300"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
        {/* Format badge */}
        <div className="absolute top-2 right-2">
          <span className="bg-black/70 text-[9px] font-black tracking-widest px-1.5 py-0.5 text-white/50">
            {book.format?.toUpperCase()}
          </span>
        </div>
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
