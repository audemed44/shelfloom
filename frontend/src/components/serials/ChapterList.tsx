import { useState } from 'react'
import { CheckCircle2, Circle, Download, Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import { useApi } from '../../hooks/useApi'
import type { SerialChapter } from '../../types/api'

interface ChapterListProps {
  serialId: number
  totalChapters: number
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const LIMIT = 50

export default function ChapterList({
  serialId,
  totalChapters,
}: ChapterListProps) {
  const [offset, setOffset] = useState(0)
  const [fetchKey, setFetchKey] = useState(0)
  const [fetchStart, setFetchStart] = useState('')
  const [fetchEnd, setFetchEnd] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const { data: chapters, loading } = useApi<SerialChapter[]>(
    `/api/serials/${serialId}/chapters?offset=${offset}&limit=${LIMIT}&_k=${fetchKey}`
  )

  const handleFetch = async () => {
    const start = parseInt(fetchStart, 10)
    const end = parseInt(fetchEnd, 10)
    if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
      setFetchError('Enter a valid range (start ≤ end)')
      return
    }
    setFetching(true)
    setFetchError(null)
    try {
      await api.post(`/api/serials/${serialId}/chapters/fetch`, { start, end })
      setFetchKey((k) => k + 1)
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setFetchError(e.data?.detail ?? 'Failed to fetch chapters')
    } finally {
      setFetching(false)
    }
  }

  const fetched = (chapters ?? []).filter((c) => c.has_content).length
  const shown = chapters?.length ?? 0

  return (
    <div className="space-y-4">
      {/* Fetch range controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
            From
          </label>
          <input
            type="number"
            min={1}
            max={totalChapters}
            value={fetchStart}
            onChange={(e) => setFetchStart(e.target.value)}
            placeholder="1"
            className="w-24 bg-black border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-[10px] font-black tracking-widest uppercase text-white/40">
            To
          </label>
          <input
            type="number"
            min={1}
            max={totalChapters}
            value={fetchEnd}
            onChange={(e) => setFetchEnd(e.target.value)}
            placeholder={totalChapters > 0 ? String(totalChapters) : ''}
            className="w-24 bg-black border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
          />
        </div>
        <button
          onClick={handleFetch}
          disabled={fetching}
          className="flex items-center gap-2 px-4 py-2 text-xs font-black tracking-widest uppercase bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 transition-colors"
        >
          {fetching ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Download size={12} />
          )}
          Fetch Content
        </button>
        {fetchError && (
          <p className="text-xs text-red-400 normal-case">{fetchError}</p>
        )}
        {shown > 0 && (
          <p className="text-[10px] text-white/30 tracking-widest uppercase ml-auto">
            {fetched}/{shown} fetched
          </p>
        )}
      </div>

      {/* Chapter table */}
      {loading ? (
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : (chapters ?? []).length === 0 ? (
        <p className="text-xs text-white/30 normal-case py-4">
          No chapters yet.
        </p>
      ) : (
        <div className="border border-white/10">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 w-16">
                  #
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40">
                  Title
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 hidden sm:table-cell">
                  Date
                </th>
                <th className="text-center px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 w-20">
                  Fetched
                </th>
              </tr>
            </thead>
            <tbody>
              {(chapters ?? []).map((ch) => (
                <tr
                  key={ch.id}
                  className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
                >
                  <td className="px-4 py-2 font-mono text-white/40">
                    {String(ch.chapter_number).padStart(3, '0')}
                  </td>
                  <td className="px-4 py-2 text-white/80 normal-case truncate max-w-xs">
                    {ch.title ?? `Chapter ${ch.chapter_number}`}
                  </td>
                  <td className="px-4 py-2 text-white/30 normal-case hidden sm:table-cell">
                    {fmtDate(ch.publish_date)}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {ch.has_content ? (
                      <CheckCircle2
                        size={13}
                        className="text-green-500 inline"
                      />
                    ) : (
                      <Circle size={13} className="text-white/20 inline" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalChapters > LIMIT && (
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            disabled={offset === 0}
            className="text-[10px] font-black tracking-widest uppercase text-white/40 hover:text-white disabled:opacity-30 transition-colors"
          >
            Previous
          </button>
          <span className="text-[10px] text-white/30 tracking-widest uppercase">
            {offset + 1}–{Math.min(offset + LIMIT, totalChapters)} of{' '}
            {totalChapters}
          </span>
          <button
            onClick={() => setOffset(offset + LIMIT)}
            disabled={offset + LIMIT >= totalChapters}
            className="text-[10px] font-black tracking-widest uppercase text-white/40 hover:text-white disabled:opacity-30 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
