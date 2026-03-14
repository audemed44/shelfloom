import { useState, useEffect, useMemo } from 'react'
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

  // ── parent field ────────────────────────────────────────────────────────────
  const [parentId, setParentId] = useState<string>(
    series?.parent_id?.toString() ?? ''
  )
  const [parentSearch, setParentSearch] = useState(
    series?.parent_id
      ? (allSeries.find((s) => s.id === series.parent_id)?.name ?? '')
      : ''
  )
  const [parentOpen, setParentOpen] = useState(false)

  // ── children field ──────────────────────────────────────────────────────────
  const originalChildIds = useMemo(
    () =>
      series
        ? allSeries.filter((s) => s.parent_id === series.id).map((s) => s.id)
        : [],
    // intentionally stable — snapshot at mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const [childIds, setChildIds] = useState<number[]>(originalChildIds)
  const [childSearch, setChildSearch] = useState('')
  const [childOpen, setChildOpen] = useState(false)

  const childPills = useMemo(
    () => allSeries.filter((s) => childIds.includes(s.id)),
    [allSeries, childIds]
  )

  const filteredChildCandidates = useMemo(() => {
    const q = childSearch.toLowerCase()
    return allSeries.filter(
      (s) =>
        s.id !== series?.id &&
        s.id.toString() !== parentId &&
        !childIds.includes(s.id) &&
        s.name.toLowerCase().includes(q)
    )
  }, [allSeries, childIds, childSearch, parentId, series?.id])

  const filteredParents = useMemo(
    () =>
      allSeries
        .filter((s) => s.id !== series?.id)
        .filter((s) => !childIds.includes(s.id)) // can't be both child and parent
        .filter((s) =>
          s.name.toLowerCase().includes(parentSearch.toLowerCase())
        ),
    [allSeries, childIds, parentSearch, series?.id]
  )

  // ── misc state ──────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const addChild = (s: SeriesWithCount) => {
    setChildIds((prev) => [...prev, s.id])
    setChildSearch('')
    setChildOpen(false)
  }

  const removeChild = (id: number) => {
    setChildIds((prev) => prev.filter((c) => c !== id))
  }

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

      let savedId: number
      if (series) {
        await api.patch(`/api/series/${series.id}`, payload)
        savedId = series.id
      } else {
        const created = await api.post<{ id: number }>('/api/series', payload)
        savedId = created.id
      }

      // Assign newly added children
      const added = childIds.filter((id) => !originalChildIds.includes(id))
      const removed = originalChildIds.filter((id) => !childIds.includes(id))
      await Promise.all([
        ...added.map((id) =>
          api.patch(`/api/series/${id}`, { parent_id: savedId })
        ),
        ...removed.map((id) =>
          api.patch(`/api/series/${id}`, { parent_id: null })
        ),
      ])

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
      <div className="w-full max-w-md bg-black border border-white/10 shadow-xl flex flex-col max-h-[calc(100vh-2rem)] my-auto">
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
          className="px-6 py-5 space-y-5 overflow-y-auto"
        >
          {error && <p className="text-xs text-red-400 normal-case">{error}</p>}

          {/* Name */}
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
              className="w-full bg-black border border-white/10 px-3 py-2 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black tracking-widest uppercase text-white/40">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional description"
              className="w-full bg-black border border-white/10 px-3 py-2 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors resize-none"
            />
          </div>

          {/* Parent series */}
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
                      className={`w-full text-left px-3 py-2 text-sm normal-case transition-colors ${
                        parentId === s.id.toString()
                          ? 'bg-primary/20 text-white'
                          : 'text-white/70 hover:bg-white/5 hover:text-white'
                      }`}
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

          {/* Children */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black tracking-widest uppercase text-white/40">
              Child Series
            </label>

            {/* Pills */}
            {childPills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {childPills.map((s) => (
                  <span
                    key={s.id}
                    className="flex items-center gap-1 px-2 py-1 bg-white/5 border border-white/10 text-xs text-white/80 normal-case"
                  >
                    {s.name}
                    <button
                      type="button"
                      onClick={() => removeChild(s.id)}
                      className="text-white/30 hover:text-red-400 transition-colors ml-0.5"
                      aria-label={`Remove ${s.name}`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search to add */}
            <div className="relative">
              <input
                type="text"
                value={childSearch}
                onChange={(e) => {
                  setChildSearch(e.target.value)
                  setChildOpen(true)
                }}
                onFocus={() => setChildOpen(true)}
                onBlur={() => setTimeout(() => setChildOpen(false), 150)}
                placeholder="Search to add child series…"
                className="w-full bg-black border border-white/10 px-3 py-2 text-sm text-white normal-case placeholder:text-white/30 focus:outline-none focus:border-primary transition-colors"
              />
              {childOpen && filteredChildCandidates.length > 0 && (
                <div className="absolute z-10 w-full bg-black border border-white/10 mt-0.5 max-h-40 overflow-y-auto">
                  {filteredChildCandidates.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={() => addChild(s)}
                      className="w-full text-left px-3 py-2 text-sm normal-case transition-colors hover:bg-white/5"
                    >
                      <span className="text-white/80">{s.name}</span>
                      {s.parent_id != null && s.parent_id !== series?.id && (
                        <span className="ml-2 text-[10px] text-white/30 normal-case">
                          currently under{' '}
                          {allSeries.find((p) => p.id === s.parent_id)?.name ??
                            'another series'}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
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
