import { useState, useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { api } from '../../api/client'
import type { BookDetail } from '../../types'

interface DeleteBookModalProps {
  book: BookDetail
  onClose: () => void
  onDeleted: () => void
}

export default function DeleteBookModal({
  book,
  onClose,
  onDeleted,
}: DeleteBookModalProps) {
  const [deleteFile, setDeleteFile] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      await api.delete(`/api/books/${book.id}?delete_file=${deleteFile}`)
      onDeleted()
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to delete book.')
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md bg-black border border-white/10 rounded-lg shadow-xl flex flex-col max-h-[calc(100vh-2rem)] my-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <h2 className="text-sm font-black tracking-widest uppercase text-white flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-400" />
            Delete Book
          </h2>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-white/40 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <p className="text-xs text-red-400 border border-red-400/30 bg-red-400/10 rounded px-3 py-2">
              {error}
            </p>
          )}

          <p className="text-sm text-white/70 normal-case">
            Remove{' '}
            <span className="text-white font-semibold">{book.title}</span> from
            your library? This cannot be undone.
          </p>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={deleteFile}
              onChange={(e) => setDeleteFile(e.target.checked)}
              className="w-4 h-4 accent-red-500"
            />
            <span className="text-xs text-white/60 normal-case">
              Also delete the file from disk
            </span>
          </label>

          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-black tracking-widest uppercase border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              data-testid="confirm-delete-btn"
              className="px-4 py-2 text-xs font-black tracking-widest uppercase bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
