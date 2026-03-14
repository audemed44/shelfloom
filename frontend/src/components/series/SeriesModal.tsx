import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { api } from '../../api/client'
import type { SeriesWithCount } from '../../types/api'

interface SeriesModalProps {
  series?: SeriesWithCount | null
  allSeries: SeriesWithCount[]
  onClose: () => void
  onSaved: () => void
}

export default function SeriesModal({
  series,
  allSeries,
  onClose,
  onSaved,
}: SeriesModalProps) {
  const [name, setName] = useState(series?.name ?? '')
  const [description, setDescription] = useState(series?.description ?? '')
  const [parentId, setParentId] = useState<string>(
    series?.parent_id?.toString() ?? ''
  )
  const [parentSearch, setParentSearch] = useState(
    series?.parent_id
      ? (allSeries.find((s) => s.id === series.parent_id)?.name ?? '')
      : ''
  )
  const [parentOpen, setParentOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredParents = allSeries
    .filter((s) => s.id !== series?.id)
    .filter((s) => s.name.toLowerCase().includes(parentSearch.toLowerCase()))

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        parent_id: parentId ? parseInt(parentId, 10) : null,
      }
      if (series) {
        await api.patch(`/api/series/${series.id}`, payload)
      } else {
        await api.post('/api/series', payload)
      }
      onSaved()
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to save series.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="series-modal"
    >
      <div className="w-full max-w-md bg-black border border-white/10 rounded-lg shadow-xl flex flex-col max-h-[calc(100vh-2rem)] my-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <h2 className="text-xs font-black tracking-widest uppercase text-white">
            {series ? 'Edit Series' : 'New Series'}
          </h2>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="px-6 py-5 space-y-4 overflow-y-auto"
        >
          {error && <p className="text-xs text-red-400 normal-case">{error}</p>}

          <div className="space-y-1.5">
            <label className="text-[10px] font-black tracking-widest uppercase text-white/40">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Series name"
              data-testid="series-name-input"
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-white/30"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black tracking-widest uppercase text-white/40">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional description"
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-white/30 resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black tracking-widest uppercase text-white/40">
              Parent Series
            </label>
            <div className="relative">
              <input
                type="text"
                value={parentSearch}
                onChange={(e) => {
                  setParentSearch(e.target.value)
                  setParentOpen(true)
                  if (!e.target.value) setParentId('')
                }}
                onFocus={() => setParentOpen(true)}
                onBlur={() => setTimeout(() => setParentOpen(false), 150)}
                placeholder="Search parent series…"
                className="w-full bg-black border border-white/10 px-3 py-2 text-sm text-white normal-case placeholder:text-white/30 focus:outline-none focus:border-primary transition-colors"
              />
              {parentOpen && (
                <div className="absolute z-10 w-full bg-black border border-white/10 mt-0.5 max-h-40 overflow-y-auto">
                  <button
                    type="button"
                    onMouseDown={() => {
                      setParentId('')
                      setParentSearch('')
                      setParentOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-white/40 hover:bg-white/5 hover:text-white transition-colors"
                  >
                    — None —
                  </button>
                  {filteredParents.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={() => {
                        setParentId(s.id.toString())
                        setParentSearch(s.name)
                        setParentOpen(false)
                      }}
                      className={`w-full text-left px-3 py-2 text-sm normal-case transition-colors ${parentId === s.id.toString() ? 'bg-primary/20 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}
                    >
                      {s.name}
                    </button>
                  ))}
                  {filteredParents.length === 0 && (
                    <p className="px-3 py-2 text-sm text-white/30 normal-case">
                      No series found.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              data-testid="series-submit-btn"
              className="px-4 py-2 text-xs font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : series ? 'Save Changes' : 'Create Series'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
