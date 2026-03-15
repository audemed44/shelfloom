import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  AlertTriangle,
  Link2,
  Trash2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Copy,
  History,
} from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import type {
  DuplicateSessionGroup,
  UnmatchedEntry,
  DuplicateBookGroup,
  ImportLogResponse,
  Book,
} from '../types/api'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

// ── Tab button ────────────────────────────────────────────────────────────────

function TabBtn({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  count?: number
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-[10px] font-black tracking-widest uppercase border-b-2 transition-colors ${
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-white/40 hover:text-white/60'
      }`}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={`text-[9px] font-black px-1.5 py-0.5 ${
            active ? 'bg-primary/20 text-primary' : 'bg-white/10 text-white/40'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

// ── Duplicate Sessions Tab ────────────────────────────────────────────────────

function DuplicateSessionsTab() {
  const [key, setKey] = useState(0)
  const { data: groups, loading } = useApi<DuplicateSessionGroup[]>(
    `/api/data-mgmt/duplicate-sessions?_k=${key}`
  )
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkMsg, setBulkMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSetDismissed = async (sessionId: number, dismissed: boolean) => {
    setError(null)
    try {
      await api.patch(`/api/data-mgmt/sessions/${sessionId}/dismissed`, {
        dismissed,
      })
      setKey((k) => k + 1)
    } catch {
      setError('Failed to update session.')
    }
  }

  const handleBulkResolve = async () => {
    setBulkLoading(true)
    setBulkMsg(null)
    setError(null)
    try {
      const result = await api.post<{ dismissed: number }>(
        '/api/data-mgmt/duplicate-sessions/bulk-resolve',
        {}
      )
      setBulkMsg(`Auto-resolved: ${result?.dismissed ?? 0} sessions dismissed`)
      setKey((k) => k + 1)
    } catch {
      setError('Bulk resolve failed.')
    } finally {
      setBulkLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-white/30" />
      </div>
    )
  }

  const allGroups = groups ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/40 normal-case">
          Sessions dismissed during import (SDR overridden by stats_db). Review
          or restore them.
        </p>
        <button
          onClick={handleBulkResolve}
          disabled={bulkLoading}
          className="flex items-center gap-2 px-4 py-2 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/60 hover:text-white hover:border-white/40 disabled:opacity-40 transition-colors shrink-0"
        >
          {bulkLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          Auto-resolve all
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
          {error}
        </p>
      )}
      {bulkMsg && (
        <div className="flex items-center gap-2 px-3 py-2 border border-primary/20 bg-primary/5">
          <CheckCircle2 size={13} className="text-primary shrink-0" />
          <p className="text-xs text-primary font-black tracking-widest uppercase">
            {bulkMsg}
          </p>
        </div>
      )}

      {allGroups.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 border border-white/10"
          data-testid="no-duplicates"
        >
          <CheckCircle2 size={24} className="text-white/20 mb-3" />
          <p className="text-xs font-black tracking-widest uppercase text-white/30">
            No duplicate sessions
          </p>
        </div>
      ) : (
        allGroups.map((group) => (
          <div
            key={group.book_id}
            className="border border-white/10"
            data-testid={`duplicate-group-${group.book_id}`}
          >
            <div className="px-4 py-3 border-b border-white/10 bg-white/[0.02]">
              <p className="text-sm font-medium text-white">
                {group.book_title}
              </p>
              {group.book_author && (
                <p className="text-[11px] text-white/40 normal-case mt-0.5">
                  {group.book_author}
                </p>
              )}
            </div>
            <div className="divide-y divide-white/5">
              {group.pairs.map((pair, i) => (
                <div key={i} className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Dismissed (loser) */}
                    <div
                      className="p-3 border border-white/10 bg-white/[0.01] space-y-1"
                      data-testid="dismissed-session"
                    >
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-[9px] font-black tracking-widest uppercase text-red-400/80 bg-red-400/10 px-1.5 py-0.5">
                          Dismissed
                        </span>
                        <span className="text-[9px] text-white/30 uppercase tracking-widest">
                          {pair.dismissed.source}
                        </span>
                      </div>
                      <p className="text-[11px] text-white/50 normal-case">
                        {fmtDate(pair.dismissed.start_time)}
                      </p>
                      <p className="text-[11px] text-white/40 normal-case">
                        {fmtDuration(pair.dismissed.duration)} ·{' '}
                        {pair.dismissed.pages_read ?? 0} pages
                      </p>
                    </div>

                    {/* Active (winner) */}
                    {pair.active ? (
                      <div
                        className="p-3 border border-primary/20 bg-primary/[0.03] space-y-1"
                        data-testid="active-session"
                      >
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-[9px] font-black tracking-widest uppercase text-primary bg-primary/10 px-1.5 py-0.5">
                            Active
                          </span>
                          <span className="text-[9px] text-white/30 uppercase tracking-widest">
                            {pair.active.source}
                          </span>
                        </div>
                        <p className="text-[11px] text-white/50 normal-case">
                          {fmtDate(pair.active.start_time)}
                        </p>
                        <p className="text-[11px] text-white/40 normal-case">
                          {fmtDuration(pair.active.duration)} ·{' '}
                          {pair.active.pages_read ?? 0} pages
                        </p>
                      </div>
                    ) : (
                      <div className="p-3 border border-white/5 flex items-center justify-center">
                        <p className="text-[10px] text-white/20 uppercase tracking-widest">
                          No counterpart found
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        handleSetDismissed(pair.dismissed.id, false)
                      }
                      className="text-[10px] font-black tracking-widest uppercase px-3 py-1.5 border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors"
                    >
                      Restore dismissed
                    </button>
                    {pair.active && (
                      <button
                        onClick={() =>
                          handleSetDismissed(pair.active!.id, true)
                        }
                        className="text-[10px] font-black tracking-widest uppercase px-3 py-1.5 border border-red-400/20 text-red-400/60 hover:text-red-400 transition-colors"
                      >
                        Dismiss active
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ── Unmatched Data Tab ────────────────────────────────────────────────────────

function UnmatchedDataTab() {
  const [key, setKey] = useState(0)
  const [showDismissed, setShowDismissed] = useState(false)
  const { data: entries, loading } = useApi<UnmatchedEntry[]>(
    `/api/data-mgmt/unmatched?include_dismissed=${showDismissed}&_k=${key}`
  )
  const { data: books } = useApi<Book[]>('/api/books?per_page=500')
  const [linkingId, setLinkingId] = useState<number | null>(null)
  const [selectedBookId, setSelectedBookId] = useState<Record<number, string>>(
    {}
  )
  const [error, setError] = useState<string | null>(null)

  const handleLink = async (entryId: number) => {
    const bookId = selectedBookId[entryId]
    if (!bookId) return
    setError(null)
    try {
      await api.post(`/api/data-mgmt/unmatched/${entryId}/link`, {
        book_id: bookId,
      })
      setKey((k) => k + 1)
      setLinkingId(null)
    } catch {
      setError('Failed to link entry.')
    }
  }

  const handleDismiss = async (entryId: number) => {
    setError(null)
    try {
      await api.post(`/api/data-mgmt/unmatched/${entryId}/dismiss`)
      setKey((k) => k + 1)
    } catch {
      setError('Failed to dismiss entry.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-white/30" />
      </div>
    )
  }

  const allEntries = entries ?? []
  const bookList = books ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/40 normal-case">
          KOReader entries that could not be matched to a book during import.
          Link them or dismiss.
        </p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
            className="accent-primary"
          />
          <span className="text-[10px] font-black tracking-widest uppercase text-white/40">
            Show dismissed
          </span>
        </label>
      </div>

      {error && (
        <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
          {error}
        </p>
      )}

      {allEntries.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 border border-white/10"
          data-testid="no-unmatched"
        >
          <CheckCircle2 size={24} className="text-white/20 mb-3" />
          <p className="text-xs font-black tracking-widest uppercase text-white/30">
            No unmatched entries
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {allEntries.map((entry) => (
            <div
              key={entry.id}
              className={`border ${entry.dismissed ? 'border-white/5 opacity-50' : 'border-white/10'} bg-white/[0.02]`}
              data-testid={`unmatched-entry-${entry.id}`}
            >
              <div className="px-4 py-3 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium text-white truncate">
                      {entry.title}
                    </p>
                    {entry.dismissed && (
                      <span className="text-[9px] font-black tracking-widest uppercase text-white/30 bg-white/5 px-1.5 py-0.5 shrink-0">
                        Dismissed
                      </span>
                    )}
                    {entry.linked_book_id && (
                      <span className="text-[9px] font-black tracking-widest uppercase text-primary bg-primary/10 px-1.5 py-0.5 shrink-0">
                        Linked
                      </span>
                    )}
                  </div>
                  {entry.author && (
                    <p className="text-[11px] text-white/40 normal-case">
                      {entry.author}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] font-black tracking-widest uppercase text-white/20">
                      {entry.source}
                    </span>
                    <span className="text-[10px] text-white/30 normal-case">
                      {entry.session_count} sessions ·{' '}
                      {fmtDuration(entry.total_duration_seconds)}
                    </span>
                  </div>
                </div>

                {!entry.dismissed && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() =>
                        setLinkingId(linkingId === entry.id ? null : entry.id)
                      }
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase border border-primary/30 text-primary/70 hover:text-primary hover:border-primary transition-colors"
                    >
                      <Link2 size={11} />
                      Link
                    </button>
                    <button
                      onClick={() => handleDismiss(entry.id)}
                      className="p-1.5 text-white/30 hover:text-red-400 transition-colors"
                      aria-label="Dismiss"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>

              {/* Link picker */}
              {linkingId === entry.id && (
                <div className="px-4 pb-4 border-t border-white/5 pt-3">
                  <p className="text-[10px] font-black tracking-widest uppercase text-white/30 mb-2">
                    Select book to link
                  </p>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedBookId[entry.id] ?? ''}
                      onChange={(e) =>
                        setSelectedBookId((prev) => ({
                          ...prev,
                          [entry.id]: e.target.value,
                        }))
                      }
                      className="flex-1 bg-black border border-white/10 px-3 py-2 text-sm text-white normal-case focus:outline-none focus:border-primary appearance-none"
                    >
                      <option value="">— Choose a book —</option>
                      {bookList.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title}
                          {b.author ? ` — ${b.author}` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleLink(entry.id)}
                      disabled={!selectedBookId[entry.id]}
                      className="px-4 py-2 text-[10px] font-black tracking-widest uppercase bg-primary text-white hover:bg-primary/80 disabled:opacity-40 transition-colors"
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Duplicate Books Tab ───────────────────────────────────────────────────────

function DuplicateBooksTab() {
  const [key, setKey] = useState(0)
  const { data: groups, loading } = useApi<DuplicateBookGroup[]>(
    `/api/data-mgmt/duplicate-books?_k=${key}`
  )
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState<string | null>(null) // `${keepId}:${discardId}`

  const handleMerge = async (keepId: string, discardId: string) => {
    if (
      !window.confirm(
        'Merge books? Reading data from the discarded book will move to the kept one, then the discarded book will be deleted.'
      )
    )
      return
    setMerging(`${keepId}:${discardId}`)
    setError(null)
    try {
      await api.post('/api/data-mgmt/books/merge', {
        keep_id: keepId,
        discard_id: discardId,
      })
      setKey((k) => k + 1)
    } catch {
      setError('Merge failed.')
    } finally {
      setMerging(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-white/30" />
      </div>
    )
  }

  const allGroups = groups ?? []

  return (
    <div className="space-y-6">
      <p className="text-xs text-white/40 normal-case">
        Books with identical title and author (normalized). Merge reading data
        from one into the other.
      </p>

      {error && (
        <p className="text-xs text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2 normal-case">
          {error}
        </p>
      )}

      {allGroups.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 border border-white/10"
          data-testid="no-duplicate-books"
        >
          <CheckCircle2 size={24} className="text-white/20 mb-3" />
          <p className="text-xs font-black tracking-widest uppercase text-white/30">
            No duplicate books found
          </p>
        </div>
      ) : (
        allGroups.map((group, gi) => (
          <div
            key={gi}
            className="border border-white/10"
            data-testid={`duplicate-book-group-${gi}`}
          >
            <div className="px-4 py-3 border-b border-white/10 bg-white/[0.02]">
              <p className="text-[10px] font-black tracking-widest uppercase text-white/40">
                {group.books.length} duplicates
              </p>
            </div>
            <div className="divide-y divide-white/5">
              {group.books.map((book, bi) => (
                <div
                  key={book.id}
                  className="px-4 py-3 flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {book.title}
                    </p>
                    {book.author && (
                      <p className="text-[11px] text-white/40 normal-case mt-0.5">
                        {book.author}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] font-black tracking-widest uppercase text-white/20">
                        {book.format}
                      </span>
                      <span className="text-[10px] text-white/30 normal-case">
                        {book.session_count} sessions
                      </span>
                      <span className="text-[10px] text-white/20 normal-case">
                        Added {new Date(book.date_added).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {/* Merge actions: pair with others in group */}
                  {group.books
                    .filter((_, oi) => oi !== bi)
                    .map((other) => {
                      const key = `${book.id}:${other.id}`
                      return (
                        <button
                          key={other.id}
                          onClick={() => handleMerge(book.id, other.id)}
                          disabled={merging === key}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/50 hover:text-white hover:border-white/40 disabled:opacity-40 transition-colors shrink-0"
                        >
                          {merging === key ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Copy size={11} />
                          )}
                          Keep this, delete other
                        </button>
                      )
                    })}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ── Import Log Tab ────────────────────────────────────────────────────────────

function ImportLogTab() {
  const [offset, setOffset] = useState(0)
  const limit = 50
  const { data, loading } = useApi<ImportLogResponse>(
    `/api/data-mgmt/import-log?limit=${limit}&offset=${offset}`
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-white/30" />
      </div>
    )
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <div className="space-y-4">
      <p className="text-xs text-white/40 normal-case">
        Hash history for imported books — each entry records a file scan that
        detected a new or changed book.
      </p>

      {items.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 border border-white/10"
          data-testid="no-import-log"
        >
          <History size={24} className="text-white/20 mb-3" />
          <p className="text-xs font-black tracking-widest uppercase text-white/30">
            No import history yet
          </p>
        </div>
      ) : (
        <>
          <div className="border border-white/10 divide-y divide-white/5">
            {items.map((entry) => (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-start gap-4"
                data-testid={`import-log-${entry.id}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {entry.book_title}
                  </p>
                  {entry.book_author && (
                    <p className="text-[11px] text-white/40 normal-case mt-0.5">
                      {entry.book_author}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] font-mono text-white/25 normal-case">
                      sha:{entry.hash_sha}
                    </span>
                    <span className="text-[10px] font-mono text-white/25 normal-case">
                      md5:{entry.hash_md5}
                    </span>
                    {entry.page_count && (
                      <span className="text-[10px] text-white/30 normal-case">
                        {entry.page_count} pages
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-[10px] text-white/30 normal-case shrink-0">
                  {fmtDate(entry.recorded_at)}
                </span>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-white/30 normal-case">
                {offset + 1}–{Math.min(offset + limit, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="px-3 py-1.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/50 hover:text-white disabled:opacity-30 transition-colors"
                >
                  Prev
                </button>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= total}
                  className="px-3 py-1.5 text-[10px] font-black tracking-widest uppercase border border-white/20 text-white/50 hover:text-white disabled:opacity-30 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

type Tab = 'duplicate-sessions' | 'unmatched' | 'duplicate-books' | 'import-log'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'duplicate-sessions',
    label: 'Duplicate Sessions',
    icon: <AlertTriangle size={12} />,
  },
  { id: 'unmatched', label: 'Unmatched Data', icon: <Link2 size={12} /> },
  {
    id: 'duplicate-books',
    label: 'Duplicate Books',
    icon: <Copy size={12} />,
  },
  { id: 'import-log', label: 'Import Log', icon: <History size={12} /> },
]

export default function DataManagement() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('duplicate-sessions')

  const { data: dupSessions } = useApi<DuplicateSessionGroup[]>(
    '/api/data-mgmt/duplicate-sessions'
  )
  const { data: unmatched } = useApi<UnmatchedEntry[]>(
    '/api/data-mgmt/unmatched'
  )
  const { data: dupBooks } = useApi<DuplicateBookGroup[]>(
    '/api/data-mgmt/duplicate-books'
  )

  const counts: Record<Tab, number | undefined> = {
    'duplicate-sessions': dupSessions?.reduce(
      (acc, g) => acc + g.pairs.length,
      0
    ),
    unmatched: unmatched?.length,
    'duplicate-books': dupBooks?.reduce((acc, g) => acc + g.books.length, 0),
    'import-log': undefined,
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-8">
      <header>
        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-1.5 text-[10px] font-black tracking-widest uppercase text-white/30 hover:text-white/60 transition-colors mb-4"
        >
          <ArrowLeft size={11} />
          Settings
        </button>
        <h2 className="text-4xl sm:text-6xl font-black tracking-tighter text-white">
          Data Management
        </h2>
        <p className="text-white/40 text-base font-medium mt-2 normal-case">
          Review duplicates, link unmatched KOReader data, and inspect import
          history.
        </p>
      </header>

      {/* Tab bar */}
      <div
        className="flex items-center gap-0 border-b border-white/10 overflow-x-auto"
        data-testid="tab-bar"
      >
        {TABS.map((tab) => (
          <TabBtn
            key={tab.id}
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            count={counts[tab.id]}
          >
            {tab.icon}
            {tab.label}
          </TabBtn>
        ))}
      </div>

      {/* Tab content */}
      <div data-testid="tab-content">
        {activeTab === 'duplicate-sessions' && <DuplicateSessionsTab />}
        {activeTab === 'unmatched' && <UnmatchedDataTab />}
        {activeTab === 'duplicate-books' && <DuplicateBooksTab />}
        {activeTab === 'import-log' && <ImportLogTab />}
      </div>
    </div>
  )
}
