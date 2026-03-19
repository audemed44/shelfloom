import { useState } from 'react'
import { PlusCircle } from 'lucide-react'
import { useApi } from '../hooks/useApi'
import SerialCard from '../components/serials/SerialCard'
import AddSerialModal from '../components/serials/AddSerialModal'
import type { WebSerial } from '../types/api'

type StatusFilter = 'all' | 'ongoing' | 'completed' | 'paused' | 'error'

const FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Ongoing', value: 'ongoing' },
  { label: 'Completed', value: 'completed' },
  { label: 'Paused', value: 'paused' },
  { label: 'Error', value: 'error' },
]

export default function Serials() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [showAdd, setShowAdd] = useState(false)

  const { data: serials, loading } = useApi<WebSerial[]>(
    `/api/serials?_k=${refreshKey}`
  )

  const visible = (serials ?? []).filter(
    (s) => filter === 'all' || s.status === filter
  )

  return (
    <div className="p-4 sm:p-6 lg:p-12">
      {/* Header */}
      <header className="mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-4xl sm:text-6xl font-black tracking-tighter text-white">
              Serials
            </h1>
            <p className="text-white/40 text-base sm:text-lg font-medium mt-2 normal-case">
              {serials && serials.length > 0
                ? `${serials.length} ${serials.length === 1 ? 'serial' : 'serials'} tracked`
                : 'Track and generate EPUBs from web serials'}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            data-testid="add-serial-btn"
            className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm font-semibold bg-primary text-white hover:bg-primary/80 rounded-lg transition-colors normal-case sm:mt-2 sm:shrink-0"
          >
            <PlusCircle size={16} />
            Add Serial
          </button>
        </div>
      </header>

      {/* Status filter tabs */}
      <div
        className="flex gap-1 mb-6 flex-wrap"
        data-testid="status-filter-tabs"
      >
        {FILTERS.map(({ label, value }) => {
          const count =
            value === 'all'
              ? (serials ?? []).length
              : (serials ?? []).filter((s) => s.status === value).length
          return (
            <button
              key={value}
              onClick={() => setFilter(value)}
              data-testid={`filter-${value}`}
              className={`px-3 py-1.5 text-[10px] font-black tracking-widest uppercase transition-colors ${
                filter === value
                  ? 'bg-primary text-white'
                  : 'border border-white/10 text-white/40 hover:text-white hover:border-white/30'
              }`}
            >
              {label}
              {count > 0 && <span className="ml-1.5 opacity-60">{count}</span>}
            </button>
          )
        })}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-[2/3] bg-white/5 border border-white/5" />
              <div className="mt-2 h-3 bg-white/5 w-3/4" />
              <div className="mt-1 h-2 bg-white/5 w-1/2" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div
          className="border border-white/10 py-20 text-center"
          data-testid="empty-state"
        >
          <p className="text-sm font-black tracking-widest text-white/30">
            {filter !== 'all' ? `No ${filter} serials` : 'No serials yet'}
          </p>
          {filter === 'all' && (
            <p className="text-xs text-white/20 mt-2 normal-case">
              Add a serial by URL to get started
            </p>
          )}
        </div>
      ) : (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6"
          data-testid="serials-grid"
        >
          {visible.map((serial) => (
            <SerialCard key={serial.id} serial={serial} />
          ))}
        </div>
      )}

      {showAdd && (
        <AddSerialModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false)
            setRefreshKey((k) => k + 1)
          }}
        />
      )}
    </div>
  )
}
