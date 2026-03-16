import { useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../../api/client'

interface Props {
  bookId: string
  onClose: () => void
  onSaved: () => void
}

export default function LogSessionModal({ bookId, onClose, onSaved }: Props) {
  const now = new Date()
  // Default to current local datetime-local value
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)

  const [startTime, setStartTime] = useState(localIso)
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [pagesRead, setPagesRead] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalSeconds =
    parseInt(hours || '0', 10) * 3600 + parseInt(minutes || '0', 10) * 60

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!startTime) {
      setError('Date and time is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.post(`/api/books/${bookId}/sessions`, {
        start_time: new Date(startTime).toISOString(),
        duration: totalSeconds > 0 ? totalSeconds : null,
        pages_read: pagesRead ? parseInt(pagesRead, 10) : null,
      })
      onSaved()
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to log session.')
      setSaving(false)
    }
  }

  const inputClass =
    'w-full bg-black border border-white/10 px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-primary'

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-black border border-white/10 flex flex-col"
        onClick={(e) => e.stopPropagation()}
        data-testid="log-session-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/10 shrink-0">
          <h2 className="text-sm font-black tracking-widest uppercase">
            Log Reading Session
          </h2>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form
          id="log-session-form"
          onSubmit={handleSubmit}
          className="px-8 py-6 space-y-5"
        >
          <div>
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
              Date &amp; Time <span className="text-primary">*</span>
            </label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputClass}
              data-testid="session-start-time"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
              Duration
            </label>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="number"
                  min="0"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="0"
                  className={inputClass}
                  data-testid="session-hours"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black tracking-widest text-white/30">
                  HRS
                </span>
              </div>
              <div className="flex-1 relative">
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  placeholder="0"
                  className={inputClass}
                  data-testid="session-minutes"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black tracking-widest text-white/30">
                  MIN
                </span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
              Pages Read
            </label>
            <input
              type="number"
              min="0"
              value={pagesRead}
              onChange={(e) => setPagesRead(e.target.value)}
              placeholder="Optional"
              className={inputClass}
              data-testid="session-pages"
            />
          </div>
        </form>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-white/10 shrink-0 flex items-center justify-between gap-4">
          {error ? (
            <p className="text-xs text-red-400 normal-case">{error}</p>
          ) : (
            <span />
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 text-[10px] font-black tracking-widest uppercase border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="log-session-form"
              disabled={saving || !startTime}
              className="px-6 py-2.5 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-40 transition-colors"
              data-testid="log-session-submit"
            >
              {saving ? 'Saving…' : 'Log Session'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
