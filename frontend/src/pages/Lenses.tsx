import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import LensCard from '../components/lenses/LensCard'
import SaveLensModal from '../components/lenses/SaveLensModal'
import type { Lens } from '../types/api'

export default function Lenses() {
  const navigate = useNavigate()
  const [rev, setRev] = useState(0)
  const lensesPath = useMemo(() => `/api/lenses?_rev=${rev}`, [rev])
  const { data: lenses } = useApi<Lens[]>(lensesPath)
  const [editingLens, setEditingLens] = useState<Lens | null>(null)

  const handleDelete = async (lens: Lens) => {
    if (!confirm(`Delete "${lens.name}"?`)) return
    await api.delete(`/api/lenses/${lens.id}`)
    setRev((r) => r + 1)
  }

  const handleSaved = () => {
    setEditingLens(null)
    setRev((r) => r + 1)
  }

  return (
    <div className="p-4 sm:p-6 lg:p-12">
      {/* Header */}
      <header className="mb-6 sm:mb-8 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-4xl sm:text-6xl font-black tracking-tighter text-white">
            Lenses
          </h2>
          <p className="text-white/40 text-base font-medium mt-2 normal-case">
            Saved filter presets
          </p>
        </div>
        <button
          onClick={() =>
            navigate('/library', { state: { openSaveLens: true } })
          }
          className="flex items-center gap-2 px-5 py-3 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/90 transition-colors"
          data-testid="new-lens-btn"
        >
          <Plus size={14} />
          New Lens
        </button>
      </header>

      {/* Grid */}
      {lenses && lenses.length > 0 ? (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6"
          data-testid="lenses-grid"
        >
          {lenses.map((lens) => (
            <LensCard
              key={lens.id}
              lens={lens}
              onEdit={setEditingLens}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : lenses ? (
        <div
          className="flex flex-col items-center justify-center py-24 text-center"
          data-testid="lenses-empty"
        >
          <p className="font-black tracking-widest text-white/30">
            No Lenses Yet
          </p>
          <p className="text-xs text-white/20 mt-1 normal-case">
            Go to Library, set your filters, and tap &ldquo;Save as Lens&rdquo;
          </p>
        </div>
      ) : null}

      {/* Edit modal */}
      {editingLens && (
        <SaveLensModal
          existingLens={editingLens}
          filterState={editingLens.filter_state}
          onClose={() => setEditingLens(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
