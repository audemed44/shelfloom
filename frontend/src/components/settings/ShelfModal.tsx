import { useState } from 'react'
import { X, HardDrive, Plus, Save } from 'lucide-react'
import { api } from '../../api/client'
import type { Shelf } from '../../types/api'

interface ShelfModalProps {
  shelf?: Shelf
  onClose: () => void
  onSaved: () => void
}

interface ShelfForm {
  name: string
  path: string
  is_default: boolean
  is_sync_target: boolean
  device_name: string
  auto_organize: boolean
}

export default function ShelfModal({ shelf, onClose, onSaved }: ShelfModalProps) {
  const isEdit = shelf != null
  const [form, setForm] = useState<ShelfForm>({
    name: shelf?.name ?? '',
    path: shelf?.path ?? '',
    is_default: shelf?.is_default ?? false,
    is_sync_target: shelf?.is_sync_target ?? false,
    device_name: shelf?.device_name ?? '',
    auto_organize: shelf?.auto_organize ?? false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }
    if (!form.path.trim()) { setError('Path is required.'); return }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        path: form.path.trim(),
        is_default: form.is_default,
        is_sync_target: form.is_sync_target,
        device_name: form.is_sync_target && form.device_name.trim() ? form.device_name.trim() : null,
        auto_organize: form.auto_organize,
      }
      if (isEdit) {
        await api.patch(`/api/shelves/${shelf.id}`, payload)
      } else {
        await api.post('/api/shelves', payload)
      }
      onSaved()
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to save shelf.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      data-testid="shelf-modal"
    >
      <div className="w-full max-w-lg bg-black border border-white/10 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="size-7 flex items-center justify-center bg-primary text-white rounded">
              <HardDrive size={14} />
            </div>
            <h3 className="text-sm font-black tracking-widest uppercase text-white">
              {isEdit ? 'Edit Shelf' : 'Add Shelf'}
            </h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
              {error}
            </p>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
              Shelf Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g., Main Library"
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Path */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
              Path <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.path}
              onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
              placeholder="e.g., /shelves/library"
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white font-mono normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
            />
            <p className="text-[10px] text-white/30 normal-case">
              Absolute path to the directory containing book files.
            </p>
          </div>

          {/* Toggles */}
          <div className="space-y-3 pt-1">
            <Toggle
              label="Default shelf"
              hint="New uploads go here by default."
              checked={form.is_default}
              onChange={(v) => setForm((f) => ({ ...f, is_default: v }))}
            />
            <Toggle
              label="KOReader sync target"
              hint="KOSync requests will be matched to this shelf."
              checked={form.is_sync_target}
              onChange={(v) => setForm((f) => ({ ...f, is_sync_target: v }))}
            />
            {form.is_sync_target && (
              <div className="ml-7 space-y-1.5">
                <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
                  Device Name
                </label>
                <input
                  type="text"
                  value={form.device_name}
                  onChange={(e) => setForm((f) => ({ ...f, device_name: e.target.value }))}
                  placeholder="e.g., Kobo Clara 2E"
                  className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
                />
              </div>
            )}
            <Toggle
              label="Auto-organize on scan"
              hint="Files are reorganized automatically after each scan."
              checked={form.auto_organize}
              onChange={(v) => setForm((f) => ({ ...f, auto_organize: v }))}
            />
          </div>

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
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 text-xs font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              {isEdit ? <Save size={13} /> : <Plus size={13} />}
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Shelf'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 shrink-0 w-9 h-5 rounded-full transition-colors cursor-pointer ${
          checked ? 'bg-primary' : 'bg-white/10'
        }`}
      >
        <div
          className={`size-3.5 bg-white rounded-full mt-[3px] transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </div>
      <div>
        <p className="text-xs font-black tracking-widest uppercase text-white/70 group-hover:text-white transition-colors">
          {label}
        </p>
        <p className="text-[10px] text-white/30 normal-case mt-0.5">{hint}</p>
      </div>
    </label>
  )
}
