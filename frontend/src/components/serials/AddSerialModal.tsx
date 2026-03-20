import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Scroll, Plus } from 'lucide-react'
import { api } from '../../api/client'
import { useApi } from '../../hooks/useApi'
import type { WebSerial } from '../../types/api'
import type { Shelf } from '../../types/api'

interface AddSerialModalProps {
  onClose: () => void
  onSaved: (serial: WebSerial) => void
}

export default function AddSerialModal({
  onClose,
  onSaved,
}: AddSerialModalProps) {
  const [url, setUrl] = useState('')
  const [adapter, setAdapter] = useState<string>('')
  const [detectedAdapter, setDetectedAdapter] = useState<string | null>(null)
  const [shelfId, setShelfId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: shelves } = useApi<Shelf[]>('/api/shelves')
  const { data: adapters } = useApi<string[]>('/api/serials/adapters')

  const detectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userOverrode = useRef(false)

  const detectAdapter = useCallback(
    async (inputUrl: string) => {
      const trimmed = inputUrl.trim()
      if (!trimmed) {
        setDetectedAdapter(null)
        if (!userOverrode.current) setAdapter('')
        return
      }
      try {
        const result = await api.get<{ adapter: string | null }>(
          `/api/serials/detect-adapter?url=${encodeURIComponent(trimmed)}`
        )
        if (result) {
          setDetectedAdapter(result.adapter)
          if (!userOverrode.current) {
            setAdapter(result.adapter ?? '')
          }
        }
      } catch {
        // ignore detection errors
      }
    },
    [setDetectedAdapter, setAdapter]
  )

  useEffect(() => {
    if (detectTimer.current) clearTimeout(detectTimer.current)
    detectTimer.current = setTimeout(() => detectAdapter(url), 400)
    return () => {
      if (detectTimer.current) clearTimeout(detectTimer.current)
    }
  }, [url, detectAdapter])

  const handleAdapterChange = (value: string) => {
    setAdapter(value)
    userOverrode.current = value !== '' && value !== detectedAdapter
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) {
      setError('Please enter a URL.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const serial = await api.post<WebSerial>('/api/serials', {
        url: trimmed,
        shelf_id: shelfId ?? undefined,
        adapter: adapter || undefined,
      })
      if (serial) onSaved(serial)
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(
        apiErr.data?.detail ??
          'Failed to add serial. Check the URL and try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="add-serial-modal"
    >
      <div className="w-full max-w-md bg-black border border-white/10 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="size-7 flex items-center justify-center bg-primary text-white rounded">
              <Scroll size={14} />
            </div>
            <h3 className="text-sm font-black tracking-widest uppercase text-white">
              Add Serial
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
              {error}
            </p>
          )}

          {/* URL */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
              Serial URL <span className="text-red-400">*</span>
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.royalroad.com/fiction/..."
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
              autoFocus
            />
          </div>

          {/* Adapter selector */}
          {adapters && adapters.length > 0 && (
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
                Parser
              </label>
              <select
                value={adapter}
                onChange={(e) => handleAdapterChange(e.target.value)}
                data-testid="adapter-select"
                className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case focus:outline-none focus:border-primary transition-colors"
              >
                <option value="">Auto-detect</option>
                {adapters.map((a) => (
                  <option key={a} value={a}>
                    {a}
                    {a === detectedAdapter ? ' (detected)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Shelf selector */}
          {shelves && shelves.length > 0 && (
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
                Shelf for generated volumes
              </label>
              <select
                value={shelfId ?? ''}
                onChange={(e) =>
                  setShelfId(e.target.value ? Number(e.target.value) : null)
                }
                className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case focus:outline-none focus:border-primary transition-colors"
              >
                <option value="">Default shelf</option>
                {shelves.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-black tracking-widest uppercase text-white/50 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              data-testid="add-serial-submit"
              className="flex items-center gap-2 px-5 py-2.5 text-xs font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <>
                  <span className="size-3 border border-white/40 border-t-white rounded-full animate-spin" />
                  Fetching…
                </>
              ) : (
                <>
                  <Plus size={13} />
                  Add Serial
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
