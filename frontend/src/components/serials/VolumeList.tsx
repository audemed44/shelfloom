import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, RefreshCw, Zap, Plus, Trash2, Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import type { SerialVolume, Shelf } from '../../types/api'

interface VolumeListProps {
  serialId: number
  volumes: SerialVolume[]
  totalChapters: number
  shelves: Shelf[]
  onRefresh: () => void
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function VolumeList({
  serialId,
  volumes,
  totalChapters,
  shelves,
  onRefresh,
}: VolumeListProps) {
  const [configMode, setConfigMode] = useState<'auto' | 'custom'>('auto')
  const [chaptersPerVolume, setChaptersPerVolume] = useState('100')
  const [customSplits, setCustomSplits] = useState<
    Array<{ start: string; end: string; name: string }>
  >([{ start: '1', end: '', name: '' }])
  const [shelfId, setShelfId] = useState<number | null>(null)
  const [configuring, setConfiguring] = useState(false)
  const [generatingId, setGeneratingId] = useState<number | null>(null)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAutoSplit = async () => {
    const n = parseInt(chaptersPerVolume, 10)
    if (!n || n < 1) {
      setError('Enter a valid number of chapters per volume')
      return
    }
    setConfiguring(true)
    setError(null)
    try {
      await api.post(`/api/serials/${serialId}/volumes/auto`, {
        chapters_per_volume: n,
      })
      onRefresh()
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Failed to configure volumes')
    } finally {
      setConfiguring(false)
    }
  }

  const handleCustomSplit = async () => {
    const splits = customSplits
      .map((s) => ({
        start: parseInt(s.start, 10),
        end: parseInt(s.end, 10),
        name: s.name.trim() || undefined,
      }))
      .filter((s) => !isNaN(s.start) && !isNaN(s.end) && s.start <= s.end)

    if (splits.length === 0) {
      setError('Enter at least one valid chapter range')
      return
    }
    setConfiguring(true)
    setError(null)
    try {
      await api.post(`/api/serials/${serialId}/volumes`, { splits })
      onRefresh()
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Failed to configure volumes')
    } finally {
      setConfiguring(false)
    }
  }

  const shelfQuery = shelfId ? `?shelf_id=${shelfId}` : ''

  const handleGenerate = async (volumeId: number) => {
    setGeneratingId(volumeId)
    setError(null)
    try {
      await api.post(
        `/api/serials/${serialId}/volumes/${volumeId}/generate${shelfQuery}`
      )
      onRefresh()
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Failed to generate volume')
    } finally {
      setGeneratingId(null)
    }
  }

  const handleRebuild = async (volumeId: number) => {
    setGeneratingId(volumeId)
    setError(null)
    try {
      await api.post(`/api/serials/${serialId}/volumes/${volumeId}/rebuild`)
      onRefresh()
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Failed to rebuild volume')
    } finally {
      setGeneratingId(null)
    }
  }

  const handleGenerateAll = async () => {
    setGeneratingAll(true)
    setError(null)
    try {
      await api.post(
        `/api/serials/${serialId}/volumes/generate-all${shelfQuery}`
      )
      onRefresh()
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Failed to generate volumes')
    } finally {
      setGeneratingAll(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
          {error}
        </p>
      )}

      {/* Config panel */}
      <div className="border border-white/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black tracking-widest uppercase text-white/40">
            Configure Splits
          </p>
          <div className="flex gap-1">
            {(['auto', 'custom'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setConfigMode(mode)}
                className={`px-3 py-1 text-[10px] font-black tracking-widest uppercase transition-colors ${
                  configMode === mode
                    ? 'bg-primary text-white'
                    : 'border border-white/10 text-white/40 hover:text-white hover:border-white/30'
                }`}
              >
                {mode === 'auto' ? 'Auto' : 'Custom'}
              </button>
            ))}
          </div>
        </div>

        {configMode === 'auto' ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
                Chapters per Volume
              </label>
              <input
                type="number"
                min={1}
                max={totalChapters || 9999}
                value={chaptersPerVolume}
                onChange={(e) => setChaptersPerVolume(e.target.value)}
                className="w-32 bg-black border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
              />
            </div>
            <button
              onClick={handleAutoSplit}
              disabled={configuring}
              className="flex items-center gap-2 px-4 py-2 text-xs font-black tracking-widest uppercase bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 transition-colors"
            >
              {configuring ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Zap size={12} />
              )}
              Auto Split
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {customSplits.map((split, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-black tracking-widest uppercase text-white/30 w-6 shrink-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <input
                  type="number"
                  min={1}
                  placeholder="Start"
                  value={split.start}
                  onChange={(e) => {
                    const updated = [...customSplits]
                    updated[i] = { ...updated[i], start: e.target.value }
                    setCustomSplits(updated)
                  }}
                  className="w-20 bg-black border border-white/10 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-primary"
                />
                <span className="text-white/30 text-xs">–</span>
                <input
                  type="number"
                  min={1}
                  placeholder="End"
                  value={split.end}
                  onChange={(e) => {
                    const updated = [...customSplits]
                    updated[i] = { ...updated[i], end: e.target.value }
                    setCustomSplits(updated)
                  }}
                  className="w-20 bg-black border border-white/10 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-primary"
                />
                <input
                  type="text"
                  placeholder="Name (optional)"
                  value={split.name}
                  onChange={(e) => {
                    const updated = [...customSplits]
                    updated[i] = { ...updated[i], name: e.target.value }
                    setCustomSplits(updated)
                  }}
                  className="flex-1 min-w-32 bg-black border border-white/10 px-2 py-1.5 text-sm text-white normal-case focus:outline-none focus:border-primary"
                />
                {customSplits.length > 1 && (
                  <button
                    onClick={() =>
                      setCustomSplits(customSplits.filter((_, j) => j !== i))
                    }
                    className="text-white/30 hover:text-red-400 transition-colors"
                    aria-label="Remove range"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() =>
                  setCustomSplits([
                    ...customSplits,
                    { start: '', end: '', name: '' },
                  ])
                }
                className="flex items-center gap-1.5 text-[10px] font-black tracking-widest uppercase text-primary hover:underline"
              >
                <Plus size={11} />
                Add Range
              </button>
              <button
                onClick={handleCustomSplit}
                disabled={configuring}
                className="flex items-center gap-2 px-4 py-2 text-xs font-black tracking-widest uppercase bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 transition-colors"
              >
                {configuring ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Zap size={12} />
                )}
                Apply
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Generate All row */}
      {volumes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {shelves.length > 0 && (
            <select
              value={shelfId ?? ''}
              onChange={(e) =>
                setShelfId(e.target.value ? Number(e.target.value) : null)
              }
              className="bg-black border border-white/10 px-3 py-2 text-sm text-white normal-case focus:outline-none focus:border-primary"
            >
              <option value="">Default shelf</option>
              {shelves.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleGenerateAll}
            disabled={generatingAll}
            className="flex items-center gap-2 px-4 py-2 text-xs font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
          >
            {generatingAll ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Zap size={12} />
            )}
            Generate All
          </button>
        </div>
      )}

      {/* Volume cards */}
      {volumes.length === 0 ? (
        <p className="text-xs text-white/30 normal-case py-4">
          No volumes configured. Use the panel above to set up chapter splits.
        </p>
      ) : (
        <div className="space-y-2">
          {volumes.map((vol) => {
            const isGenerating = generatingId === vol.id
            const volName = vol.name ?? `Volume ${vol.volume_number}`
            return (
              <div
                key={vol.id}
                className="border border-white/10 p-4 flex flex-wrap items-center gap-4 hover:border-white/20 transition-colors"
              >
                {/* Volume number badge */}
                <div className="size-10 flex items-center justify-center bg-primary/10 text-primary text-xs font-black shrink-0">
                  {String(vol.volume_number).padStart(2, '0')}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black tracking-tighter normal-case">
                    {volName}
                  </p>
                  <p className="text-[10px] text-white/40 tracking-widest uppercase mt-0.5">
                    Ch {vol.chapter_start}–{vol.chapter_end}
                  </p>
                </div>

                {/* Status */}
                <div className="flex items-center gap-3">
                  {vol.is_stale && (
                    <span className="text-[9px] font-black tracking-widest px-1.5 py-0.5 bg-amber-500/20 text-amber-400">
                      STALE
                    </span>
                  )}
                  {vol.generated_at && (
                    <span className="text-[10px] text-white/30 hidden sm:block">
                      {fmtDate(vol.generated_at)}
                    </span>
                  )}
                  {vol.book_id && (
                    <Link
                      to={`/books/${vol.book_id}`}
                      className="flex items-center gap-1.5 text-[10px] font-black tracking-widest uppercase text-primary hover:underline"
                    >
                      <BookOpen size={11} />
                      View
                    </Link>
                  )}
                </div>

                {/* Action */}
                <div className="flex gap-2 shrink-0">
                  {vol.book_id ? (
                    <button
                      onClick={() => handleRebuild(vol.id)}
                      disabled={isGenerating}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase border border-white/10 text-white/50 hover:text-white hover:border-white/30 disabled:opacity-40 transition-colors"
                    >
                      {isGenerating ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <RefreshCw size={11} />
                      )}
                      Rebuild
                    </button>
                  ) : (
                    <button
                      onClick={() => handleGenerate(vol.id)}
                      disabled={isGenerating}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-40 transition-colors"
                    >
                      {isGenerating ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Zap size={11} />
                      )}
                      Generate
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
