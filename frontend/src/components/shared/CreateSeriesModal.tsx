import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { api } from '../../api/client'
import type { SeriesWithCount } from '../../types/api'

interface CreateSeriesModalProps {
  allSeries: SeriesWithCount[]
  onClose: () => void
  onCreated: (newSeries: SeriesWithCount) => void
}

export default function CreateSeriesModal({
  allSeries,
  onClose,
  onCreated,
}: CreateSeriesModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [parentId, setParentId] = useState('')
  const [parentSearch, setParentSearch] = useState('')
  const [parentOpen, setParentOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredParents = allSeries.filter((s) =>
    s.name.toLowerCase().includes(parentSearch.toLowerCase())
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await api.post<SeriesWithCount>('/api/series', {
        name: name.trim(),
        description: description.trim() || null,
        parent_id: parentId ? parseInt(parentId, 10) : null,
      })
      if (created) onCreated(created)
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to create series.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md bg-black border border-white/10 shadow-2xl flex flex-col max-h-[calc(100vh-2rem)] my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="size-7 flex items-center justify-center bg-primary text-white rounded">
              <Plus size={14} />
            </div>
            <h3 className="text-sm font-black tracking-widest uppercase text-white">
              Create New Series
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          <div>
            <p className="text-white/70 text-sm normal-case leading-relaxed">
              Organize books into nested hierarchies — group sub-series under a
              parent saga.
            </p>
          </div>

          {error && (
            <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
              {error}
            </p>
          )}

          <div className="space-y-1.5">
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
              Series Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., The Stormlight Archive"
              className="w-full bg-white/5 border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 flex items-center gap-2">
              Parent Series
              <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full normal-case font-bold">
                Hierarchical
              </span>
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
                className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/30 focus:outline-none focus:border-primary transition-colors"
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
                    className="w-full text-left px-4 py-2.5 text-sm text-white/40 hover:bg-white/5 hover:text-white transition-colors"
                  >
                    — None (Top Level) —
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
                      className={`w-full text-left px-4 py-2.5 text-sm normal-case transition-colors ${parentId === s.id.toString() ? 'bg-primary/20 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}
                    >
                      {s.name}
                    </button>
                  ))}
                  {filteredParents.length === 0 && (
                    <p className="px-4 py-2.5 text-sm text-white/30 normal-case">
                      No series found.
                    </p>
                  )}
                </div>
              )}
            </div>
            <p className="text-[10px] text-white/30 normal-case">
              Leave empty to create a primary series.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Briefly describe the series or world-building context…"
              className="w-full bg-white/5 border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors resize-none"
            />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-1 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-black tracking-widest uppercase text-white/50 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 text-xs font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              <Plus size={13} />
              {saving ? 'Creating…' : 'Create Series'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
