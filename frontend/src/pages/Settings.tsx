import { useState, useEffect, useRef, useCallback } from 'react'
import {
  HardDrive,
  FolderCog,
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import ShelfModal from '../components/settings/ShelfModal'
import type {
  Shelf,
  OrganizerResult,
  ScanStatus,
  BackfillCoversResponse,
} from '../types/api'

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({
  num,
  title,
  description,
}: {
  num: string
  title: string
  description?: string
}) {
  return (
    <div className="flex items-start gap-4 pb-3 border-b border-white/10 mb-6">
      <span className="text-xs font-black tracking-[0.2em] text-white/20 mt-0.5">
        {num}
      </span>
      <div>
        <h2 className="text-base font-bold uppercase tracking-tight text-white">
          {title}
        </h2>
        {description && (
          <p className="text-xs text-white/40 normal-case mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Template token helpers ─────────────────────────────────────────────────────

const TOKENS = [
  { label: '{author}', example: 'Brandon Sanderson' },
  { label: '{title}', example: 'The Way of Kings' },
  { label: '{series_path}', example: 'Cosmere/Stormlight Archive' },
  { label: '{sequence}', example: '01' },
  { label: '{sequence| - }', example: '01 - ' },
]

const DEFAULT_TEMPLATE = '{author}/{series_path}/{sequence| - }{title}'

function computeExamplePath(template: string): string {
  const examples: Record<string, string> = {
    author: 'Brandon Sanderson',
    title: 'The Way of Kings',
    series_path: 'Cosmere/Stormlight Archive',
    sequence: '01',
  }
  let result = template
  // Handle conditional {sequence|suffix} first
  result = result.replace(
    /\{sequence\|([^}]*)\}/g,
    (_, suffix) => `01${suffix}`
  )
  // Then regular tokens
  result = result.replace(
    /\{(\w+)(?::[^}]*)?\}/g,
    (_, token) => examples[token] ?? `{${token}}`
  )
  return result + '.epub'
}

// ── Shelf card ─────────────────────────────────────────────────────────────────

interface ShelfCardProps {
  shelf: Shelf
  onEdit: () => void
  onDelete: () => void
}

function ShelfCard({ shelf, onEdit, onDelete }: ShelfCardProps) {
  return (
    <div
      className="flex items-center gap-4 p-4 border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
      data-testid={`shelf-card-${shelf.id}`}
    >
      <div className="size-9 flex items-center justify-center border border-white/10 shrink-0">
        <HardDrive size={16} className="text-white/40" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-medium text-white truncate">
            {shelf.name}
          </p>
          {shelf.is_default && (
            <span className="shrink-0 text-[9px] font-black tracking-widest uppercase text-primary bg-primary/10 px-1.5 py-0.5">
              Default
            </span>
          )}
          {shelf.is_sync_target && (
            <span className="shrink-0 text-[9px] font-black tracking-widest uppercase text-white/50 bg-white/5 px-1.5 py-0.5">
              Sync
            </span>
          )}
        </div>
        <p className="text-[11px] text-white/30 font-mono normal-case truncate">
          {shelf.path}
        </p>
        {shelf.device_name && (
          <p className="text-[10px] text-white/20 normal-case mt-0.5">
            {shelf.device_name}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[10px] font-black tracking-widest uppercase text-white/30 mr-2">
          {shelf.book_count} books
        </span>
        <button
          onClick={onEdit}
          aria-label={`Edit ${shelf.name}`}
          className="p-2 text-white/40 hover:text-white transition-colors"
        >
          <Edit2 size={14} />
        </button>
        <button
          onClick={onDelete}
          aria-label={`Delete ${shelf.name}`}
          className="p-2 text-white/40 hover:text-red-400 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Organize result table ──────────────────────────────────────────────────────

function OrganizerResultTable({ results }: { results: OrganizerResult[] }) {
  const moves = results.filter((r) => !r.already_correct && !r.error)
  const errors = results.filter((r) => r.error)
  const unchanged = results.filter((r) => r.already_correct)

  return (
    <div className="space-y-3" data-testid="organizer-results">
      {/* Summary badges */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-black tracking-widest uppercase text-white/60 bg-white/5 px-2 py-1">
          {moves.length} would move
        </span>
        <span className="text-[10px] font-black tracking-widest uppercase text-white/30 bg-white/5 px-2 py-1">
          {unchanged.length} already correct
        </span>
        {errors.length > 0 && (
          <span className="text-[10px] font-black tracking-widest uppercase text-red-400 bg-red-400/10 px-2 py-1">
            {errors.length} errors
          </span>
        )}
      </div>

      {/* Moves list */}
      {moves.length > 0 && (
        <div className="border border-white/10 max-h-64 overflow-y-auto">
          {moves.map((r) => (
            <div
              key={r.book_id}
              className="px-4 py-2.5 border-b border-white/5 last:border-0"
            >
              <p className="text-xs text-white/70 normal-case truncate">
                {r.book_title}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-white/30 font-mono normal-case truncate flex-1">
                  {r.old_path}
                </span>
                <ChevronRight size={10} className="shrink-0 text-white/20" />
                <span className="text-[10px] text-primary font-mono normal-case truncate flex-1">
                  {r.new_path}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <div className="border border-red-400/20 bg-red-400/5">
          {errors.map((r) => (
            <div
              key={r.book_id}
              className="px-4 py-2 border-b border-red-400/10 last:border-0"
            >
              <p className="text-xs text-red-400 normal-case">
                {r.book_title}: {r.error}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Settings() {
  const [shelvesKey, setShelvesKey] = useState(0)
  const { data: shelves } = useApi<Shelf[]>(`/api/shelves?_k=${shelvesKey}`)
  const [editingShelf, setEditingShelf] = useState<Shelf | null>(null)
  const [showCreateShelf, setShowCreateShelf] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ── Organize state ──
  const [organizeShelfId, setOrganizeShelfId] = useState<string>('')
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const [seqPad, setSeqPad] = useState(2)
  const [previewResults, setPreviewResults] = useState<
    OrganizerResult[] | null
  >(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyDone, setApplyDone] = useState<{ moved: number } | null>(null)
  const [organizeError, setOrganizeError] = useState<string | null>(null)
  const templateRef = useRef<HTMLInputElement>(null)

  // ── Scan state ──
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Backfill-covers state ──
  const [backfillLoading, setBackfillLoading] = useState(false)
  const [backfillResult, setBackfillResult] =
    useState<BackfillCoversResponse | null>(null)
  const [backfillError, setBackfillError] = useState<string | null>(null)

  // Auto-select first shelf when shelves load
  useEffect(() => {
    if (shelves && shelves.length > 0 && !organizeShelfId) {
      setOrganizeShelfId(String(shelves[0].id))
    }
  }, [shelves, organizeShelfId])

  // Fetch initial scan status
  useEffect(() => {
    api.get<ScanStatus>('/api/import/status').then((s) => {
      if (s) setScanStatus(s)
    })
  }, [])

  // Poll scan status while running
  const startPolling = useCallback(() => {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      const s = await api.get<ScanStatus>('/api/import/status')
      if (s) {
        setScanStatus(s)
        if (!s.is_running) {
          clearInterval(pollRef.current!)
          pollRef.current = null
        }
      }
    }, 1500)
  }, [])

  useEffect(() => {
    if (scanStatus?.is_running) startPolling()
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [scanStatus?.is_running, startPolling])

  // ── Handlers ──

  const handleDeleteShelf = async (shelf: Shelf) => {
    if (
      !window.confirm(
        `Delete shelf "${shelf.name}"? This fails if the shelf has books.`
      )
    )
      return
    setDeleteError(null)
    try {
      await api.delete(`/api/shelves/${shelf.id}`)
      setShelvesKey((k) => k + 1)
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setDeleteError(apiErr.data?.detail ?? 'Failed to delete shelf.')
    }
  }

  const handleShelfSaved = () => {
    setShowCreateShelf(false)
    setEditingShelf(null)
    setShelvesKey((k) => k + 1)
  }

  const insertToken = (token: string) => {
    const input = templateRef.current
    if (!input) {
      setTemplate((t) => t + token)
      return
    }
    const start = input.selectionStart ?? template.length
    const end = input.selectionEnd ?? template.length
    const next = template.slice(0, start) + token + template.slice(end)
    setTemplate(next)
    setTimeout(() => {
      input.focus()
      input.setSelectionRange(start + token.length, start + token.length)
    }, 0)
  }

  const handlePreview = async () => {
    if (!organizeShelfId) {
      setOrganizeError('Select a shelf first.')
      return
    }
    setPreviewLoading(true)
    setPreviewResults(null)
    setApplyDone(null)
    setOrganizeError(null)
    try {
      const qs = new URLSearchParams({
        shelf_id: organizeShelfId,
        seq_pad: String(seqPad),
        ...(template.trim() ? { template: template.trim() } : {}),
      })
      const results = await api.get<OrganizerResult[]>(
        `/api/organize/preview?${qs}`
      )
      setPreviewResults(results ?? [])
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setOrganizeError(apiErr.data?.detail ?? 'Preview failed.')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleApply = async () => {
    if (!organizeShelfId) return
    const movesCount =
      previewResults?.filter((r) => !r.already_correct && !r.error).length ?? 0
    if (
      !window.confirm(`Apply organization? ${movesCount} files will be moved.`)
    )
      return
    setApplyLoading(true)
    setOrganizeError(null)
    try {
      const results = await api.post<OrganizerResult[]>('/api/organize/apply', {
        shelf_id: parseInt(organizeShelfId, 10),
        template: template.trim() || null,
        seq_pad: seqPad,
      })
      const moved = results?.filter((r) => r.moved).length ?? 0
      setApplyDone({ moved })
      setPreviewResults(null)
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setOrganizeError(apiErr.data?.detail ?? 'Apply failed.')
    } finally {
      setApplyLoading(false)
    }
  }

  const handleBackfillCovers = async () => {
    setBackfillLoading(true)
    setBackfillResult(null)
    setBackfillError(null)
    try {
      const result = await api.post<BackfillCoversResponse>(
        '/api/import/backfill-covers',
        {}
      )
      if (result) setBackfillResult(result)
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setBackfillError(apiErr.data?.detail ?? 'Backfill failed.')
    } finally {
      setBackfillLoading(false)
    }
  }

  const handleScan = async () => {
    setScanLoading(true)
    setScanError(null)
    try {
      await api.post('/api/import/scan', {})
      const s = await api.get<ScanStatus>('/api/import/status')
      if (s) setScanStatus(s)
      startPolling()
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setScanError(apiErr.data?.detail ?? 'Scan failed to start.')
    } finally {
      setScanLoading(false)
    }
  }

  const examplePath = computeExamplePath(template)
  const shelfList = shelves ?? []

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-12">
      <h1 className="text-xs font-black tracking-widest uppercase text-white">
        Settings
      </h1>

      {/* ── 01 Shelves ── */}
      <section>
        <SectionHeader
          num="01"
          title="Shelves"
          description="Directories that Shelfloom monitors for book files."
        />

        {deleteError && (
          <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 mb-4 normal-case">
            {deleteError}
          </p>
        )}

        <div className="space-y-2 mb-4" data-testid="shelf-list">
          {shelfList.length === 0 ? (
            <p className="text-xs text-white/30 tracking-widest uppercase text-center py-8 border border-white/10">
              No shelves configured
            </p>
          ) : (
            shelfList.map((shelf) => (
              <ShelfCard
                key={shelf.id}
                shelf={shelf}
                onEdit={() => setEditingShelf(shelf)}
                onDelete={() => handleDeleteShelf(shelf)}
              />
            ))
          )}
        </div>

        <button
          onClick={() => setShowCreateShelf(true)}
          data-testid="add-shelf-btn"
          className="flex items-center gap-2 px-4 py-2.5 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 transition-colors"
        >
          <Plus size={13} />
          Add Shelf
        </button>
      </section>

      {/* ── 02 File Organization ── */}
      <section>
        <SectionHeader
          num="02"
          title="File Organization"
          description="Rearrange books on disk into a consistent folder structure."
        />

        <div className="space-y-5">
          {/* Shelf selector */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
              Target Shelf
            </label>
            <select
              value={organizeShelfId}
              onChange={(e) => {
                setOrganizeShelfId(e.target.value)
                setPreviewResults(null)
                setApplyDone(null)
              }}
              data-testid="organize-shelf-select"
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case focus:outline-none focus:border-primary transition-colors appearance-none"
            >
              <option value="">— Select a shelf —</option>
              {shelfList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Template input */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
              Path Template
            </label>
            <input
              ref={templateRef}
              type="text"
              value={template}
              onChange={(e) => {
                setTemplate(e.target.value)
                setPreviewResults(null)
                setApplyDone(null)
              }}
              data-testid="template-input"
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white font-mono normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
            />

            {/* Token chips */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {TOKENS.map(({ label }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => insertToken(label)}
                  className="text-[10px] font-mono font-black text-primary bg-primary/10 border border-primary/20 px-2 py-1 hover:bg-primary/20 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Sequence padding */}
          <div className="flex items-center gap-4">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
                Sequence Padding
              </label>
              <input
                type="number"
                min={1}
                max={6}
                value={seqPad}
                onChange={(e) => setSeqPad(parseInt(e.target.value, 10) || 2)}
                className="w-24 bg-black border border-white/10 px-4 py-3 text-sm text-white text-center focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>

          {/* Live example path */}
          <div className="p-4 border border-white/5 bg-white/[0.02]">
            <p className="text-[10px] font-black tracking-widest uppercase text-white/30 mb-2">
              Example path
            </p>
            <p
              className="text-xs text-primary font-mono normal-case break-all"
              data-testid="example-path"
            >
              {examplePath}
            </p>
          </div>

          {organizeError && (
            <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
              {organizeError}
            </p>
          )}

          {/* Preview results */}
          {previewResults && <OrganizerResultTable results={previewResults} />}

          {/* Apply success */}
          {applyDone && (
            <div className="flex items-center gap-2 px-4 py-3 border border-primary/20 bg-primary/5">
              <CheckCircle2 size={14} className="text-primary shrink-0" />
              <p className="text-xs text-primary font-black tracking-widest uppercase">
                {applyDone.moved} files moved successfully
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={handlePreview}
              disabled={previewLoading || !organizeShelfId}
              data-testid="preview-btn"
              className="flex items-center gap-2 px-5 py-2.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/60 hover:text-white hover:border-white/40 disabled:opacity-40 transition-colors"
            >
              {previewLoading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <FolderCog size={13} />
              )}
              Dry Run Preview
            </button>

            {previewResults &&
              previewResults.some((r) => !r.already_correct && !r.error) && (
                <button
                  onClick={handleApply}
                  disabled={applyLoading}
                  data-testid="apply-btn"
                  className="flex items-center gap-2 px-5 py-2.5 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
                >
                  {applyLoading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Play size={13} />
                  )}
                  Apply
                </button>
              )}
          </div>
        </div>
      </section>

      {/* ── 03 Library Scan ── */}
      <section>
        <SectionHeader
          num="03"
          title="Library Scan"
          description="Discover and import new or changed book files from all shelves."
        />

        <div className="space-y-5">
          {/* Status card */}
          {scanStatus && (
            <div
              className="p-4 border border-white/10 bg-white/[0.02] space-y-3"
              data-testid="scan-status"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {scanStatus.is_running ? (
                    <Loader2 size={14} className="text-primary animate-spin" />
                  ) : scanStatus.error ? (
                    <AlertCircle size={14} className="text-red-400" />
                  ) : (
                    <CheckCircle2 size={14} className="text-white/30" />
                  )}
                  <span className="text-[10px] font-black tracking-widest uppercase text-white/60">
                    {scanStatus.is_running
                      ? 'Scanning…'
                      : scanStatus.error
                        ? 'Scan error'
                        : 'Idle'}
                  </span>
                </div>
                {scanStatus.last_scan_at && (
                  <div className="flex items-center gap-1.5 text-[10px] text-white/30">
                    <Clock size={11} />
                    <span className="normal-case">
                      Last scan{' '}
                      {new Date(scanStatus.last_scan_at).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Progress */}
              {scanStatus.is_running && scanStatus.progress && (
                <div className="space-y-2" data-testid="scan-progress">
                  <div className="h-1 bg-white/10 w-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-500"
                      style={{
                        width:
                          scanStatus.progress.total > 0
                            ? `${Math.round((scanStatus.progress.processed / scanStatus.progress.total) * 100)}%`
                            : '0%',
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-white/40 normal-case">
                    <span>
                      {scanStatus.progress.processed} /{' '}
                      {scanStatus.progress.total} files
                    </span>
                    <span className="text-primary">
                      +{scanStatus.progress.created} new
                    </span>
                    <span>{scanStatus.progress.updated} updated</span>
                    {scanStatus.progress.errors > 0 && (
                      <span className="text-red-400">
                        {scanStatus.progress.errors} errors
                      </span>
                    )}
                  </div>
                </div>
              )}

              {scanStatus.error && (
                <p className="text-xs text-red-400 normal-case">
                  {scanStatus.error}
                </p>
              )}
            </div>
          )}

          {scanError && (
            <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
              {scanError}
            </p>
          )}

          <button
            onClick={handleScan}
            disabled={scanLoading || scanStatus?.is_running}
            data-testid="scan-btn"
            className="flex items-center gap-2 px-5 py-2.5 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
          >
            {scanLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            {scanStatus?.is_running ? 'Scanning…' : 'Trigger Scan'}
          </button>

          {/* Backfill covers */}
          <div className="pt-4 border-t border-white/5">
            <p className="text-[10px] text-white/30 normal-case mb-3">
              Re-extract cover images for all books that have no cover or a
              missing cover file.
            </p>
            {backfillError && (
              <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 mb-3 normal-case">
                {backfillError}
              </p>
            )}
            {backfillResult && (
              <div className="flex items-center gap-2 px-4 py-3 border border-primary/20 bg-primary/5 mb-3">
                <CheckCircle2 size={14} className="text-primary shrink-0" />
                <p className="text-xs text-primary font-black tracking-widest uppercase">
                  {backfillResult.refreshed} refreshed ·{' '}
                  {backfillResult.skipped} already had cover ·{' '}
                  {backfillResult.failed} failed
                </p>
              </div>
            )}
            <button
              onClick={handleBackfillCovers}
              disabled={backfillLoading}
              data-testid="backfill-covers-btn"
              className="flex items-center gap-2 px-5 py-2.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/60 hover:text-white hover:border-white/40 disabled:opacity-40 transition-colors"
            >
              {backfillLoading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              Backfill Missing Covers
            </button>
          </div>
        </div>
      </section>

      {/* Modals */}
      {showCreateShelf && (
        <ShelfModal
          onClose={() => setShowCreateShelf(false)}
          onSaved={handleShelfSaved}
        />
      )}
      {editingShelf && (
        <ShelfModal
          shelf={editingShelf}
          onClose={() => setEditingShelf(null)}
          onSaved={handleShelfSaved}
        />
      )}
    </div>
  )
}
