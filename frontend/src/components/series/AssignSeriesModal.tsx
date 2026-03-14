import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { api } from '../../api/client'
import type { SeriesWithCount } from '../../types/api'

interface BookSeries {
  series_id: number
  series_name: string
  sequence: number | null
}

interface AssignSeriesModalProps {
  bookId: number
  currentSeries: BookSeries[]
  onClose: () => void
  onSaved: () => void
}

export default function AssignSeriesModal({
  bookId,
  currentSeries,
  onClose,
  onSaved,
}: AssignSeriesModalProps) {
  const [allSeries, setAllSeries] = useState<SeriesWithCount[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [sequence, setSequence] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<SeriesWithCount[]>('/api/series/tree').then((data) => {
      if (data) setAllSeries(data)
    })
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = allSeries.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleRemove = async (seriesId: number) => {
    setSaving(true)
    setError(null)
    try {
      await api.delete(`/api/series/${seriesId}/books/${bookId}`)
      onSaved()
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to remove from series.')
    } finally {
      setSaving(false)
    }
  }

  const handleAssign = async () => {
    if (!selectedId) return
    setSaving(true)
    setError(null)
    try {
      const seq = sequence.trim() ? `?sequence=${encodeURIComponent(sequence.trim())}` : ''
      await api.post(`/api/series/${selectedId}/books/${bookId}${seq}`, {})
      onSaved()
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to assign to series.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      data-testid="assign-series-modal"
    >
      <div className="w-full max-w-md bg-black border border-white/10 rounded-lg shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-xs font-black tracking-widest uppercase text-white">Assign to Series</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && <p className="text-xs text-red-400 normal-case">{error}</p>}

          {/* Current memberships */}
          {currentSeries.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black tracking-widest uppercase text-white/40">Current Series</p>
              {currentSeries.map((s) => (
                <div key={s.series_id} className="flex items-center justify-between py-1.5 border-b border-white/5">
                  <span className="text-sm text-white/80 normal-case">
                    {s.series_name}
                    {s.sequence != null && <span className="text-white/40 ml-1">#{s.sequence}</span>}
                  </span>
                  <button
                    onClick={() => handleRemove(s.series_id)}
                    disabled={saving}
                    className="text-[10px] font-black tracking-widest uppercase text-red-400/70 hover:text-red-400 disabled:opacity-40 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Search and select */}
          <div className="space-y-2">
            <p className="text-[10px] font-black tracking-widest uppercase text-white/40">Add to Series</p>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search series…"
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-white/30"
            />
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
                  className={`w-full text-left px-3 py-2 text-sm normal-case rounded transition-colors ${
                    selectedId === s.id
                      ? 'bg-primary/20 text-white border border-primary/40'
                      : 'text-white/70 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {s.name}
                  <span className="ml-2 text-[10px] text-white/30">{s.book_count} books</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="text-xs text-white/30 normal-case py-2 px-3">No series found.</p>
              )}
            </div>
          </div>

          {selectedId && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-black tracking-widest uppercase text-white/40">
                Sequence Number (optional)
              </label>
              <input
                type="number"
                step="0.1"
                value={sequence}
                onChange={(e) => setSequence(e.target.value)}
                placeholder="e.g. 1 or 2.5"
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-white/30"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAssign}
              disabled={!selectedId || saving}
              className="px-4 py-2 text-xs font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Assign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
