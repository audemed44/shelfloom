import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { X, Plus } from 'lucide-react'
import { api } from '../../api/client'
import type { Genre } from '../../types/api'

interface GenreComboboxProps {
  value: Genre[]
  onChange: (genres: Genre[]) => void
}

export default function GenreCombobox({ value, onChange }: GenreComboboxProps) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [allGenres, setAllGenres] = useState<Genre[]>([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get<Genre[]>('/api/genres').then((data) => {
      if (Array.isArray(data)) setAllGenres(data)
    })
  }, [])

  const assignedIds = useMemo(() => new Set(value.map((g) => g.id)), [value])
  const suggestions = allGenres.filter(
    (g) =>
      g.name.toLowerCase().includes(input.toLowerCase()) &&
      !assignedIds.has(g.id)
  )
  const trimmed = input.trim()
  const showAddNew =
    trimmed.length > 0 &&
    !allGenres.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())

  const addGenre = useCallback(
    (genre: Genre) => {
      if (assignedIds.has(genre.id)) return
      onChange([...value, genre].sort((a, b) => a.name.localeCompare(b.name)))
      setAllGenres((prev) =>
        prev.some((g) => g.id === genre.id) ? prev : [...prev, genre]
      )
      setInput('')
      setOpen(false)
      inputRef.current?.focus()
    },
    [value, onChange, assignedIds]
  )

  const createAndAdd = useCallback(
    async (name: string) => {
      setBusy(true)
      try {
        const created = await api.post<Genre>('/api/genres', { name })
        if (created) addGenre(created)
      } catch {
        const existing = allGenres.find(
          (g) => g.name.toLowerCase() === name.toLowerCase()
        )
        if (existing) addGenre(existing)
      } finally {
        setBusy(false)
      }
    },
    [addGenre, allGenres]
  )

  const removeGenre = useCallback(
    (genre: Genre) => {
      onChange(value.filter((g) => g.id !== genre.id))
    },
    [value, onChange]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions.length > 0 && !showAddNew) {
        addGenre(suggestions[0])
      } else if (trimmed) {
        createAndAdd(trimmed)
      }
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeGenre(value[value.length - 1])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div>
      <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1.5">
        Genres
      </label>

      <div
        className={`flex flex-wrap gap-1.5 min-h-[46px] bg-black border border-white/10 px-3 py-2 focus-within:border-primary transition-colors cursor-text ${busy ? 'opacity-60 pointer-events-none' : ''}`}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((g) => (
          <span
            key={g.id}
            className="flex items-center gap-1 px-2 py-0.5 bg-primary/15 border border-primary/30 text-[10px] font-black tracking-widest text-primary normal-case"
          >
            {g.name}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeGenre(g)
              }}
              className="text-primary/60 hover:text-primary transition-colors"
              aria-label={`Remove ${g.name}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? 'Type to search or add…' : ''}
          className="flex-1 min-w-[120px] bg-transparent text-sm text-white placeholder:text-white/20 focus:outline-none normal-case"
        />
      </div>

      {open && input.length > 0 && (suggestions.length > 0 || showAddNew) && (
        <div className="border border-white/10 border-t-0 bg-black max-h-40 overflow-y-auto">
          {suggestions.map((g) => (
            <button
              key={g.id}
              type="button"
              onMouseDown={() => addGenre(g)}
              className="w-full text-left px-4 py-2.5 text-sm text-white/70 normal-case hover:bg-white/5 hover:text-white transition-colors"
            >
              {g.name}
            </button>
          ))}
          {showAddNew && (
            <button
              type="button"
              onMouseDown={() => createAndAdd(trimmed)}
              className="w-full text-left px-4 py-2.5 text-sm text-white/50 normal-case hover:bg-white/5 hover:text-white/80 transition-colors flex items-center gap-2"
            >
              <Plus size={12} className="text-primary shrink-0" />
              Add &ldquo;{trimmed}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  )
}
