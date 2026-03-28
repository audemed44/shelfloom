import { useEffect, useState } from 'react'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import { api } from '../../api/client'
import type { BookDetail } from '../../types'
import StarRating from '../shared/StarRating'

interface VerdictModalProps {
  book: BookDetail
  onClose: () => void
  onSaved: (book: BookDetail) => void
}

export default function VerdictModal({
  book,
  onClose,
  onSaved,
}: VerdictModalProps) {
  const [rating, setRating] = useState<number | null>(book.rating)
  const [review, setReview] = useState(book.review ?? '')
  const [isDnf, setIsDnf] = useState(book.status === 'dnf')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.patch(`/api/books/${book.id}`, {
        rating,
        review: review.trim() || null,
      })
      if (isDnf && book.status !== 'dnf') {
        await api.post(`/api/books/${book.id}/dnf`, {})
      } else if (!isDnf && book.status === 'dnf') {
        await api.delete(`/api/books/${book.id}/dnf`)
      }
      const refreshed = await api.get<BookDetail>(`/api/books/${book.id}`)
      if (refreshed) onSaved(refreshed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-black border border-white/10 flex max-h-[85vh] flex-col">
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black">
          <div>
            <p className="text-[10px] font-black tracking-widest uppercase text-white/40">
              Your Verdict
            </p>
            <h3 className="text-lg font-black tracking-tight text-white normal-case">
              {book.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-white/40 hover:text-white transition-colors"
            aria-label="Close verdict editor"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
          <section>
            <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-6">
              <p className="text-[10px] font-black tracking-widest uppercase text-white/40">
                01 Rating
              </p>
            </div>
            <div className="flex items-center gap-4">
              <StarRating value={rating} onChange={setRating} size={22} />
              <div className="flex items-center gap-3">
                <span className="text-sm font-black tracking-widest text-white/60">
                  {rating != null ? `${rating.toFixed(1)} / 5` : 'Unrated'}
                </span>
                {rating != null && (
                  <button
                    type="button"
                    onClick={() => setRating(null)}
                    className="inline-flex items-center gap-1 text-[10px] font-black tracking-widest uppercase text-white/40 hover:text-white transition-colors"
                  >
                    <RotateCcw size={12} />
                    Clear
                  </button>
                )}
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-6">
              <p className="text-[10px] font-black tracking-widest uppercase text-white/40">
                02 Reading Outcome
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsDnf((prev) => !prev)}
              className={`flex items-center gap-2 px-4 py-3 border text-[10px] font-black tracking-widest uppercase transition-colors ${
                isDnf
                  ? 'border-red-400/40 bg-red-500/10 text-red-400'
                  : 'border-white/10 text-white/40 hover:text-white hover:border-white/30'
              }`}
            >
              <AlertTriangle size={14} />
              {isDnf ? 'Marked DNF' : 'Mark as DNF'}
            </button>
            <p className="mt-3 text-xs text-white/30 normal-case">
              DNF overrides the usual unread/reading/completed status but keeps
              your reading history intact.
            </p>
          </section>

          <section>
            <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-6">
              <p className="text-[10px] font-black tracking-widest uppercase text-white/40">
                03 Review
              </p>
            </div>
            <textarea
              value={review}
              onChange={(event) => setReview(event.target.value)}
              rows={8}
              placeholder="Capture your opinion, why you dropped it, standout scenes, or anything worth remembering."
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-primary normal-case resize-none"
            />
            {book.review_updated_at && (
              <p className="mt-3 text-[10px] font-black tracking-widest uppercase text-white/30">
                Last updated{' '}
                {new Date(book.review_updated_at).toLocaleDateString()}
              </p>
            )}
          </section>
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-black">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[10px] font-black tracking-widest uppercase border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-6 py-2 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Verdict'}
          </button>
        </div>
      </div>
    </div>
  )
}
