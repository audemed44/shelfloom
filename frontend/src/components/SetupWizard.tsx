import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  HardDrive,
  FolderOpen,
  ChevronRight,
  CheckCircle2,
  Loader2,
  BookOpen,
  Settings,
  Play,
  SkipForward,
} from 'lucide-react'
import { api } from '../api/client'
import type { ScanStatus } from '../types/api'
import DirPicker from './settings/DirPicker'

// ── types ──────────────────────────────────────────────────────────────────────

interface ShelfForm {
  name: string
  path: string
}

interface SyncShelfForm {
  name: string
  path: string
  device_name: string
}

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = ['Default Shelf', 'Sync Shelf', 'Template', 'Initial Scan']

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-10">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={`size-7 flex items-center justify-center text-[10px] font-black tracking-widest transition-colors ${
                i < current
                  ? 'bg-primary/20 text-primary border border-primary/40'
                  : i === current
                    ? 'bg-primary text-white'
                    : 'bg-white/5 text-white/20 border border-white/10'
              }`}
            >
              {i < current ? <CheckCircle2 size={12} /> : i + 1}
            </div>
            <span
              className={`text-[9px] font-black tracking-widest uppercase hidden sm:block ${
                i === current ? 'text-white/60' : 'text-white/20'
              }`}
            >
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`h-px w-8 sm:w-16 mx-1 mb-5 transition-colors ${
                i < current ? 'bg-primary/40' : 'bg-white/10'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Step 1 — Default shelf ─────────────────────────────────────────────────────

function Step1({
  form,
  onChange,
  onNext,
  saving,
  error,
}: {
  form: ShelfForm
  onChange: (f: ShelfForm) => void
  onNext: () => void
  saving: boolean
  error: string | null
}) {
  const [showPicker, setShowPicker] = useState(false)

  return (
    <div data-testid="wizard-step-1">
      <div className="flex items-center gap-3 mb-6">
        <div className="size-8 flex items-center justify-center bg-primary text-white">
          <HardDrive size={15} />
        </div>
        <div>
          <h2 className="text-sm font-black uppercase tracking-tight text-white">
            Create your default shelf
          </h2>
          <p className="text-[11px] text-white/40 normal-case mt-0.5">
            Point Shelfloom at the folder where your books live.
          </p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 mb-4 normal-case">
          {error}
        </p>
      )}

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
            Shelf Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            placeholder="e.g., Library"
            data-testid="wizard-shelf-name"
            className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
            Path <span className="text-red-400">*</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={form.path}
              onChange={(e) => onChange({ ...form, path: e.target.value })}
              placeholder="/shelves/library"
              data-testid="wizard-shelf-path"
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
        </div>
      </div>

      <div className="flex justify-end mt-8">
        <button
          onClick={onNext}
          disabled={saving || !form.name.trim() || !form.path.trim()}
          data-testid="wizard-next-btn"
          className="flex items-center gap-2 px-6 py-3 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-40 transition-colors"
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ChevronRight size={13} />
          )}
          {saving ? 'Creating…' : 'Next'}
        </button>
      </div>

      {showPicker && (
        <DirPicker
          initialPath={form.path || undefined}
          onSelect={(p) => {
            onChange({ ...form, path: p })
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}

// ── Step 2 — Sync shelf (optional) ────────────────────────────────────────────

function Step2({
  form,
  onChange,
  onNext,
  onSkip,
  saving,
  error,
}: {
  form: SyncShelfForm
  onChange: (f: SyncShelfForm) => void
  onNext: () => void
  onSkip: () => void
  saving: boolean
  error: string | null
}) {
  const [showPicker, setShowPicker] = useState(false)

  const canSubmit = form.name.trim() && form.path.trim()

  return (
    <div data-testid="wizard-step-2">
      <div className="flex items-center gap-3 mb-6">
        <div className="size-8 flex items-center justify-center bg-white/5 border border-white/10 text-white/40">
          <HardDrive size={15} />
        </div>
        <div>
          <h2 className="text-sm font-black uppercase tracking-tight text-white">
            Add a KOReader sync shelf
          </h2>
          <p className="text-[11px] text-white/40 normal-case mt-0.5">
            Optional — point at the folder KOReader reads from (e.g., your Kobo
            SD card).
          </p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 mb-4 normal-case">
          {error}
        </p>
      )}

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
            Shelf Name
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            placeholder="e.g., Kobo"
            data-testid="wizard-sync-name"
            className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
            Path
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={form.path}
              onChange={(e) => onChange({ ...form, path: e.target.value })}
              placeholder="/media/kobo/books"
              data-testid="wizard-sync-path"
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
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
            Device name
          </label>
          <input
            type="text"
            value={form.device_name}
            onChange={(e) => onChange({ ...form, device_name: e.target.value })}
            placeholder="e.g., Kobo Clara 2E"
            data-testid="wizard-sync-device"
            className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      <div className="flex justify-between mt-8">
        <button
          onClick={onSkip}
          data-testid="wizard-skip-btn"
          className="flex items-center gap-2 px-4 py-2.5 text-[10px] font-black tracking-widest uppercase text-white/30 hover:text-white/60 transition-colors"
        >
          <SkipForward size={13} />
          Skip
        </button>
        <button
          onClick={onNext}
          disabled={saving || !canSubmit}
          data-testid="wizard-next-btn"
          className="flex items-center gap-2 px-6 py-3 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-40 transition-colors"
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ChevronRight size={13} />
          )}
          {saving ? 'Creating…' : 'Next'}
        </button>
      </div>

      {showPicker && (
        <DirPicker
          initialPath={form.path || undefined}
          onSelect={(p) => {
            onChange({ ...form, path: p })
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}

// ── Step 3 — Template ──────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE = '{author}/{series_path}/{sequence| - }{title}'

function computeExamplePath(template: string): string {
  const examples: Record<string, string> = {
    author: 'Brandon Sanderson',
    title: 'The Way of Kings',
    series_path: 'Cosmere/Stormlight Archive',
    sequence: '01',
  }
  let result = template
  result = result.replace(
    /\{sequence\|([^}]*)\}/g,
    (_, suffix) => `01${suffix}`
  )
  result = result.replace(
    /\{(\w+)(?::[^}]*)?\}/g,
    (_, token) => examples[token] ?? `{${token}}`
  )
  return result + '.epub'
}

function Step3({
  template,
  onChange,
  onNext,
}: {
  template: string
  onChange: (t: string) => void
  onNext: () => void
}) {
  return (
    <div data-testid="wizard-step-3">
      <div className="flex items-center gap-3 mb-6">
        <div className="size-8 flex items-center justify-center bg-white/5 border border-white/10 text-white/40">
          <Settings size={15} />
        </div>
        <div>
          <h2 className="text-sm font-black uppercase tracking-tight text-white">
            File organisation template
          </h2>
          <p className="text-[11px] text-white/40 normal-case mt-0.5">
            How Shelfloom names and folders your book files. You can change this
            later.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
            Path Template
          </label>
          <input
            type="text"
            value={template}
            onChange={(e) => onChange(e.target.value)}
            data-testid="wizard-template-input"
            className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white font-mono normal-case focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        <div className="p-4 border border-white/5 bg-white/[0.02]">
          <p className="text-[10px] font-black tracking-widest uppercase text-white/30 mb-2">
            Example path
          </p>
          <p
            className="text-xs text-primary font-mono normal-case break-all"
            data-testid="wizard-example-path"
          >
            {computeExamplePath(template)}
          </p>
        </div>

        <p className="text-[10px] text-white/30 normal-case">
          Tokens: <code className="text-primary/80">{'{author}'}</code>{' '}
          <code className="text-primary/80">{'{title}'}</code>{' '}
          <code className="text-primary/80">{'{series_path}'}</code>{' '}
          <code className="text-primary/80">{'{sequence}'}</code>
          {' — or '}
          <code className="text-primary/80">{'{sequence| - }'}</code>
          {' for conditional separator.'}
        </p>
      </div>

      <div className="flex justify-end mt-8">
        <button
          onClick={onNext}
          data-testid="wizard-next-btn"
          className="flex items-center gap-2 px-6 py-3 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 transition-colors"
        >
          <Play size={13} />
          Start Scan
        </button>
      </div>
    </div>
  )
}

// ── Step 4 — Scan progress ────────────────────────────────────────────────────

function Step4({ onDone }: { onDone: () => void }) {
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)
  const [scanStarted, setScanStarted] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => {
    const startScan = async () => {
      try {
        await api.post('/api/import/scan', {})
        setScanStarted(true)
        // Immediate first check so UI reflects completion without waiting for the interval
        const initial = await api.get<ScanStatus>('/api/import/status')
        if (initial) {
          setScanStatus(initial)
          if (!initial.is_running) return
        }
        pollRef.current = setInterval(async () => {
          const s = await api.get<ScanStatus>('/api/import/status')
          if (s) {
            setScanStatus(s)
            if (!s.is_running) {
              stopPoll()
            }
          }
        }, 1500)
      } catch (err) {
        const apiErr = err as { data?: { detail?: string } }
        setScanError(apiErr.data?.detail ?? 'Failed to start scan.')
      }
    }
    startScan()
    return stopPoll
  }, [stopPoll])

  const done = scanStarted && scanStatus != null && !scanStatus.is_running

  return (
    <div data-testid="wizard-step-4">
      <div className="flex items-center gap-3 mb-6">
        <div className="size-8 flex items-center justify-center bg-white/5 border border-white/10 text-white/40">
          <BookOpen size={15} />
        </div>
        <div>
          <h2 className="text-sm font-black uppercase tracking-tight text-white">
            {done ? 'Scan complete' : 'Scanning your library…'}
          </h2>
          <p className="text-[11px] text-white/40 normal-case mt-0.5">
            {done
              ? `${scanStatus?.progress?.created ?? 0} books imported.`
              : 'Discovering and importing book files.'}
          </p>
        </div>
      </div>

      {scanError ? (
        <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
          {scanError}
        </p>
      ) : (
        <div className="space-y-4" data-testid="wizard-scan-status">
          {/* Progress bar */}
          <div className="h-1 bg-white/10 w-full overflow-hidden">
            <div
              className={`h-full bg-primary transition-all duration-500 ${done ? 'w-full' : ''}`}
              style={
                !done && scanStatus?.progress && scanStatus.progress.total > 0
                  ? {
                      width: `${Math.round(
                        (scanStatus.progress.processed /
                          scanStatus.progress.total) *
                          100
                      )}%`,
                    }
                  : done
                    ? undefined
                    : { width: '0%' }
              }
            />
          </div>

          {scanStatus?.progress && (
            <div className="flex items-center gap-4 text-[10px] text-white/40 normal-case">
              <span>
                {scanStatus.progress.processed} / {scanStatus.progress.total}{' '}
                files
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
          )}

          {!scanStarted && !scanError && (
            <div className="flex items-center gap-2 text-xs text-white/30 normal-case">
              <Loader2 size={12} className="animate-spin" />
              Starting scan…
            </div>
          )}

          {scanStatus?.is_running && (
            <div className="flex items-center gap-2 text-xs text-white/30 normal-case">
              <Loader2 size={12} className="animate-spin" />
              Scanning…
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end mt-8">
        <button
          onClick={onDone}
          disabled={!done && !scanError}
          data-testid="wizard-finish-btn"
          className="flex items-center gap-2 px-6 py-3 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-40 transition-colors"
        >
          <CheckCircle2 size={13} />
          Go to Library
        </button>
      </div>
    </div>
  )
}

// ── Main wizard component ─────────────────────────────────────────────────────

interface SetupWizardProps {
  onComplete: () => void
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)

  const [defaultShelf, setDefaultShelf] = useState<ShelfForm>({
    name: '',
    path: '',
  })
  const [syncShelf, setSyncShelf] = useState<SyncShelfForm>({
    name: '',
    path: '',
    device_name: '',
  })
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreateDefaultShelf = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.post('/api/shelves', {
        name: defaultShelf.name.trim(),
        path: defaultShelf.path.trim(),
        is_default: true,
        is_sync_target: false,
        device_name: null,
        auto_organize: false,
        organize_template: template,
        seq_pad: 2,
      })
      setStep(1)
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to create shelf.')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateSyncShelf = async () => {
    if (!syncShelf.name.trim() || !syncShelf.path.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.post('/api/shelves', {
        name: syncShelf.name.trim(),
        path: syncShelf.path.trim(),
        is_default: false,
        is_sync_target: true,
        device_name: syncShelf.device_name.trim() || null,
        auto_organize: false,
        organize_template: null,
        seq_pad: 2,
      })
      setStep(2)
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to create sync shelf.')
    } finally {
      setSaving(false)
    }
  }

  const handleDone = () => {
    onComplete()
    navigate('/library')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black p-4 overflow-y-auto"
      data-testid="setup-wizard"
    >
      <div className="w-full max-w-lg my-auto">
        {/* Branding */}
        <div className="mb-8">
          <p className="text-[10px] font-black tracking-[0.3em] uppercase text-white/20 mb-1">
            Welcome to
          </p>
          <h1 className="text-3xl font-black tracking-tighter uppercase text-white">
            Shelfloom
          </h1>
        </div>

        <StepIndicator current={step} />

        <div className="border border-white/10 bg-white/[0.02] p-6">
          {step === 0 && (
            <Step1
              form={defaultShelf}
              onChange={setDefaultShelf}
              onNext={handleCreateDefaultShelf}
              saving={saving}
              error={error}
            />
          )}
          {step === 1 && (
            <Step2
              form={syncShelf}
              onChange={setSyncShelf}
              onNext={handleCreateSyncShelf}
              onSkip={() => {
                setError(null)
                setStep(2)
              }}
              saving={saving}
              error={error}
            />
          )}
          {step === 2 && (
            <Step3
              template={template}
              onChange={setTemplate}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && <Step4 onDone={handleDone} />}
        </div>
      </div>
    </div>
  )
}
