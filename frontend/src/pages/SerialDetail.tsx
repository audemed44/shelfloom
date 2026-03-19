import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Trash2,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import VolumeList from '../components/serials/VolumeList'
import ChapterList from '../components/serials/ChapterList'
import type { WebSerial, SerialVolume, Shelf } from '../types/api'

const STATUS_STYLES: Record<string, string> = {
  ongoing: 'bg-green-500/20 text-green-400',
  completed: 'bg-primary/20 text-primary',
  paused: 'bg-amber-500/20 text-amber-400',
  error: 'bg-red-500/20 text-red-400',
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function SerialDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const serialId = id ? parseInt(id, 10) : null

  const [refreshKey, setRefreshKey] = useState(0)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { data: serial, loading } = useApi<WebSerial>(
    serialId ? `/api/serials/${serialId}?_k=${refreshKey}` : null
  )
  const { data: volumes } = useApi<SerialVolume[]>(
    serialId ? `/api/serials/${serialId}/volumes?_k=${refreshKey}` : null
  )
  const { data: shelves } = useApi<Shelf[]>('/api/shelves')

  const refresh = () => setRefreshKey((k) => k + 1)

  const handleUpdate = async () => {
    if (!serialId) return
    setUpdating(true)
    setUpdateMsg(null)
    try {
      const result = await api.post<{ new_chapters: number }>(
        `/api/serials/${serialId}/update`
      )
      setUpdateMsg(
        result
          ? `${result.new_chapters} new chapter${result.new_chapters !== 1 ? 's' : ''} found`
          : 'Up to date'
      )
      refresh()
    } catch {
      setUpdateMsg('Update failed — check your connection and try again')
    } finally {
      setUpdating(false)
    }
  }

  const handleDelete = async () => {
    if (!serialId || !serial) return
    if (
      !window.confirm(
        `Delete "${serial.title ?? 'this serial'}"? This cannot be undone.`
      )
    )
      return
    setDeleting(true)
    try {
      await api.delete(`/api/serials/${serialId}`)
      navigate('/serials')
    } catch {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 animate-pulse space-y-6">
        <div className="h-3 w-40 bg-white/10" />
        <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-8">
          <div className="w-40 aspect-[2/3] bg-white/5" />
          <div className="space-y-4 pt-2">
            <div className="h-3 w-20 bg-white/10" />
            <div className="h-12 w-80 bg-white/10" />
            <div className="h-4 w-40 bg-white/5" />
          </div>
        </div>
      </div>
    )
  }

  if (!serial) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <AlertTriangle size={32} className="text-white/20" />
        <p className="text-sm text-white/40 tracking-widest uppercase">
          Serial not found
        </p>
        <Link to="/serials" className="text-xs text-primary hover:underline">
          Back to Serials
        </Link>
      </div>
    )
  }

  const statusClass =
    STATUS_STYLES[serial.status] ?? 'bg-white/10 text-white/50'

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <nav
        className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase text-white/40 mb-8"
        aria-label="breadcrumb"
      >
        <Link to="/serials" className="hover:text-primary transition-colors">
          Serials
        </Link>
        <ChevronRight size={10} className="text-white/20" />
        <span className="text-white/70 truncate max-w-xs">
          {serial.title ?? 'Untitled'}
        </span>
      </nav>

      {/* Header */}
      <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-8 mb-12">
        {/* Cover */}
        <div className="w-40 aspect-[2/3] bg-white/5 border border-white/10 overflow-hidden shrink-0">
          <img
            src={`/api/serials/${serial.id}/cover`}
            alt={serial.title ?? 'Cover'}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        </div>

        {/* Meta */}
        <div className="flex flex-col">
          {/* Status badge */}
          <div className="mb-3">
            <span
              className={`text-[10px] font-black tracking-widest px-2.5 py-1 ${statusClass}`}
            >
              {serial.status}
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-white leading-[0.95] uppercase mb-2">
            {serial.title ?? 'Untitled'}
          </h1>
          {serial.author && (
            <p className="text-lg text-white/50 font-light normal-case mb-4">
              {serial.author}
            </p>
          )}

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-6 mb-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-0.5">
                Chapters
              </p>
              <p className="text-xl font-black">{serial.total_chapters}</p>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-0.5">
                Last Checked
              </p>
              <p className="text-sm font-medium normal-case">
                {fmtDate(serial.last_checked_at)}
              </p>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-0.5">
                Source
              </p>
              <a
                href={serial.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-primary hover:underline normal-case"
              >
                {serial.source}
                <ExternalLink size={11} />
              </a>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleUpdate}
              disabled={updating}
              className="flex items-center gap-2 px-5 py-2.5 text-[10px] font-black tracking-widest uppercase bg-white/5 border border-white/10 text-white/70 hover:text-white hover:border-white/30 disabled:opacity-40 rounded-lg transition-all"
            >
              {updating ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              Check for Updates
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-2 px-4 py-2.5 text-[10px] font-black tracking-widest uppercase border border-red-500/20 text-red-400/50 hover:text-red-400 hover:border-red-400/50 disabled:opacity-40 rounded-lg transition-all"
            >
              {deleting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Trash2 size={13} />
              )}
            </button>
          </div>

          {updateMsg && (
            <p className="text-xs text-white/50 normal-case mt-3">
              {updateMsg}
            </p>
          )}
          {serial.last_error && (
            <p className="text-xs text-red-400 normal-case mt-3 border border-red-400/20 bg-red-400/5 px-3 py-2">
              {serial.last_error}
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      {serial.description && (
        <div className="mb-10">
          <p className="text-sm text-white/60 normal-case leading-relaxed max-w-3xl">
            {serial.description}
          </p>
        </div>
      )}

      {/* 01 VOLUMES */}
      <section className="mb-12" data-testid="volumes-section">
        <div className="flex items-baseline gap-3 border-b border-white/10 pb-2 mb-6">
          <span className="text-[10px] font-black tracking-widest text-white/20">
            01
          </span>
          <h2 className="text-[10px] font-black tracking-widest uppercase text-white/60">
            Volumes
          </h2>
          {volumes && volumes.length > 0 && (
            <span className="text-[10px] text-white/30 ml-auto">
              {volumes.length} configured
            </span>
          )}
        </div>
        <VolumeList
          serialId={serial.id}
          volumes={volumes ?? []}
          totalChapters={serial.total_chapters}
          shelves={shelves ?? []}
          onRefresh={refresh}
        />
      </section>

      {/* 02 CHAPTERS */}
      <section data-testid="chapters-section">
        <div className="flex items-baseline gap-3 border-b border-white/10 pb-2 mb-6">
          <span className="text-[10px] font-black tracking-widest text-white/20">
            02
          </span>
          <h2 className="text-[10px] font-black tracking-widest uppercase text-white/60">
            Chapters
          </h2>
          <span className="text-[10px] text-white/30 ml-auto">
            {serial.total_chapters} total
          </span>
        </div>
        <ChapterList
          serialId={serial.id}
          totalChapters={serial.total_chapters}
        />
      </section>
    </div>
  )
}
