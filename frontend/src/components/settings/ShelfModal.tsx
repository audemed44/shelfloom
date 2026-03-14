import { useState } from 'react'
import { X, HardDrive, Plus, Save, FolderOpen } from 'lucide-react'
import { api } from '../../api/client'
import type { Shelf } from '../../types/api'
import DirPicker from './DirPicker'

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
  organize_template: string
  seq_pad: number
}

export default function ShelfModal({
  shelf,
  onClose,
  onSaved,
}: ShelfModalProps) {
  const isEdit = shelf != null
  const [form, setForm] = useState<ShelfForm>({
    name: shelf?.name ?? '',
    path: shelf?.path ?? '',
    is_default: shelf?.is_default ?? false,
    is_sync_target: shelf?.is_sync_target ?? false,
    device_name: shelf?.device_name ?? '',
    auto_organize: shelf?.auto_organize ?? false,
    organize_template:
      shelf?.organize_template ??
      '{author}/{series_path}/{sequence| - }{title}',
    seq_pad: shelf?.seq_pad ?? 2,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    if (!form.path.trim()) {
      setError('Path is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        path: form.path.trim(),
        is_default: form.is_default,
        is_sync_target: form.is_sync_target,
        device_name:
          form.is_sync_target && form.device_name.trim()
            ? form.device_name.trim()
            : null,
        auto_organize: form.auto_organize,
        organize_template:
          form.auto_organize && form.organize_template.trim()
            ? form.organize_template.trim()
            : null,
        seq_pad: form.seq_pad,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="shelf-modal"
    >
      <div className="w-full max-w-lg bg-black border border-white/10 shadow-2xl flex flex-col max-h-[calc(100vh-2rem)] my-auto">
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
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
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
            <div className="flex gap-2">
              <input
                type="text"
                value={form.path}
                onChange={(e) =>
                  setForm((f) => ({ ...f, path: e.target.value }))
                }
                placeholder="e.g., /shelves/library"
                className="flex-1 bg-black border border-white/10 px-4 py-3 text-sm text-white font-mono normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-colors"
                title="Browse"
              >
                <FolderOpen size={14} />
              </button>
            </div>
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
                  onChange={(e) =>
                    setForm((f) => ({ ...f, device_name: e.target.value }))
                  }
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
            {form.auto_organize && (
              <div className="ml-7 space-y-4 pt-1">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
                    Path Template
                  </label>
                  <input
                    type="text"
                    value={form.organize_template}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        organize_template: e.target.value,
                      }))
                    }
                    placeholder="{author}/{series_path}/{sequence| - }{title}"
                    className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white font-mono normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
                  />
                  <p className="text-[10px] text-white/30 normal-case">
                    Tokens:{' '}
                    <code className="text-primary/80">{'{author}'}</code>{' '}
                    <code className="text-primary/80">{'{title}'}</code>{' '}
                    <code className="text-primary/80">{'{series_path}'}</code>{' '}
                    <code className="text-primary/80">{'{sequence}'}</code>
                    {' — or '}
                    <code className="text-primary/80">{'{sequence| - }'}</code>
                    {
                      ' to include the separator only when a sequence exists. Format (epub/pdf) is always appended automatically.'
                    }
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
                    Sequence Padding
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={form.seq_pad}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        seq_pad: parseInt(e.target.value, 10) || 2,
                      }))
                    }
                    className="w-20 bg-black border border-white/10 px-4 py-3 text-sm text-white text-center focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
              </div>
            )}
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
      {showPicker && (
        <DirPicker
          initialPath={form.path || undefined}
          onSelect={(p) => {
            setForm((f) => ({ ...f, path: p }))
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
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
