import { useState, useRef, useCallback } from 'react'
import {
  Upload,
  X,
  FileText,
  ChevronDown,
  ChevronUp,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { api } from '../../api/client'
import type { Book } from '../../types'
import type { Tag } from '../../types/api'
import GenreCombobox from '../shared/GenreCombobox'
import TagPicker from '../shared/TagPicker'
import SeriesPicker from '../shared/SeriesPicker'

const ACCEPTED = new Set(['.epub', '.pdf'])

interface BulkFile {
  id: string
  file: File
  sequence: number | null
  status: 'pending' | 'uploading' | 'patching' | 'done' | 'error'
  error?: string
}

interface SharedMeta {
  author: string
  genres: string[]
  tags: Tag[]
  seriesId: number | null
}

interface BulkUploadZoneProps {
  onSuccess: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

let fileIdCounter = 0

export default function BulkUploadZone({ onSuccess }: BulkUploadZoneProps) {
  const [files, setFiles] = useState<BulkFile[]>([])
  const [meta, setMeta] = useState<SharedMeta>({
    author: '',
    genres: [],
    tags: [],
    seriesId: null,
  })
  const [metaExpanded, setMetaExpanded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const newFiles: BulkFile[] = []
    const arr = Array.from(fileList)
    for (const file of arr) {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
      if (!ACCEPTED.has(ext)) continue
      newFiles.push({
        id: `file-${++fileIdCounter}`,
        file,
        sequence: null,
        status: 'pending',
      })
    }
    if (newFiles.length > 0) {
      setFiles((prev) => {
        const combined = [...prev, ...newFiles]
        // Auto-assign sequence numbers for new pending files
        const startSeq =
          Math.max(0, ...combined.map((f) => f.sequence ?? 0)) -
          newFiles.length +
          1
        let seq = Math.max(1, startSeq)
        return combined.map((f) => {
          if (newFiles.includes(f)) {
            return { ...f, sequence: seq++ }
          }
          return f
        })
      })
      setMetaExpanded(true)
    }
  }, [])

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setFiles([])
    setMeta({ author: '', genres: [], tags: [], seriesId: null })
    setMetaExpanded(false)
  }, [])

  const updateSequence = useCallback((id: string, seq: number | null) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, sequence: seq } : f))
    )
  }, [])

  const handleUploadAll = useCallback(async () => {
    const pending = files.filter((f) => f.status === 'pending')
    if (pending.length === 0) return

    setUploading(true)

    for (const bulkFile of pending) {
      // Step 1: Upload
      setFiles((prev) =>
        prev.map((f) =>
          f.id === bulkFile.id ? { ...f, status: 'uploading' } : f
        )
      )

      let bookId: string
      try {
        const form = new FormData()
        form.append('file', bulkFile.file)
        const book = await api.upload<Book>('/api/books', form)
        if (!book) throw new Error('Upload returned no data')
        bookId = book.id
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === bulkFile.id
              ? {
                  ...f,
                  status: 'error',
                  error: err instanceof Error ? err.message : 'Upload failed',
                }
              : f
          )
        )
        continue
      }

      // Step 2: Patch metadata
      setFiles((prev) =>
        prev.map((f) =>
          f.id === bulkFile.id ? { ...f, status: 'patching' } : f
        )
      )

      try {
        const patch: Record<string, string | null> = {}
        if (meta.author.trim()) patch.author = meta.author.trim()
        if (meta.genres.length > 0) patch.genre = meta.genres.join(', ')

        if (Object.keys(patch).length > 0) {
          await api.patch(`/api/books/${bookId}`, patch)
        }

        // Step 3: Assign tags
        for (const tag of meta.tags) {
          await api.post(`/api/books/${bookId}/tags/${tag.id}`, {})
        }

        // Step 4: Assign series
        if (meta.seriesId) {
          const qs =
            bulkFile.sequence != null
              ? `?sequence=${encodeURIComponent(String(bulkFile.sequence))}`
              : ''
          await api.post(
            `/api/series/${meta.seriesId}/books/${bookId}${qs}`,
            {}
          )
        }

        setFiles((prev) =>
          prev.map((f) => (f.id === bulkFile.id ? { ...f, status: 'done' } : f))
        )
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === bulkFile.id
              ? {
                  ...f,
                  status: 'error',
                  error:
                    err instanceof Error
                      ? err.message
                      : 'Failed to apply metadata',
                }
              : f
          )
        )
      }
    }

    setUploading(false)
    onSuccess()
  }, [files, meta, onSuccess])

  const pendingCount = files.filter((f) => f.status === 'pending').length
  const doneCount = files.filter((f) => f.status === 'done').length
  const hasFiles = files.length > 0

  return (
    <div
      data-testid="upload-zone"
      onDrop={(e) => {
        e.preventDefault()
        setIsDragOver(false)
        if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      className={`border-2 border-dashed transition-colors ${
        isDragOver
          ? 'border-primary bg-primary/5'
          : 'border-white/10 hover:border-white/20'
      }`}
    >
      {/* Drop bar / file picker */}
      <input
        ref={inputRef}
        type="file"
        accept=".epub,.pdf"
        multiple
        className="sr-only"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files)
          e.target.value = ''
        }}
        data-testid="file-input"
      />

      <div className="flex items-center justify-center gap-3 py-5 px-4 flex-wrap">
        <Upload
          size={14}
          className={isDragOver ? 'text-primary' : 'text-white/20'}
        />
        <span
          className={`text-xs normal-case ${isDragOver ? 'text-primary/80' : 'text-white/20'}`}
        >
          Drop EPUBs or PDFs here, or
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-xs font-black tracking-widest text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
          data-testid="browse-button"
        >
          BROWSE
        </button>
      </div>

      {/* Expanded section when files are selected */}
      {hasFiles && (
        <div className="border-t border-white/10 px-4 py-4 space-y-4">
          {/* File list */}
          <div className="space-y-1" data-testid="file-list">
            {files.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 px-3 py-2 bg-white/[0.02] border border-white/5"
                data-testid="file-row"
              >
                <FileText size={14} className="text-white/20 shrink-0" />
                <span className="flex-1 text-sm text-white/70 normal-case truncate">
                  {f.file.name}
                </span>
                <span className="text-[10px] text-white/30 shrink-0">
                  {formatSize(f.file.size)}
                </span>

                {/* Series sequence input */}
                {meta.seriesId && f.status === 'pending' && (
                  <input
                    type="number"
                    step="1"
                    value={f.sequence ?? ''}
                    onChange={(e) =>
                      updateSequence(
                        f.id,
                        e.target.value ? parseFloat(e.target.value) : null
                      )
                    }
                    placeholder="#"
                    className="w-14 bg-black border border-white/10 px-1.5 py-1 text-xs text-white text-center placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
                    data-testid="sequence-input"
                  />
                )}

                {/* Status indicator */}
                {f.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    disabled={uploading}
                    className="text-white/30 hover:text-red-400 transition-colors disabled:opacity-30"
                    aria-label={`Remove ${f.file.name}`}
                  >
                    <X size={14} />
                  </button>
                )}
                {(f.status === 'uploading' || f.status === 'patching') && (
                  <Loader2
                    size={14}
                    className="text-primary animate-spin shrink-0"
                  />
                )}
                {f.status === 'done' && (
                  <Check size={14} className="text-green-400 shrink-0" />
                )}
                {f.status === 'error' && (
                  <span
                    title={f.error}
                    className="flex items-center gap-1 text-red-400"
                  >
                    <AlertCircle size={14} />
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Shared metadata — collapsible */}
          <div>
            <button
              type="button"
              onClick={() => setMetaExpanded(!metaExpanded)}
              className="flex items-center gap-2 text-[10px] font-black tracking-widest uppercase text-white/40 hover:text-white/60 transition-colors w-full"
              data-testid="meta-toggle"
            >
              {metaExpanded ? (
                <ChevronUp size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
              Shared Metadata
              {(meta.author ||
                meta.genres.length > 0 ||
                meta.tags.length > 0 ||
                meta.seriesId) && <span className="text-primary">●</span>}
            </button>

            {metaExpanded && (
              <div className="mt-3 space-y-4">
                {/* Author */}
                <div>
                  <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1.5">
                    Author
                  </label>
                  <input
                    type="text"
                    value={meta.author}
                    onChange={(e) =>
                      setMeta((m) => ({ ...m, author: e.target.value }))
                    }
                    placeholder="Author name"
                    className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
                    data-testid="meta-author"
                  />
                </div>

                {/* Genres */}
                <GenreCombobox
                  value={meta.genres}
                  onChange={(genres) => setMeta((m) => ({ ...m, genres }))}
                />

                {/* Tags */}
                <TagPicker
                  value={meta.tags}
                  onChange={(tags) => setMeta((m) => ({ ...m, tags }))}
                />

                {/* Series */}
                <SeriesPicker
                  value={meta.seriesId}
                  onChange={(seriesId) => setMeta((m) => ({ ...m, seriesId }))}
                />
              </div>
            )}
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between pt-3 border-t border-white/10">
            <div className="text-[10px] font-black tracking-widest text-white/30">
              {uploading
                ? `${doneCount}/${files.length} uploaded`
                : `${pendingCount} file${pendingCount !== 1 ? 's' : ''} ready`}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={clearAll}
                disabled={uploading}
                className="px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 hover:text-white transition-colors disabled:opacity-30"
                data-testid="clear-button"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleUploadAll}
                disabled={uploading || pendingCount === 0}
                className="flex items-center gap-2 px-5 py-2 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
                data-testid="upload-all-button"
              >
                {uploading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Upload size={12} />
                    Upload All
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
