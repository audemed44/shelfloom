import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Edit2, Trash2, PlusCircle } from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import SeriesModal from '../components/series/SeriesModal'
import type { SeriesWithCount } from '../types/api'

interface TreeNode extends SeriesWithCount {
  children: TreeNode[]
}

function buildTree(flat: SeriesWithCount[]): TreeNode[] {
  const map = new Map<number, TreeNode>()
  const roots: TreeNode[] = []

  for (const s of flat) {
    map.set(s.id, { ...s, children: [] })
  }
  for (const node of map.values()) {
    if (node.parent_id != null && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

interface SeriesRowProps {
  node: TreeNode
  depth: number
  allSeries: SeriesWithCount[]
  onEdit: (s: SeriesWithCount) => void
  onDelete: (s: SeriesWithCount) => void
}

function SeriesRow({ node, depth, allSeries, onEdit, onDelete }: SeriesRowProps) {
  return (
    <>
      <div
        className="flex items-center justify-between py-2.5 border-b border-white/5"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        data-testid={`series-row-${node.id}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={`/series/${node.id}`}
            className="text-sm text-white/80 normal-case hover:text-white transition-colors truncate"
          >
            {node.name}
          </Link>
          <span className="shrink-0 text-[10px] font-black tracking-widest uppercase text-white/30 bg-white/5 px-1.5 py-0.5 rounded">
            {node.book_count}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            onClick={() => onEdit(node)}
            aria-label={`Edit ${node.name}`}
            className="p-1.5 text-white/40 hover:text-white transition-colors"
          >
            <Edit2 size={13} />
          </button>
          <button
            onClick={() => onDelete(node)}
            aria-label={`Delete ${node.name}`}
            className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {node.children.map((child) => (
        <SeriesRow
          key={child.id}
          node={child}
          depth={depth + 1}
          allSeries={allSeries}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </>
  )
}

export default function SeriesList() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [editingSeries, setEditingSeries] = useState<SeriesWithCount | null | undefined>(undefined)
  const [showCreate, setShowCreate] = useState(false)
  const [purgeResult, setPurgeResult] = useState<string | null>(null)

  const { data: flatList } = useApi<SeriesWithCount[]>(`/api/series/tree?_k=${refreshKey}`)
  const allSeries: SeriesWithCount[] = flatList ?? []
  const tree = buildTree(allSeries)

  const handleDelete = async (s: SeriesWithCount) => {
    if (!window.confirm(`Delete series "${s.name}"?`)) return
    try {
      await api.delete(`/api/series/${s.id}`)
      setRefreshKey((k) => k + 1)
    } catch {
      // ignore
    }
  }

  const handlePurge = async () => {
    try {
      const result = await api.delete<{ deleted: string[]; count: number }>('/api/series/empty')
      if (result && result.count > 0) {
        setPurgeResult(`Deleted: ${result.deleted.join(', ')}`)
      } else {
        setPurgeResult('No empty series found')
      }
      setRefreshKey((k) => k + 1)
    } catch {
      setPurgeResult('Failed to purge.')
    }
  }

  const handleSaved = () => {
    setShowCreate(false)
    setEditingSeries(undefined)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xs font-black tracking-widest uppercase text-white">Series</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePurge}
            data-testid="purge-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors"
          >
            Purge Empty
          </button>
          <button
            onClick={() => setShowCreate(true)}
            data-testid="new-series-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 transition-colors"
          >
            <PlusCircle size={12} />
            New Series
          </button>
        </div>
      </div>

      {/* Purge result banner */}
      {purgeResult && (
        <div
          className="px-4 py-3 border border-white/10 bg-white/5 rounded text-xs text-white/70 normal-case"
          data-testid="purge-result"
        >
          {purgeResult}
        </div>
      )}

      {/* Series tree */}
      <div className="border border-white/10 rounded bg-black" data-testid="series-list">
        {tree.length === 0 ? (
          <p className="text-xs text-white/30 tracking-widest uppercase text-center py-8">No series yet</p>
        ) : (
          tree.map((node) => (
            <SeriesRow
              key={node.id}
              node={node}
              depth={0}
              allSeries={allSeries}
              onEdit={(s) => setEditingSeries(s)}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <SeriesModal
          allSeries={allSeries}
          onClose={() => setShowCreate(false)}
          onSaved={handleSaved}
        />
      )}
      {editingSeries !== undefined && editingSeries !== null && (
        <SeriesModal
          series={editingSeries}
          allSeries={allSeries}
          onClose={() => setEditingSeries(undefined)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
