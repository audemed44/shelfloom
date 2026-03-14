import { Link } from 'react-router-dom'

export default function BookRow({ book }) {
  const coverSrc = `/api/books/${book.id}/cover`

  return (
    <Link
      to={`/books/${book.id}`}
      className="group flex items-center gap-4 p-4 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
      data-testid="book-row"
    >
      {/* Small cover */}
      <div className="w-10 h-14 bg-white/10 shrink-0 overflow-hidden">
        <img
          src={coverSrc}
          alt=""
          className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-300"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-black tracking-tighter truncate">{book.title}</p>
        {book.author && (
          <p className="text-xs text-white/40 mt-0.5 normal-case truncate">{book.author}</p>
        )}
      </div>

      {/* Right side */}
      <div className="hidden sm:flex items-center gap-6 shrink-0 text-white/30">
        {book.format && (
          <span className="text-[10px] font-black tracking-widest">
            {book.format.toUpperCase()}
          </span>
        )}
        {book.page_count > 0 && (
          <span className="text-[10px] font-bold tracking-wider">
            {book.page_count} Pages
          </span>
        )}
      </div>
    </Link>
  )
}
