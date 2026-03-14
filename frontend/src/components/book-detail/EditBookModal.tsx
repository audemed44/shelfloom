import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { api } from '../../api/client'
import type { BookDetail } from '../../types'

interface EditBookModalProps {
  book: BookDetail
  onClose: () => void
  onSaved: (book: BookDetail) => void
}

interface EditForm {
  title: string
  author: string
  publisher: string
  language: string
  isbn: string
  date_published: string
  description: string
}

interface FieldProps {
  label: string
  name: keyof EditForm
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  required?: boolean
  placeholder?: string
}

export default function EditBookModal({ book, onClose, onSaved }: EditBookModalProps) {
  const [form, setForm] = useState<EditForm>({
    title: book.title ?? '',
    author: book.author ?? '',
    publisher: book.publisher ?? '',
    language: book.language ?? '',
    isbn: book.isbn ?? '',
    date_published: book.date_published ?? '',
    description: book.description ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload: Partial<EditForm> = {}
      for (const [k, v] of Object.entries(form)) {
        if (v !== '') payload[k as keyof EditForm] = v
      }
      const updated = await api.patch<BookDetail>(`/api/books/${book.id}`, payload)
      onSaved(updated!)
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg bg-black border border-white/10 rounded-lg shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-sm font-black tracking-widest uppercase text-white">Edit Book</h2>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-white/40 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <p className="text-xs text-red-400 border border-red-400/30 bg-red-400/10 rounded px-3 py-2">
              {error}
            </p>
          )}

          <Field label="Title" name="title" value={form.title} onChange={handleChange} required />
          <Field label="Author" name="author" value={form.author} onChange={handleChange} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Publisher" name="publisher" value={form.publisher} onChange={handleChange} />
            <Field label="Language" name="language" value={form.language} onChange={handleChange} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="ISBN" name="isbn" value={form.isbn} onChange={handleChange} />
            <Field label="Published" name="date_published" value={form.date_published} onChange={handleChange} placeholder="e.g. 2010" />
          </div>
          <div>
            <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1">
              Description
            </label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={4}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary normal-case resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-black tracking-widest uppercase border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, name, value, onChange, required, placeholder }: FieldProps) {
  return (
    <div>
      <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1">
        {label}
      </label>
      <input
        type="text"
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary normal-case"
      />
    </div>
  )
}
