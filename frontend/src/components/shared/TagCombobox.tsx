import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { X, Plus } from 'lucide-react'
import { api } from '../../api/client'
import type { Tag } from '../../types/api'

interface TagComboboxProps {
  value: Tag[]
  onChange: (tags: Tag[]) => void
  label?: string
}

export default function TagCombobox({
  value,
  onChange,
  label = 'Tags',
}: TagComboboxProps) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get<Tag[]>('/api/tags').then((data) => {
      if (Array.isArray(data)) setAllTags(data)
    })
  }, [])

  const assignedIds = useMemo(() => new Set(value.map((t) => t.id)), [value])
  const suggestions = allTags.filter(
    (t) =>
      t.name.toLowerCase().includes(input.toLowerCase()) &&
      !assignedIds.has(t.id)
  )
  const trimmed = input.trim()
  const showAddNew =
    trimmed.length > 0 &&
    !allTags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())

  const addTag = useCallback(
    (tag: Tag) => {
      if (assignedIds.has(tag.id)) return
      onChange([...value, tag].sort((a, b) => a.name.localeCompare(b.name)))
      setAllTags((prev) =>
        prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]
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
        const created = await api.post<Tag>('/api/tags', { name })
        if (created) addTag(created)
      } catch {
        const existing = allTags.find(
          (t) => t.name.toLowerCase() === name.toLowerCase()
        )
        if (existing) addTag(existing)
      } finally {
        setBusy(false)
      }
    },
    [addTag, allTags]
  )

  const removeTag = useCallback(
    (tag: Tag) => {
      onChange(value.filter((t) => t.id !== tag.id))
    },
    [value, onChange]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions.length > 0 && !showAddNew) {
        addTag(suggestions[0])
      } else if (trimmed) {
        createAndAdd(trimmed)
      }
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div>
      <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1.5">
        {label}
      </label>

      <div
        className={`flex flex-wrap gap-1.5 min-h-[46px] bg-black border border-white/10 px-3 py-2 focus-within:border-primary transition-colors cursor-text ${busy ? 'opacity-60 pointer-events-none' : ''}`}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((t) => (
          <span
            key={t.id}
            className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/15 border border-amber-500/30 text-[10px] font-black tracking-widest text-amber-400 normal-case"
          >
            {t.name}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeTag(t)
              }}
              className="text-amber-400/60 hover:text-amber-400 transition-colors"
              aria-label={`Remove ${t.name}`}
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
          placeholder={value.length === 0 ? 'Type to search or add...' : ''}
          className="flex-1 min-w-[120px] bg-transparent text-sm text-white placeholder:text-white/20 focus:outline-none normal-case"
        />
      </div>

      {open && input.length > 0 && (suggestions.length > 0 || showAddNew) && (
        <div className="border border-white/10 border-t-0 bg-black max-h-40 overflow-y-auto">
          {suggestions.map((t) => (
            <button
              key={t.id}
              type="button"
              onMouseDown={() => addTag(t)}
              className="w-full text-left px-4 py-2.5 text-sm text-white/70 normal-case hover:bg-white/5 hover:text-white transition-colors"
            >
              {t.name}
            </button>
          ))}
          {showAddNew && (
            <button
              type="button"
              onMouseDown={() => createAndAdd(trimmed)}
              className="w-full text-left px-4 py-2.5 text-sm text-white/50 normal-case hover:bg-white/5 hover:text-white/80 transition-colors flex items-center gap-2"
            >
              <Plus size={12} className="text-amber-400 shrink-0" />
              Add &ldquo;{trimmed}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  )
}
