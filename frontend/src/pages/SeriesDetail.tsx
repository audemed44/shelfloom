import { useState, useEffect, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ChevronRight,
  Trash2,
  PlusCircle,
  GripVertical,
  Settings,
  MoreVertical,
  BookOpen,
} from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import SeriesModal from '../components/series/SeriesModal'
import type {
  SeriesWithCount,
  SeriesBook,
  ReadingOrder,
  ReadingOrderEntry,
} from '../types/api'

interface SeriesDetailData {
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

  const { data: series } = useApi<SeriesDetailData>(
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
  const [orderDirty, setOrderDirty] = useState(false)
  // Reading order entry reorder state
  const [localEntries, setLocalEntries] = useState<ReadingOrderEntry[]>([])
  const [entriesDirty, setEntriesDirty] = useState(false)
  const [entryDragOver, setEntryDragOver] = useState<number | null>(null)
  const [, setRefreshKey] = useState(0)

  // sync localBooks when books load
  useEffect(() => {
    if (books) {
      setLocalBooks(books)
      setOrderDirty(false)
    }
  }, [books])

  // sync localEntries when active reading order changes
  useEffect(() => {
    if (activeOrderId === null) return
    const order = (readingOrders ?? []).find((o) => o.id === activeOrderId)
    if (order) {
      setLocalEntries(
        [...order.entries].sort((a, b) => a.position - b.position)
      )
      setEntriesDirty(false)
    }
  }, [activeOrderId, readingOrders])

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

  const subSeries = (allSeries ?? []).filter((s) => s.parent_id === seriesId)
  const parentSeries = series?.parent_id
    ? (allSeries ?? []).find((s) => s.id === series.parent_id)
    : null

  const handleDelete = async () => {
    if (!series || !window.confirm(`Delete series "${series.name}"?`)) return
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

  // Drag-and-drop reorder (local only until save)
  const handleDragStart = (e: React.DragEvent, bookId: string) => {
    e.dataTransfer.setData('bookId', bookId)
  }

  const handleDrop = (e: React.DragEvent, targetBookId: string) => {
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

    const updated = reordered.map((b, i) => ({ ...b, sequence: i + 1 }))
    setLocalBooks(updated)
    setOrderDirty(true)
  }

  const handleSaveOrder = useCallback(async () => {
    if (!localBooks || !seriesId) return
    const origMap = new Map((books ?? []).map((b) => [b.book_id, b.sequence]))
    for (const b of localBooks) {
      if (origMap.get(b.book_id) !== b.sequence) {
        await api.post(
          `/api/series/${seriesId}/books/${b.book_id}?sequence=${b.sequence}`,
          {}
        )
      }
    }
    setOrderDirty(false)
  }, [localBooks, books, seriesId])

  const handleDiscardOrder = useCallback(() => {
    if (books) setLocalBooks(books)
    setOrderDirty(false)
  }, [books])

  // Reading order entry drag-and-drop
  const handleEntryDragStart = (e: React.DragEvent, entryId: number) => {
    e.dataTransfer.setData('entryId', String(entryId))
  }

  const handleEntryDrop = (e: React.DragEvent, targetEntryId: number) => {
    e.preventDefault()
    setEntryDragOver(null)
    const draggedId = parseInt(e.dataTransfer.getData('entryId'), 10)
    if (draggedId === targetEntryId) return

    const fromIdx = localEntries.findIndex((en) => en.id === draggedId)
    const toIdx = localEntries.findIndex((en) => en.id === targetEntryId)
    if (fromIdx === -1 || toIdx === -1) return

    const reordered = [...localEntries]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    setLocalEntries(reordered.map((en, i) => ({ ...en, position: i + 1 })))
    setEntriesDirty(true)
  }

  const handleSaveEntries = useCallback(async () => {
    if (!activeOrderId) return
    await api.patch(
      `/api/reading-orders/${activeOrderId}/entries/reorder`,
      localEntries.map((en) => ({ id: en.id, position: en.position }))
    )
    setEntriesDirty(false)
    setRefreshKey((k) => k + 1)
  }, [activeOrderId, localEntries])

  const handleDiscardEntries = useCallback(() => {
    const order = (readingOrders ?? []).find((o) => o.id === activeOrderId)
    if (order) {
      setLocalEntries(
        [...order.entries].sort((a, b) => a.position - b.position)
      )
      setEntriesDirty(false)
    }
  }, [activeOrderId, readingOrders])

  const displayBooks = localBooks ?? []
  const activeOrder = (readingOrders ?? []).find((o) => o.id === activeOrderId)

  // Format sequence for display
  const formatPosition = (seq: number | null): string => {
    if (seq == null) return '—'
    if (Number.isInteger(seq)) return String(seq).padStart(2, '0')
    return String(seq)
  }

  // Determine if a book is a "novella" type (fractional sequence like 2.5)
  const isNovella = (b: SeriesBook): boolean => {
    return b.sequence != null && !Number.isInteger(b.sequence)
  }

  if (!series) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-8 space-y-4 animate-pulse">
          <div className="h-3 w-48 bg-white/10 rounded" />
          <div className="h-8 w-80 bg-white/10 rounded" />
          <div className="h-4 w-96 bg-white/10 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      data-testid="series-detail"
    >
      {/* Header section */}
      <div className="px-8 pt-8 pb-6 border-b border-white/10">
        <div className="max-w-5xl mx-auto">
          <div className="flex justify-between items-start mb-6">
            <div>
              {/* Breadcrumb */}
              <nav
                className="flex items-center gap-2 text-xs font-medium text-white/40 mb-2"
                aria-label="breadcrumb"
              >
                <Link
                  to="/series"
                  className="hover:text-primary transition-colors"
                >
                  Series
                </Link>
                {parentSeries && (
                  <>
                    <ChevronRight size={12} className="text-white/20" />
                    <Link
                      to={`/series/${parentSeries.id}`}
                      className="hover:text-primary transition-colors"
                    >
                      {parentSeries.name}
                    </Link>
                  </>
                )}
                <ChevronRight size={12} className="text-white/20" />
                <span className="text-primary">{series.name}</span>
              </nav>

              <h1
                className="text-3xl font-black tracking-tighter text-white uppercase"
                data-testid="series-title"
              >
                {series.name}
              </h1>
              {series.description && (
                <p className="text-white/50 mt-2 max-w-2xl leading-relaxed normal-case text-sm">
                  {series.description}
                </p>
              )}
            </div>
            <div className="flex gap-3 shrink-0">
              <button
                onClick={() => setShowEdit(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-semibold transition-all normal-case"
              >
                <Settings size={14} />
                Series Settings
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-red-500/20 text-white/60 hover:text-red-400 rounded-lg text-sm font-semibold transition-all normal-case"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-8 border-t border-white/5 pt-6">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                Total Volumes
              </span>
              <span className="text-xl font-bold normal-case">
                {displayBooks.length}{' '}
                {displayBooks.length === 1 ? 'Book' : 'Books'}
              </span>
            </div>
            <div className="h-8 w-px bg-white/10" />
            {readCounts && (
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                  Progress
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      readCounts.read === readCounts.total &&
                      readCounts.total > 0
                        ? 'bg-emerald-500'
                        : 'bg-primary'
                    }`}
                  />
                  <span
                    className={`text-sm font-bold normal-case ${
                      readCounts.read === readCounts.total &&
                      readCounts.total > 0
                        ? 'text-emerald-500'
                        : ''
                    }`}
                    data-testid="progress-indicator"
                  >
                    {readCounts.read} of {readCounts.total} read
                  </span>
                </div>
              </div>
            )}
            {subSeries.length > 0 && (
              <>
                <div className="h-8 w-px bg-white/10" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                    Sub-series
                  </span>
                  <span className="text-sm font-bold normal-case">
                    {subSeries.length}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Reading Order Tabs */}
      <div className="px-8 py-4 border-b border-white/10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex gap-1 bg-white/5 p-1 rounded-xl overflow-x-auto">
            {/* Default "Series Order" tab */}
            <button
              onClick={() => setActiveOrderId(null)}
              className={`px-6 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap normal-case ${
                activeOrderId === null
                  ? 'bg-white/10 shadow-sm font-bold text-primary'
                  : 'text-white/50 hover:bg-white/5'
              }`}
            >
              Series Order
            </button>
            {(readingOrders ?? []).map((order) => (
              <button
                key={order.id}
                onClick={() => setActiveOrderId(order.id)}
                data-testid={`reading-order-tab-${order.id}`}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap normal-case ${
                  activeOrderId === order.id
                    ? 'bg-white/10 shadow-sm font-bold text-primary'
                    : 'text-white/50 hover:bg-white/5'
                }`}
              >
                {order.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {activeOrderId !== null && (
              <button
                onClick={() => handleDeleteOrder(activeOrderId)}
                className="flex items-center gap-1.5 text-white/40 text-xs font-bold hover:text-red-400 transition-colors normal-case"
              >
                <Trash2 size={12} />
                Delete Order
              </button>
            )}
            <button
              onClick={() => setShowNewOrderForm((v) => !v)}
              className="flex items-center gap-1.5 text-primary text-xs font-bold hover:underline normal-case"
            >
              <PlusCircle size={14} />
              Create Custom Order
            </button>
          </div>
        </div>
      </div>

      {/* New order form (inline) */}
      {showNewOrderForm && (
        <div className="px-8 py-3 border-b border-white/10">
          <div className="max-w-5xl mx-auto flex gap-2">
            <input
              type="text"
              value={newOrderName}
              onChange={(e) => setNewOrderName(e.target.value)}
              placeholder="Reading order name"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white normal-case placeholder:text-white/20 focus:outline-none focus:border-primary/50"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateOrder()
                if (e.key === 'Escape') setShowNewOrderForm(false)
              }}
              autoFocus
            />
            <button
              onClick={handleCreateOrder}
              className="px-5 py-2 text-sm font-bold bg-primary text-white rounded-lg hover:brightness-110 transition-all normal-case"
            >
              Create
            </button>
            <button
              onClick={() => setShowNewOrderForm(false)}
              className="px-4 py-2 text-sm font-medium text-white/50 hover:text-white transition-colors normal-case"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Content: Book list or Reading order entries */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto space-y-3">
          {activeOrderId === null ? (
            <>
              {/* Series Order — draggable book cards */}
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-white/40">
                  Reorder Books
                </h4>
                {displayBooks.length > 0 && (
                  <span className="text-xs text-white/30 italic normal-case">
                    Drag handles to reorder sequence
                  </span>
                )}
              </div>

              {displayBooks.length === 0 ? (
                <p className="text-xs text-white/30 normal-case py-4">
                  No books in this series yet.
                </p>
              ) : (
                displayBooks.map((b) => {
                  const novellaStyle = isNovella(b)
                  return (
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
                      className={`border border-white/10 p-4 rounded-xl flex items-center gap-4 group transition-all shadow-sm ${
                        novellaStyle
                          ? 'border-l-4 border-l-white/30 opacity-90'
                          : ''
                      } ${
                        dragOver === b.book_id
                          ? 'bg-primary/10 border-primary/50'
                          : 'hover:border-white/20'
                      }`}
                    >
                      {/* Drag handle */}
                      <div className="cursor-grab active:cursor-grabbing text-white/20 group-hover:text-primary transition-colors">
                        <GripVertical size={20} />
                      </div>

                      {/* Cover thumbnail */}
                      <div className="w-12 h-16 bg-white/5 rounded overflow-hidden flex-shrink-0 border border-white/10">
                        <img
                          src={`/api/books/${b.book_id}/cover`}
                          alt={b.title}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const t = e.target as HTMLImageElement
                            t.style.display = 'none'
                          }}
                        />
                      </div>

                      {/* Book info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${
                              novellaStyle
                                ? 'bg-white/10 text-white/50'
                                : 'bg-primary/10 text-primary'
                            }`}
                          >
                            {b.format ?? 'Book'}
                          </span>
                          <Link
                            to={`/books/${b.book_id}`}
                            className="text-sm font-bold text-white/90 normal-case hover:text-white transition-colors truncate"
                          >
                            {b.title}
                          </Link>
                        </div>
                        {b.author && (
                          <p className="text-xs text-white/40 mt-1 normal-case">
                            {b.author}
                          </p>
                        )}
                      </div>

                      {/* Position */}
                      <div className="flex items-center gap-6 pr-2">
                        <div className="text-right">
                          <span className="block text-[10px] uppercase text-white/40 font-bold">
                            Position
                          </span>
                          <span className="text-sm font-mono font-bold">
                            {formatPosition(b.sequence)}
                          </span>
                        </div>
                        <Link
                          to={`/books/${b.book_id}`}
                          className="text-white/30 hover:text-white transition-colors"
                        >
                          <MoreVertical size={16} />
                        </Link>
                      </div>
                    </div>
                  )
                })
              )}

              {/* Add volume placeholder */}
              <Link
                to="/library"
                className="w-full border-2 border-dashed border-white/10 rounded-xl p-4 flex items-center justify-center gap-2 text-white/40 hover:text-primary hover:border-primary/50 transition-all group"
              >
                <PlusCircle
                  size={18}
                  className="group-hover:scale-110 transition-transform"
                />
                <span className="text-sm font-bold normal-case">
                  Add Volume to Series
                </span>
              </Link>
            </>
          ) : (
            <>
              {/* Reading Order entries */}
              {activeOrder && (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-white/40">
                      {activeOrder.name}
                    </h4>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-white/30 normal-case">
                        {localEntries.length}{' '}
                        {localEntries.length === 1 ? 'entry' : 'entries'}
                      </span>
                      {localEntries.length > 0 && (
                        <span className="text-xs text-white/30 italic normal-case">
                          Drag handles to reorder
                        </span>
                      )}
                    </div>
                  </div>
                  {localEntries.length === 0 ? (
                    <p className="text-xs text-white/30 normal-case py-4">
                      No entries in this reading order yet.
                    </p>
                  ) : (
                    localEntries.map((entry) => (
                      <div
                        key={entry.id}
                        draggable
                        onDragStart={(e) => handleEntryDragStart(e, entry.id)}
                        onDragOver={(e) => {
                          e.preventDefault()
                          setEntryDragOver(entry.id)
                        }}
                        onDragLeave={() => setEntryDragOver(null)}
                        onDrop={(e) => handleEntryDrop(e, entry.id)}
                        className={`border border-white/10 p-4 rounded-xl flex items-center gap-4 group transition-all shadow-sm ${
                          entryDragOver === entry.id
                            ? 'bg-primary/10 border-primary/50'
                            : 'hover:border-white/20'
                        }`}
                      >
                        {/* Drag handle */}
                        <div className="cursor-grab active:cursor-grabbing text-white/20 group-hover:text-primary transition-colors">
                          <GripVertical size={20} />
                        </div>

                        {/* Cover thumbnail */}
                        <div className="w-12 h-16 bg-white/5 rounded overflow-hidden flex-shrink-0 border border-white/10">
                          <img
                            src={`/api/books/${entry.book_id}/cover`}
                            alt={entry.title ?? ''}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const t = e.target as HTMLImageElement
                              t.style.display = 'none'
                            }}
                          />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {entry.format && (
                              <span className="bg-primary/10 text-primary text-[10px] font-black px-2 py-0.5 rounded uppercase">
                                {entry.format}
                              </span>
                            )}
                            <Link
                              to={`/books/${entry.book_id}`}
                              className="text-sm font-bold text-white/90 normal-case hover:text-white transition-colors truncate"
                            >
                              {entry.title ?? entry.book_id}
                            </Link>
                          </div>
                          {entry.author && (
                            <p className="text-xs text-white/40 mt-1 normal-case">
                              {entry.author}
                            </p>
                          )}
                          {entry.note && (
                            <p className="text-xs text-white/30 mt-0.5 normal-case italic">
                              {entry.note}
                            </p>
                          )}
                        </div>

                        {/* Position */}
                        <div className="flex items-center gap-6 pr-2">
                          <div className="text-right">
                            <span className="block text-[10px] uppercase text-white/40 font-bold">
                              Position
                            </span>
                            <span className="text-sm font-mono font-bold">
                              {String(entry.position).padStart(2, '0')}
                            </span>
                          </div>
                          <Link
                            to={`/books/${entry.book_id}`}
                            className="text-white/30 hover:text-white transition-colors"
                          >
                            <MoreVertical size={16} />
                          </Link>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </>
          )}

          {/* Sub-series (shown below books in both views) */}
          {subSeries.length > 0 && (
            <div className="pt-6 mt-6 border-t border-white/5 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-widest text-white/40">
                Sub-series
              </h4>
              <div className="space-y-2">
                {subSeries.map((s) => (
                  <Link
                    key={s.id}
                    to={`/series/${s.id}`}
                    className="border border-white/10 p-4 rounded-xl flex items-center gap-4 group hover:border-white/20 transition-all"
                  >
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                      <BookOpen size={18} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-bold text-white/90 normal-case group-hover:text-white transition-colors">
                        {s.name}
                      </span>
                    </div>
                    <span className="text-[10px] text-white/30 tracking-widest uppercase">
                      {s.book_count} books
                    </span>
                    <ChevronRight size={16} className="text-white/20" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action Bar Footer — shown when series order or reading order has unsaved changes */}
      {(orderDirty || entriesDirty) && (
        <footer className="px-8 py-4 border-t border-white/10 flex justify-end gap-3">
          <button
            onClick={
              activeOrderId === null ? handleDiscardOrder : handleDiscardEntries
            }
            className="px-6 py-2 text-sm font-bold text-white/50 hover:text-white transition-colors normal-case"
          >
            Discard Changes
          </button>
          <button
            onClick={
              activeOrderId === null ? handleSaveOrder : handleSaveEntries
            }
            className="px-8 py-2 bg-primary text-white text-sm font-bold rounded-lg shadow-lg shadow-primary/30 hover:brightness-110 transition-all normal-case"
          >
            Save Order
          </button>
        </footer>
      )}

      {/* Edit modal */}
      {showEdit && (
        <SeriesModal
          series={series as SeriesWithCount & { book_count: number }}
          allSeries={(allSeries ?? []) as SeriesWithCount[]}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false)
            setRefreshKey((k) => k + 1)
            navigate(`/series/${seriesId}`, { replace: true })
          }}
        />
      )}
    </div>
  )
}
