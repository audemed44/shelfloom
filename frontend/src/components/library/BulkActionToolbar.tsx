import { Check, Pencil, X } from 'lucide-react'

interface BulkActionToolbarProps {
  selectedCount: number
  selectableCount: number
  allSelected: boolean
  onToggleSelectAll: () => void
  onEdit: () => void
  onClear: () => void
}

export default function BulkActionToolbar({
  selectedCount,
  allSelected,
  onToggleSelectAll,
  onEdit,
  onClear,
}: BulkActionToolbarProps) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 border-t border-white/10 backdrop-blur-sm"
      data-testid="bulk-toolbar"
    >
      <div className="flex items-center justify-between gap-4 px-4 sm:px-6 lg:px-12 py-3">
        {/* Left: select all + count */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSelectAll}
            className={`size-5 rounded-sm flex items-center justify-center border transition-colors ${
              allSelected
                ? 'bg-primary border-primary'
                : 'border-white/30 hover:border-white/50'
            }`}
            aria-label="Select all on page"
            data-testid="bulk-select-all"
          >
            {allSelected && (
              <Check size={12} strokeWidth={3} className="text-white" />
            )}
          </button>
          <span className="text-[10px] font-black tracking-widest uppercase text-white/60">
            {selectedCount} selected
          </span>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-[10px] font-black tracking-widest uppercase hover:bg-primary/90 transition-colors"
            data-testid="bulk-edit-btn"
          >
            <Pencil size={12} />
            Edit
          </button>
          <button
            onClick={onClear}
            className="flex items-center gap-2 px-4 py-2 border border-white/10 text-white/40 text-[10px] font-black tracking-widest uppercase hover:text-white hover:border-white/30 transition-colors"
            data-testid="bulk-clear-btn"
          >
            <X size={12} />
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}
