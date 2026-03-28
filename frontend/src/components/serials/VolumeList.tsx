import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen,
  Image,
  RefreshCw,
  Zap,
  Plus,
  Trash2,
  Loader2,
} from 'lucide-react'
import { api } from '../../api/client'
import type { SerialVolume, SerialVolumePreview, Shelf } from '../../types/api'

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

function fmtWords(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

function fmtPages(pages: number | null, isPartial: boolean = false): string {
  if (pages === null) return isPartial ? '— partial' : '—'
  return isPartial ? `${pages}*` : String(pages)
}

type DraftVolumeSplit = {
  start: number
  end: number
  name?: string
}

function getValidCustomSplits(
  customSplits: Array<{ start: string; end: string; name: string }>
): DraftVolumeSplit[] {
  return customSplits
    .map((split) => ({
      start: parseInt(split.start, 10),
      end: parseInt(split.end, 10),
      name: split.name.trim() || undefined,
    }))
    .filter(
      (split) =>
        !isNaN(split.start) && !isNaN(split.end) && split.start <= split.end
    )
}

function buildAutoSplits(
  totalChapters: number,
  chaptersPerVolume: number
): DraftVolumeSplit[] {
  if (totalChapters < 1 || chaptersPerVolume < 1) {
    return []
  }

  const splits: DraftVolumeSplit[] = []
  for (let start = 1; start <= totalChapters; start += chaptersPerVolume) {
    splits.push({
      start,
      end: Math.min(totalChapters, start + chaptersPerVolume - 1),
    })
  }
  return splits
}

export default function VolumeList({
  serialId,
  volumes,
  totalChapters,
  shelves,
  onRefresh,
}: VolumeListProps) {
  const [configMode, setConfigMode] = useState<'auto' | 'custom'>('custom')
  const [chaptersPerVolume, setChaptersPerVolume] = useState('100')
  const [customSplits, setCustomSplits] = useState<
    Array<{ start: string; end: string; name: string }>
  >([{ start: '1', end: '', name: '' }])
  const [shelfId, setShelfId] = useState<number | null>(null)
  const [configuring, setConfiguring] = useState(false)
  const [generatingId, setGeneratingId] = useState<number | null>(null)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<SerialVolumePreview[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [uploadingId, setUploadingId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [coverTargetId, setCoverTargetId] = useState<number | null>(null)

  // Add volume inline form
  const [showAddForm, setShowAddForm] = useState(false)
  const [addStart, setAddStart] = useState('')
  const [addEnd, setAddEnd] = useState('')
  const [addName, setAddName] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const splits =
      configMode === 'auto'
        ? buildAutoSplits(totalChapters, parseInt(chaptersPerVolume, 10))
        : getValidCustomSplits(customSplits)

    if (splits.length === 0) {
      setPreview([])
      setPreviewLoading(false)
      setPreviewError(null)
      return
    }

    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(null)

    void api
      .post<SerialVolumePreview[]>(`/api/serials/${serialId}/volumes/preview`, {
        splits,
      })
      .then((data) => {
        if (cancelled) return
        setPreview(data ?? [])
      })
      .catch((err) => {
        if (cancelled) return
        const e = err as { data?: { detail?: string } }
        setPreview([])
        setPreviewError(e.data?.detail ?? 'Failed to load volume preview')
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [chaptersPerVolume, configMode, customSplits, serialId, totalChapters])

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
    const splits = getValidCustomSplits(customSplits)

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

  const handleDelete = async (volumeId: number, deleteBook: boolean) => {
    setDeletingId(volumeId)
    setError(null)
    try {
      await api.delete(
        `/api/serials/${serialId}/volumes/${volumeId}?delete_book=${deleteBook}`
      )
      setConfirmDeleteId(null)
      onRefresh()
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Failed to delete volume')
    } finally {
      setDeletingId(null)
    }
  }

  const handleCoverUpload = async (volumeId: number, file: File) => {
    setUploadingId(volumeId)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await api.upload(
        `/api/serials/${serialId}/volumes/${volumeId}/upload-cover`,
        formData
      )
      onRefresh()
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Failed to upload cover')
    } finally {
      setUploadingId(null)
    }
  }

  const handleAddVolume = async () => {
    const start = parseInt(addStart, 10)
    const end = parseInt(addEnd, 10)
    if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
      setError('Enter a valid chapter range (start <= end)')
      return
    }
    setAdding(true)
    setError(null)
    try {
      await api.post(`/api/serials/${serialId}/volumes/add`, {
        start,
        end,
        name: addName.trim() || null,
      })
      setShowAddForm(false)
      setAddStart('')
      setAddEnd('')
      setAddName('')
      onRefresh()
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Failed to add volume')
    } finally {
      setAdding(false)
    }
  }

  // Pre-fill add form start from last volume's end + 1
  const openAddForm = () => {
    if (volumes.length > 0) {
      const lastEnd = Math.max(...volumes.map((v) => v.chapter_end))
      setAddStart(String(lastEnd + 1))
    } else {
      setAddStart('1')
    }
    setAddEnd('')
    setAddName('')
    setShowAddForm(true)
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

      {(previewLoading || preview.length > 0 || previewError) && (
        <div className="border border-white/10 bg-white/[0.03]">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <p className="text-[10px] font-black tracking-widest uppercase text-white/40">
              Preview
            </p>
            <p className="text-[10px] tracking-widest uppercase text-white/25">
              280 words/page
            </p>
          </div>

          {previewError ? (
            <p className="px-4 py-3 text-xs text-red-400 normal-case">
              {previewError}
            </p>
          ) : preview.length === 0 && previewLoading ? (
            <p className="px-4 py-3 text-xs text-white/40 normal-case">
              Calculating preview...
            </p>
          ) : (
            <div className="divide-y divide-white/5">
              {preview.map((item, index) => (
                <div
                  key={`${item.start}-${item.end}-${index}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black tracking-tighter normal-case text-white/90">
                      {item.name ??
                        `Volume ${String(index + 1).padStart(2, '0')}`}
                    </p>
                    <p className="mt-0.5 text-[10px] tracking-widest uppercase text-white/35">
                      Ch {item.start}–{item.end}
                    </p>
                  </div>
                  <div className="text-right text-[10px] tracking-widest uppercase text-white/35">
                    <p>
                      ~{fmtPages(item.estimated_pages, item.is_partial)} pages
                    </p>
                    <p>{fmtWords(item.total_words)} words</p>
                    <p>
                      {item.fetched_chapter_count}/{item.chapter_count} fetched
                    </p>
                    {item.stubbed_missing_count > 0 && (
                      <p className="text-amber-300/90">
                        {item.stubbed_missing_count} stubbed missing
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="border-t border-white/10 px-4 py-3 text-[10px] text-white/30 normal-case">
            Preview totals use fetched chapter word counts only. Entries marked
            with `*` are partial because some chapters in the range still need
            content. Stubbed missing counts show chapters removed upstream
            before they were cached locally.
          </p>
        </div>
      )}

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
              {shelves
                .filter((s) => s.path !== '__manual__')
                .map((s) => (
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

      {/* Hidden file input for cover upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file && coverTargetId !== null) {
            handleCoverUpload(coverTargetId, file)
          }
          e.target.value = ''
        }}
      />

      {/* Volume cards */}
      {volumes.length === 0 ? (
        <p className="text-xs text-white/30 normal-case py-4">
          No volumes configured. Use the panel above to set up chapter splits.
        </p>
      ) : (
        <div className="space-y-2">
          {volumes.map((vol) => {
            const isGenerating = generatingId === vol.id
            const isDeleting = deletingId === vol.id
            const isUploading = uploadingId === vol.id
            const volName = vol.name ?? `Volume ${vol.volume_number}`
            return (
              <div
                key={vol.id}
                className="border border-white/10 p-4 hover:border-white/20 transition-colors"
              >
                <div className="flex flex-wrap items-center gap-4">
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
                      {vol.estimated_pages != null &&
                        vol.total_words != null && (
                          <span className="text-white/25 ml-2">
                            ~{vol.estimated_pages} pages ·{' '}
                            {fmtWords(vol.total_words)} words
                          </span>
                        )}
                    </p>
                    <p className="text-[10px] text-white/30 tracking-widest uppercase mt-1">
                      {vol.fetched_chapter_count}/{vol.chapter_count} fetched
                      {vol.stubbed_missing_count > 0 && (
                        <span className="text-amber-300/90 ml-2">
                          {vol.stubbed_missing_count} stubbed missing
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-3">
                    {vol.is_stale && (
                      <span className="text-[9px] font-black tracking-widest px-1.5 py-0.5 bg-amber-500/20 text-amber-400">
                        STALE
                      </span>
                    )}
                    {vol.is_partial && (
                      <span className="text-[9px] font-black tracking-widest px-1.5 py-0.5 bg-white/10 text-white/70">
                        PARTIAL
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

                  {/* Actions */}
                  <div className="flex gap-2 shrink-0">
                    {/* Cover upload */}
                    <button
                      onClick={() => {
                        setCoverTargetId(vol.id)
                        fileInputRef.current?.click()
                      }}
                      disabled={isUploading}
                      className="p-1.5 text-white/30 hover:text-white/60 disabled:opacity-40 transition-colors"
                      title="Upload cover"
                    >
                      {isUploading ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Image size={13} />
                      )}
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() =>
                        setConfirmDeleteId(
                          confirmDeleteId === vol.id ? null : vol.id
                        )
                      }
                      disabled={isDeleting}
                      className="p-1.5 text-white/30 hover:text-red-400 disabled:opacity-40 transition-colors"
                      title="Delete volume"
                    >
                      {isDeleting ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                    </button>

                    {/* Generate / Rebuild */}
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

                {/* Inline delete confirm */}
                {confirmDeleteId === vol.id && (
                  <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] text-white/40 tracking-widest uppercase font-black">
                      Confirm:
                    </span>
                    <button
                      onClick={() => handleDelete(vol.id, false)}
                      disabled={isDeleting}
                      className="px-3 py-1 text-[10px] font-black tracking-widest uppercase border border-red-500/20 text-red-400 hover:bg-red-400/10 disabled:opacity-40 transition-colors"
                    >
                      Delete volume
                    </button>
                    {vol.book_id && (
                      <button
                        onClick={() => handleDelete(vol.id, true)}
                        disabled={isDeleting}
                        className="px-3 py-1 text-[10px] font-black tracking-widest uppercase border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-400/20 disabled:opacity-40 transition-colors"
                      >
                        Delete volume + book
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-3 py-1 text-[10px] font-black tracking-widest uppercase text-white/30 hover:text-white/60 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add Volume inline form */}
      {showAddForm ? (
        <div className="border border-white/10 p-4 space-y-3">
          <p className="text-[10px] font-black tracking-widest uppercase text-white/40">
            Add Volume
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
                Start
              </label>
              <input
                type="number"
                min={1}
                value={addStart}
                onChange={(e) => setAddStart(e.target.value)}
                className="w-20 bg-black border border-white/10 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
                End
              </label>
              <input
                type="number"
                min={1}
                value={addEnd}
                onChange={(e) => setAddEnd(e.target.value)}
                className="w-20 bg-black border border-white/10 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1.5 flex-1 min-w-32">
              <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
                Name
              </label>
              <input
                type="text"
                placeholder="Optional"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                className="w-full bg-black border border-white/10 px-2 py-1.5 text-sm text-white normal-case focus:outline-none focus:border-primary"
              />
            </div>
            <button
              onClick={handleAddVolume}
              disabled={adding}
              className="flex items-center gap-2 px-4 py-1.5 text-xs font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              {adding ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Plus size={12} />
              )}
              Add
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="text-[10px] font-black tracking-widest uppercase text-white/30 hover:text-white/60 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={openAddForm}
          className="flex items-center gap-1.5 text-[10px] font-black tracking-widest uppercase text-primary hover:underline"
        >
          <Plus size={11} />
          Add Volume
        </button>
      )}
    </div>
  )
}
