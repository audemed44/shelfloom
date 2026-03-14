import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ChevronRight, Edit2, Trash2, PlusCircle } from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import SeriesModal from '../components/series/SeriesModal'
import type { SeriesWithCount, SeriesBook, ReadingOrder } from '../types/api'

interface SeriesDetail {
  id: number
  name: string
  description: string | null
  parent_id: number | null
  sort_order: number
  cover_path: string | null
}

interface ReadingSummary {
  percent_finished: number | null
  total_time_seconds: number
  total_sessions: number
}

export default function SeriesDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const seriesId = id ? parseInt(id, 10) : null

  const { data: series } = useApi<SeriesDetail>(
    seriesId ? `/api/series/${seriesId}` : null
  )
  const { data: books } = useApi<SeriesBook[]>(
    seriesId ? `/api/series/${seriesId}/books` : null
  )
  const { data: allSeries } = useApi<SeriesWithCount[]>('/api/series/tree')
  const { data: readingOrders } = useApi<ReadingOrder[]>(
    seriesId ? `/api/series/${seriesId}/reading-orders` : null
  )

  const [showEdit, setShowEdit] = useState(false)
  const [activeOrderId, setActiveOrderId] = useState<number | null>(null)
  const [newOrderName, setNewOrderName] = useState('')
  const [showNewOrderForm, setShowNewOrderForm] = useState(false)
  const [readCounts, setReadCounts] = useState<{
    read: number
    total: number
  } | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [localBooks, setLocalBooks] = useState<SeriesBook[] | null>(null)
  const [, setRefreshKey] = useState(0)

  // sync localBooks when books load
  useEffect(() => {
    if (books) setLocalBooks(books)
  }, [books])

  // load reading progress
  useEffect(() => {
    if (!books || books.length === 0) return
    Promise.all(
      books.map((b) =>
        api
          .get<ReadingSummary>(`/api/books/${b.book_id}/reading-summary`)
          .catch(() => null)
      )
    ).then((summaries) => {
      const read = summaries.filter(
        (s) => s != null && (s.percent_finished ?? 0) >= 99
      ).length
      setReadCounts({ read, total: books.length })
    })
  }, [books])

  // set first reading order as active when loaded
  useEffect(() => {
    if (readingOrders && readingOrders.length > 0 && activeOrderId === null) {
      setActiveOrderId(readingOrders[0].id)
    }
  }, [readingOrders, activeOrderId])

  if (!series) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-3 w-40 bg-white/10 rounded" />
        <div className="h-6 w-64 bg-white/10 rounded" />
      </div>
    )
  }

  const subSeries = (allSeries ?? []).filter((s) => s.parent_id === seriesId)
  const parentSeries = series.parent_id
    ? (allSeries ?? []).find((s) => s.id === series.parent_id)
    : null

  const handleDelete = async () => {
    if (!window.confirm(`Delete series "${series.name}"?`)) return
    try {
      await api.delete(`/api/series/${seriesId}`)
      navigate('/series')
    } catch {
      // ignore
    }
  }

  const handleDeleteOrder = async (orderId: number) => {
    try {
      await api.delete(`/api/reading-orders/${orderId}`)
      setRefreshKey((k) => k + 1)
      if (activeOrderId === orderId) setActiveOrderId(null)
    } catch {
      // ignore
    }
  }

  const handleCreateOrder = async () => {
    if (!newOrderName.trim() || !seriesId) return
    try {
      await api.post('/api/reading-orders', {
        name: newOrderName.trim(),
        series_id: seriesId,
      })
      setNewOrderName('')
      setShowNewOrderForm(false)
      setRefreshKey((k) => k + 1)
    } catch {
      // ignore
    }
  }

  // Drag-and-drop reorder
  const handleDragStart = (e: React.DragEvent, bookId: string) => {
    e.dataTransfer.setData('bookId', bookId)
  }

  const handleDrop = async (e: React.DragEvent, targetBookId: string) => {
    e.preventDefault()
    setDragOver(null)
    const draggedId = e.dataTransfer.getData('bookId')
    if (draggedId === targetBookId || !localBooks || !seriesId) return

    const fromIdx = localBooks.findIndex((b) => b.book_id === draggedId)
    const toIdx = localBooks.findIndex((b) => b.book_id === targetBookId)
    if (fromIdx === -1 || toIdx === -1) return

    const reordered = [...localBooks]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)

    // assign new integer sequences
    const updated = reordered.map((b, i) => ({ ...b, sequence: i + 1 }))
    setLocalBooks(updated)

    // persist changed sequences
    const origMap = new Map(localBooks.map((b) => [b.book_id, b.sequence]))
    for (const b of updated) {
      if (origMap.get(b.book_id) !== b.sequence) {
        await api.post(
          `/api/series/${seriesId}/books/${b.book_id}?sequence=${b.sequence}`,
          {}
        )
      }
    }
  }

  const displayBooks = localBooks ?? []
  const activeOrder = (readingOrders ?? []).find((o) => o.id === activeOrderId)

  return (
    <div
      className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-8"
      data-testid="series-detail"
    >
      {/* Breadcrumb */}
      <nav
        className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase text-white/40"
        aria-label="breadcrumb"
      >
        <Link to="/library" className="hover:text-primary transition-colors">
          Library
        </Link>
        {parentSeries && (
          <>
            <ChevronRight size={10} className="text-white/20" />
            <Link
              to={`/series/${parentSeries.id}`}
              className="hover:text-primary transition-colors"
            >
              {parentSeries.name}
            </Link>
          </>
        )}
        <ChevronRight size={10} className="text-white/20" />
        <span className="text-white/70">{series.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1
            className="text-2xl font-black tracking-tight text-white"
            data-testid="series-title"
          >
            {series.name}
          </h1>
          {series.description && (
            <p className="text-sm text-white/60 normal-case leading-relaxed">
              {series.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowEdit(true)}
            aria-label="Edit series"
            className="p-2 text-white/40 hover:text-white transition-colors"
          >
            <Edit2 size={15} />
          </button>
          <button
            onClick={handleDelete}
            aria-label="Delete series"
            className="p-2 text-white/40 hover:text-red-400 transition-colors"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Books section */}
      <section className="space-y-3" data-testid="books-section">
        <h2 className="text-[10px] font-black tracking-widest uppercase text-white/40">
          Books
        </h2>
        {displayBooks.length === 0 ? (
          <p className="text-xs text-white/30 normal-case">
            No books in this series.
          </p>
        ) : (
          <div className="border border-white/10 rounded bg-black">
            {displayBooks.map((b) => (
              <div
                key={b.book_id}
                draggable
                onDragStart={(e) => handleDragStart(e, b.book_id)}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(b.book_id)
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => handleDrop(e, b.book_id)}
                className={`flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0 cursor-grab transition-colors ${
                  dragOver === b.book_id ? 'bg-white/10' : 'hover:bg-white/5'
                }`}
              >
                {b.sequence != null && (
                  <span className="text-[10px] font-black tracking-widest text-white/30 w-6 shrink-0">
                    #{b.sequence}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/books/${b.book_id}`}
                    className="text-sm text-white/80 normal-case hover:text-white transition-colors truncate block"
                  >
                    {b.title}
                  </Link>
                  {b.author && (
                    <p className="text-[10px] text-white/30 normal-case">
                      {b.author}
                    </p>
                  )}
                </div>
                {b.format && (
                  <span className="text-[10px] text-white/30 tracking-widest uppercase shrink-0">
                    {b.format}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Progress */}
        {readCounts && (
          <p
            className="text-[10px] tracking-widest uppercase text-white/30"
            data-testid="progress-indicator"
          >
            {readCounts.read} of {readCounts.total} books read
          </p>
        )}
      </section>

      {/* Sub-series */}
      {subSeries.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[10px] font-black tracking-widest uppercase text-white/40">
            Sub-series
          </h2>
          <div className="space-y-1">
            {subSeries.map((s) => (
              <Link
                key={s.id}
                to={`/series/${s.id}`}
                className="flex items-center justify-between px-4 py-2.5 border border-white/10 rounded hover:border-white/20 transition-colors"
              >
                <span className="text-sm text-white/80 normal-case hover:text-white">
                  {s.name}
                </span>
                <span className="text-[10px] text-white/30 tracking-widest uppercase">
                  {s.book_count} books
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Reading Orders */}
      <section className="space-y-4" data-testid="reading-orders-section">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-black tracking-widest uppercase text-white/40">
            Reading Orders
          </h2>
          <button
            onClick={() => setShowNewOrderForm((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-black tracking-widest uppercase text-white/40 hover:text-white transition-colors"
          >
            <PlusCircle size={12} />
            New Order
          </button>
        </div>

        {showNewOrderForm && (
          <div className="flex gap-2">
            <input
              type="text"
              value={newOrderName}
              onChange={(e) => setNewOrderName(e.target.value)}
              placeholder="Reading order name"
              className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-white/30"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateOrder()
              }}
            />
            <button
              onClick={handleCreateOrder}
              className="px-4 py-2 text-xs font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 transition-colors"
            >
              Create
            </button>
          </div>
        )}

        {(readingOrders ?? []).length === 0 && !showNewOrderForm && (
          <p className="text-xs text-white/30 normal-case">
            No reading orders yet.
          </p>
        )}

        {(readingOrders ?? []).length > 0 && (
          <>
            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-white/10 overflow-x-auto">
              {(readingOrders ?? []).map((order) => (
                <div key={order.id} className="flex items-center shrink-0">
                  <button
                    onClick={() => setActiveOrderId(order.id)}
                    data-testid={`reading-order-tab-${order.id}`}
                    className={`px-4 py-2 text-[10px] font-black tracking-widest uppercase transition-colors ${
                      activeOrderId === order.id
                        ? 'text-white border-b-2 border-primary'
                        : 'text-white/40 hover:text-white'
                    }`}
                  >
                    {order.name}
                  </button>
                  <button
                    onClick={() => handleDeleteOrder(order.id)}
                    aria-label={`Delete ${order.name}`}
                    className="p-1 text-white/20 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>

            {/* Active order entries */}
            {activeOrder && (
              <div className="border border-white/10 rounded bg-black">
                {activeOrder.entries.length === 0 ? (
                  <p className="text-xs text-white/30 normal-case px-4 py-4">
                    No entries yet.
                  </p>
                ) : (
                  [...activeOrder.entries]
                    .sort((a, b) => a.position - b.position)
                    .map((entry) => {
                      const book = displayBooks.find(
                        (b) => b.book_id === entry.book_id
                      )
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0"
                        >
                          <span className="text-[10px] font-black tracking-widest text-white/30 w-6 shrink-0">
                            {entry.position}.
                          </span>
                          <span className="text-sm text-white/80 normal-case">
                            {book ? book.title : entry.book_id}
                          </span>
                          {entry.note && (
                            <span className="text-[10px] text-white/30 normal-case ml-auto">
                              {entry.note}
                            </span>
                          )}
                        </div>
                      )
                    })
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Edit modal */}
      {showEdit && (
        <SeriesModal
          series={series as SeriesWithCount & { book_count: number }}
          allSeries={(allSeries ?? []) as SeriesWithCount[]}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false)
            setRefreshKey((k) => k + 1)
            // Trigger re-fetch by navigating with same id
            navigate(`/series/${seriesId}`, { replace: true })
          }}
        />
      )}
    </div>
  )
}
