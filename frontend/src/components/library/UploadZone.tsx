import { useRef, useState, useCallback } from 'react'
import { Upload, X } from 'lucide-react'
import { api } from '../../api/client'
import type { Book } from '../../types'

const ACCEPTED = new Set(['.epub', '.pdf'])

interface UploadZoneProps {
  onSuccess: (book: Book) => void
  highlighted?: boolean
}

type State =
  | { status: 'idle' }
  | { status: 'uploading'; filename: string }
  | { status: 'error'; message: string }

export default function UploadZone({ onSuccess, highlighted = false }: UploadZoneProps) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useCallback(async (file: File) => {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!ACCEPTED.has(ext)) {
      setState({ status: 'error', message: 'Only .epub and .pdf files are supported' })
      return
    }
    setState({ status: 'uploading', filename: file.name })
    try {
      const form = new FormData()
      form.append('file', file)
      const book = await api.upload<Book>('/api/books', form)
      setState({ status: 'idle' })
      if (book) onSuccess(book)
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Upload failed' })
    }
  }, [onSuccess])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) upload(file)
  }

  const isUploading = state.status === 'uploading'
  const active = isDragOver || highlighted

  return (
    <div
      data-testid="upload-zone"
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      className={`border-2 border-dashed transition-colors mb-6 ${
        active ? 'border-primary bg-primary/5' : 'border-white/10 hover:border-white/20'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".epub,.pdf"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload(file)
          e.target.value = ''
        }}
        data-testid="file-input"
      />

      <div className="flex items-center justify-center gap-3 py-5 px-4 flex-wrap">
        {isUploading ? (
          <>
            <div
              data-testid="upload-spinner"
              className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0"
            />
            <span className="text-xs text-white/40 normal-case">
              Uploading {(state as { status: 'uploading'; filename: string }).filename}…
            </span>
          </>
        ) : (
          <>
            <Upload size={14} className={active ? 'text-primary' : 'text-white/20'} />
            <span className={`text-xs normal-case ${active ? 'text-primary/80' : 'text-white/20'}`}>
              Drop an EPUB or PDF here, or
            </span>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-xs font-black tracking-widest text-primary hover:text-primary/80 transition-colors"
              data-testid="browse-button"
            >
              BROWSE
            </button>
          </>
        )}
      </div>

      {state.status === 'error' && (
        <div
          className="flex items-center gap-2 px-4 pb-4 text-xs text-red-400 normal-case"
          data-testid="upload-error"
        >
          <span>{state.message}</span>
          <button
            type="button"
            onClick={() => setState({ status: 'idle' })}
            className="ml-auto text-white/30 hover:text-white/60 transition-colors"
            aria-label="Dismiss error"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
