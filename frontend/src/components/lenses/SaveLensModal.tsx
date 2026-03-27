import { useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../../api/client'
import type { LensFilterState, Lens } from '../../types/api'

interface SaveLensModalProps {
  /** When provided, the modal is in edit mode. */
  existingLens?: Lens
  /** Filter state to save (create mode) or pre-populate (edit mode). */
  filterState: LensFilterState
  onClose: () => void
  onSaved: (lens: Lens) => void
}

function summarize(fs: LensFilterState): string {
  const parts: string[] = []
  if (fs.genres.length > 0) parts.push(`${fs.genres.length} genre(s)`)
  if (fs.tags.length > 0) parts.push(`${fs.tags.length} tag(s)`)
  if (fs.seriesIds.length > 0) parts.push(`${fs.seriesIds.length} series`)
  if (fs.authors.length > 0) parts.push(`${fs.authors.length} author(s)`)
  if (fs.formats.length > 0)
    parts.push(fs.formats.map((f) => f.toUpperCase()).join(', '))
  if (fs.shelfId != null) parts.push('shelf filter')
  if (fs.status != null) parts.push(`status: ${fs.status}`)
  return parts.length > 0 ? parts.join(' · ') : 'All books'
}

export default function SaveLensModal({
  existingLens,
  filterState,
  onClose,
  onSaved,
}: SaveLensModalProps) {
  const isEdit = existingLens != null
  const [name, setName] = useState(existingLens?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      // Convert frontend camelCase to backend snake_case
      const payload = {
        filter_state: {
          genres: filterState.genres,
          tags: filterState.tags,
          series_ids: filterState.seriesIds,
          authors: filterState.authors,
          formats: filterState.formats,
          mode: filterState.mode,
          shelf_id: filterState.shelfId,
          status: filterState.status,
        },
      }
      let lens: Lens | null
      if (isEdit && existingLens) {
        lens = await api.patch<Lens>(`/api/lenses/${existingLens.id}`, {
          name: name.trim(),
          ...payload,
        })
      } else {
        lens = await api.post<Lens>('/api/lenses', {
          name: name.trim(),
          ...payload,
        })
      }
      if (lens) onSaved(lens)
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'An unexpected error occurred.'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div
        className="relative w-full max-w-md bg-black border border-white/10 flex flex-col"
        data-testid="save-lens-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h3 className="text-sm font-black tracking-widest uppercase text-white">
            {isEdit ? 'Edit Lens' : 'Save as Lens'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-white/40 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. LitRPG Time Loops"
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-primary"
              autoFocus
              data-testid="lens-name-input"
            />
          </div>

          <div>
            <p className="text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
              Filters
            </p>
            <p className="text-xs text-white/50 normal-case">
              {summarize(filterState)}
            </p>
          </div>

          {error && <p className="text-xs text-red-400 normal-case">{error}</p>}

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[10px] font-black tracking-widest uppercase border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
              data-testid="save-lens-submit"
            >
              {saving ? 'Saving…' : isEdit ? 'Update' : 'Save Lens'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
