import { useState } from 'react'
import { X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { Book } from '../../types'

interface Props {
  onClose: () => void
}

export default function CreateManualBookModal({ onClose }: Props) {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [format, setFormat] = useState('physical')
  const [publisher, setPublisher] = useState('')
  const [language, setLanguage] = useState('')
  const [isbn, setIsbn] = useState('')
  const [datePublished, setDatePublished] = useState('')
  const [genre, setGenre] = useState('')
  const [pageCount, setPageCount] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const book = await api.post<Book>('/api/books/manual', {
        title: title.trim(),
        author: author.trim() || null,
        format,
        publisher: publisher.trim() || null,
        language: language.trim() || null,
        isbn: isbn.trim() || null,
        date_published: datePublished.trim() || null,
        genre: genre.trim() || null,
        page_count: pageCount ? parseInt(pageCount, 10) : null,
        description: description.trim() || null,
      })
      if (book) {
        navigate(`/books/${book.id}`)
      }
    } catch (err) {
      const apiErr = err as { data?: { detail?: string } }
      setError(apiErr.data?.detail ?? 'Failed to create book.')
      setSaving(false)
    }
  }

  const inputClass =
    'w-full bg-black border border-white/10 px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-primary normal-case'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] bg-black border border-white/10 flex flex-col"
        onClick={(e) => e.stopPropagation()}
        data-testid="create-manual-book-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/10 shrink-0">
          <h2 className="text-sm font-black tracking-widest uppercase">
            Add Manual Book
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
          id="create-manual-book-form"
          onSubmit={handleSubmit}
          className="overflow-y-auto flex-1 px-8 py-6 space-y-8"
        >
          {/* Section 01 */}
          <section>
            <p className="text-[10px] font-black tracking-widest uppercase text-white/40 border-b border-white/10 pb-2 mb-6">
              01 — Basic Info
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
                  Title <span className="text-primary">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Book title"
                  className={inputClass}
                  data-testid="manual-book-title"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
                  Author
                </label>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Author name"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
                  Type
                </label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-primary"
                  data-testid="manual-book-format"
                >
                  <option value="physical" className="bg-black">
                    Physical Book
                  </option>
                  <option value="visual_novel" className="bg-black">
                    Visual Novel
                  </option>
                </select>
              </div>
            </div>
          </section>

          {/* Section 02 */}
          <section>
            <p className="text-[10px] font-black tracking-widest uppercase text-white/40 border-b border-white/10 pb-2 mb-6">
              02 — Details
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
                  Publisher
                </label>
                <input
                  type="text"
                  value={publisher}
                  onChange={(e) => setPublisher(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
                  Language
                </label>
                <input
                  type="text"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="e.g. en"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
                  ISBN
                </label>
                <input
                  type="text"
                  value={isbn}
                  onChange={(e) => setIsbn(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
                  Published
                </label>
                <input
                  type="text"
                  value={datePublished}
                  onChange={(e) => setDatePublished(e.target.value)}
                  placeholder="e.g. 2024-01-15"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
                  Genre
                </label>
                <input
                  type="text"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
                  Page Count
                </label>
                <input
                  type="number"
                  min="1"
                  value={pageCount}
                  onChange={(e) => setPageCount(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-primary normal-case resize-none"
                />
              </div>
            </div>
          </section>
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
              form="create-manual-book-form"
              disabled={saving || !title.trim()}
              className="px-6 py-2.5 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-40 transition-colors"
              data-testid="create-manual-book-submit"
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
