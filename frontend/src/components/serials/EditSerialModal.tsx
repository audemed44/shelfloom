import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { api } from '../../api/client'
import type { WebSerial } from '../../types/api'

interface EditSerialModalProps {
  serial: WebSerial
  onClose: () => void
  onSaved: () => void
}

const STATUS_OPTIONS = ['ongoing', 'completed', 'paused', 'error'] as const

export default function EditSerialModal({
  serial,
  onClose,
  onSaved,
}: EditSerialModalProps) {
  const [title, setTitle] = useState(serial.title ?? '')
  const [author, setAuthor] = useState(serial.author ?? '')
  const [serialStatus, setSerialStatus] = useState(serial.status)
  const [description, setDescription] = useState(serial.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/api/serials/${serial.id}`, {
        title: title.trim() || null,
        author: author.trim() || null,
        status: serialStatus,
        description: description.trim() || null,
      })
      onSaved()
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
      data-testid="edit-serial-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-2xl bg-black border border-white/10 shadow-2xl my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 sticky top-0 bg-black z-10">
          <div>
            <h2 className="text-sm font-black tracking-widest uppercase text-white">
              Edit Serial
            </h2>
            <p className="text-xs text-primary/80 normal-case mt-0.5">
              {serial.title ?? 'Untitled'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-white/40 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="px-6 py-6 space-y-6 max-h-[80vh] overflow-y-auto"
        >
          {/* 01 Details */}
          <div className="flex items-center gap-4 pb-2 border-b border-white/10 mb-6">
            <span className="text-xs font-black tracking-[0.2em] text-white/20">
              01
            </span>
            <h3 className="text-base font-bold uppercase tracking-tight text-white">
              Details
            </h3>
          </div>

          {error && (
            <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
              {error}
            </p>
          )}

          <div>
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1.5">
              Author
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1.5">
              Status
            </label>
            <select
              value={serialStatus}
              onChange={(e) => setSerialStatus(e.target.value)}
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case focus:outline-none focus:border-primary transition-colors"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1.5">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors resize-none"
            />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-xs font-black tracking-widest uppercase border border-white/20 text-white/50 hover:text-white hover:border-white/40 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 text-xs font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
