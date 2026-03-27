import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Lens } from '../../types/api'

interface LensCardProps {
  lens: Lens
  onEdit: (lens: Lens) => void
  onDelete: (lens: Lens) => void
}

export default function LensCard({ lens, onEdit, onDelete }: LensCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const coverUrl = lens.cover_book_id
    ? `/api/books/${lens.cover_book_id}/cover`
    : null

  return (
    <div className="group relative" data-testid="lens-card">
      {/* Cover */}
      <Link to={`/lenses/${lens.id}`} className="block">
        <div className="aspect-[2/3] bg-slate-900/60 border border-white/10 overflow-hidden mb-3">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={lens.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
              <span className="text-3xl font-black text-primary/40 tracking-tighter select-none">
                {lens.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-1 pr-6">
          <p className="text-xs font-black tracking-widest text-white truncate">
            {lens.name}
          </p>
          <p className="text-[10px] font-bold tracking-wider text-white/30">
            {lens.book_count} {lens.book_count === 1 ? 'book' : 'books'}
          </p>
        </div>
      </Link>

      {/* Menu button */}
      <div ref={menuRef} className="absolute top-2 right-0">
        <button
          onClick={(e) => {
            e.preventDefault()
            setMenuOpen((o) => !o)
          }}
          className="p-1 text-white/0 group-hover:text-white/40 hover:!text-white transition-colors"
          aria-label="Lens options"
          data-testid="lens-card-menu"
        >
          <MoreHorizontal size={16} />
        </button>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 top-7 z-20 w-36 bg-black border border-white/10 py-1">
              <button
                onClick={() => {
                  setMenuOpen(false)
                  onEdit(lens)
                }}
                className="flex items-center gap-3 w-full px-3 py-2 text-[10px] font-black tracking-widest uppercase text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                data-testid="lens-card-edit"
              >
                <Pencil size={12} />
                Edit
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  onDelete(lens)
                }}
                className="flex items-center gap-3 w-full px-3 py-2 text-[10px] font-black tracking-widest uppercase text-red-400 hover:bg-white/5 transition-colors"
                data-testid="lens-card-delete"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
