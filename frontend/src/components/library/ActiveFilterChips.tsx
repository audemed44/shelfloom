import { X } from 'lucide-react'
import type { FilterState, FilterLabels } from '../../types/api'

interface ActiveFilterChipsProps {
  filters: FilterState
  labels: FilterLabels
  onRemove: (
    category: 'genres' | 'tags' | 'seriesIds' | 'authors' | 'formats',
    value: string | number
  ) => void
  onClearAll: () => void
}

interface Chip {
  category: 'genres' | 'tags' | 'seriesIds' | 'authors' | 'formats'
  value: string | number
  label: string
}

export default function ActiveFilterChips({
  filters,
  labels,
  onRemove,
  onClearAll,
}: ActiveFilterChipsProps) {
  const chips: Chip[] = [
    ...filters.genres.map((id) => ({
      category: 'genres' as const,
      value: id,
      label: `Genre: ${labels.genres[id] ?? id}`,
    })),
    ...filters.tags.map((id) => ({
      category: 'tags' as const,
      value: id,
      label: `Tag: ${labels.tags[id] ?? id}`,
    })),
    ...filters.seriesIds.map((id) => ({
      category: 'seriesIds' as const,
      value: id,
      label: `Series: ${labels.series[id] ?? id}`,
    })),
    ...filters.authors.map((name) => ({
      category: 'authors' as const,
      value: name,
      label: `Author: ${name}`,
    })),
    ...filters.formats.map((fmt) => ({
      category: 'formats' as const,
      value: fmt,
      label: `Format: ${fmt.toUpperCase()}`,
    })),
  ]

  if (chips.length === 0) return null

  return (
    <div
      className="flex flex-wrap items-center gap-2 mb-4"
      data-testid="active-filter-chips"
    >
      {filters.mode === 'or' && (
        <span className="text-[10px] font-black tracking-widest uppercase text-white/30 mr-1">
          Or
        </span>
      )}
      {chips.map((chip) => (
        <span
          key={`${chip.category}-${chip.value}`}
          className="flex items-center gap-1 px-2 py-1 bg-primary/15 border border-primary/30 text-[10px] font-black tracking-widest text-primary"
        >
          <span className="normal-case">{chip.label}</span>
          <button
            onClick={() => onRemove(chip.category, chip.value)}
            className="ml-0.5 hover:text-white transition-colors"
            aria-label={`Remove ${chip.label}`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <button
        onClick={onClearAll}
        className="text-[10px] font-black tracking-widest uppercase text-white/40 hover:text-white transition-colors ml-1"
        data-testid="clear-all-filters"
      >
        Clear All
      </button>
    </div>
  )
}
