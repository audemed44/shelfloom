import { useState, useEffect, useCallback } from 'react'
import {
  X,
  Folder,
  FolderOpen,
  ChevronRight,
  Home,
  Check,
  Loader2,
} from 'lucide-react'
import { api } from '../../api/client'

interface DirEntry {
  name: string
  path: string
  has_children: boolean
}

interface DirListing {
  path: string
  parent: string | null
  entries: DirEntry[]
}

interface DirPickerProps {
  initialPath?: string
  onSelect: (path: string) => void
  onClose: () => void
}

export default function DirPicker({
  initialPath,
  onSelect,
  onClose,
}: DirPickerProps) {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>(initialPath ?? '')
  const [history, setHistory] = useState<string[]>([])

  const navigate = useCallback(
    async (path: string | null, pushHistory = true) => {
      setLoading(true)
      setError(null)
      try {
        const url = path
          ? `/api/fs/dirs?path=${encodeURIComponent(path)}`
          : '/api/fs/dirs'
        const data = await api.get<DirListing>(url)
        if (data) {
          if (pushHistory && listing) {
            setHistory((h) => [...h, listing.path])
          }
          setListing(data)
          setSelected(data.path || path || '')
        }
      } catch {
        setError('Could not read directory.')
      } finally {
        setLoading(false)
      }
    },
    [listing]
  )

  useEffect(() => {
    navigate(initialPath && initialPath.trim() ? initialPath : null, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goUp = () => {
    if (listing?.parent != null) navigate(listing.parent)
  }

  const goBack = () => {
    const prev = history[history.length - 1]
    if (prev !== undefined) {
      setHistory((h) => h.slice(0, -1))
      navigate(prev || null, false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md bg-black border border-white/10 shadow-2xl flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Folder size={14} className="text-primary" />
            <span className="text-[10px] font-black tracking-widest uppercase text-white">
              Browse Directory
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Current path breadcrumb */}
        <div className="px-5 py-2 border-b border-white/10 shrink-0 flex items-center gap-2">
          <button
            onClick={() => navigate(null)}
            className="text-white/30 hover:text-primary transition-colors shrink-0"
            title="Go to root"
          >
            <Home size={12} />
          </button>
          <ChevronRight size={10} className="text-white/20 shrink-0" />
          <p
            className="text-[10px] font-mono text-white/50 truncate"
            title={selected}
          >
            {selected || '/'}
          </p>
        </div>

        {/* Directory listing */}
        <div className="flex-1 overflow-y-auto py-1 min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-8 text-white/30">
              <Loader2 size={16} className="animate-spin" />
            </div>
          )}
          {error && !loading && (
            <p className="text-[10px] text-red-400 px-5 py-3 normal-case">
              {error}
            </p>
          )}
          {!loading && !error && listing && (
            <>
              {listing.parent != null && (
                <button
                  onClick={goUp}
                  className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-white/5 text-white/40 hover:text-white/70 transition-colors group"
                >
                  <FolderOpen size={13} className="shrink-0" />
                  <span className="text-xs font-mono normal-case">..</span>
                </button>
              )}
              {listing.entries.length === 0 && (
                <p className="text-[10px] text-white/30 px-5 py-4 normal-case italic">
                  No subdirectories
                </p>
              )}
              {listing.entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => {
                    setSelected(entry.path)
                    if (entry.has_children) navigate(entry.path)
                  }}
                  className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors group ${
                    selected === entry.path
                      ? 'bg-primary/10 text-white'
                      : 'hover:bg-white/5 text-white/60 hover:text-white'
                  }`}
                >
                  {selected === entry.path ? (
                    <FolderOpen size={13} className="shrink-0 text-primary" />
                  ) : (
                    <Folder size={13} className="shrink-0" />
                  )}
                  <span className="text-xs font-mono normal-case flex-1 truncate">
                    {entry.name}
                  </span>
                  {entry.has_children && (
                    <ChevronRight
                      size={11}
                      className="shrink-0 text-white/20 group-hover:text-white/40"
                    />
                  )}
                  {selected === entry.path && !entry.has_children && (
                    <Check size={11} className="shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/10 shrink-0">
          <button
            type="button"
            onClick={goBack}
            disabled={history.length === 0}
            className="text-[10px] font-black tracking-widest uppercase text-white/30 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            ← Back
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-[10px] font-black tracking-widest uppercase text-white/40 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() => {
                if (selected) onSelect(selected)
              }}
              className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Check size={11} />
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
