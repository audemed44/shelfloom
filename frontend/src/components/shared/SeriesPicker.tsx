import { useState, useEffect, useRef } from 'react'
import { Search, Plus } from 'lucide-react'
import { api } from '../../api/client'
import type { SeriesWithCount } from '../../types/api'
import CreateSeriesModal from './CreateSeriesModal'

interface SeriesPickerProps {
  value: number | null
  onChange: (seriesId: number | null) => void
}

export default function SeriesPicker({ value, onChange }: SeriesPickerProps) {
  const [allSeries, setAllSeries] = useState<SeriesWithCount[]>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get<SeriesWithCount[]>('/api/series/tree').then((data) => {
      if (Array.isArray(data)) setAllSeries(data)
    })
  }, [])

  // Keep search text in sync with selected series name
  const selected = allSeries.find((s) => s.id === value)

  const filtered = allSeries.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleSelect = (s: SeriesWithCount | null) => {
    if (s) {
      onChange(s.id)
      setSearch(s.name)
    } else {
      onChange(null)
      setSearch('')
    }
    setOpen(false)
  }

  const handleCreated = (newSeries: SeriesWithCount) => {
    setAllSeries((prev) => [...prev, newSeries])
    setShowCreate(false)
    onChange(newSeries.id)
    setSearch(newSeries.name)
  }

  return (
    <div>
      <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1.5">
        Series
      </label>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
          />
          <input
            ref={inputRef}
            type="text"
            value={open ? search : (selected?.name ?? search)}
            onChange={(e) => {
              setSearch(e.target.value)
              setOpen(true)
              if (!e.target.value) onChange(null)
            }}
            onFocus={() => {
              setSearch(selected?.name ?? '')
              setOpen(true)
            }}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search series…"
            className="w-full bg-black border border-white/10 pl-9 pr-3 py-3 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary transition-colors"
          />

          {open && (
            <div className="absolute z-10 w-full border border-white/10 bg-black mt-0.5 max-h-40 overflow-y-auto">
              <button
                type="button"
                onMouseDown={() => handleSelect(null)}
                className="w-full text-left px-4 py-2.5 text-sm text-white/40 hover:bg-white/5 hover:text-white transition-colors"
              >
                — None —
              </button>
              {filtered.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onMouseDown={() => handleSelect(s)}
                  className={`w-full text-left px-4 py-2.5 text-sm normal-case transition-colors flex items-center justify-between ${
                    value === s.id
                      ? 'bg-primary/20 text-white'
                      : 'text-white/70 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span>{s.name}</span>
                  <span className="text-[10px] text-white/30">
                    {s.book_count} books
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-4 py-2.5 text-sm text-white/30 normal-case">
                  No series found.
                </p>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          title="Create new series"
          className="shrink-0 size-[46px] border border-white/10 flex items-center justify-center text-white/30 hover:bg-primary hover:border-primary hover:text-white transition-all"
        >
          <Plus size={16} />
        </button>
      </div>

      {value && selected && (
        <p className="text-[10px] text-primary tracking-widest uppercase font-black mt-1.5">
          ✓ {selected.name} selected
        </p>
      )}

      {showCreate && (
        <CreateSeriesModal
          allSeries={allSeries}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
