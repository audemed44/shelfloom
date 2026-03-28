import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Circle, Download, Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import type {
  ChapterFetchJobResponse,
  ChapterFetchStatusResponse,
  SerialChapter,
  SerialVolume,
} from '../../types/api'

interface ChapterListProps {
  serialId: number
  totalChapters: number
  volumes?: SerialVolume[]
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function fmtWords(wordCount: number | null): string {
  if (wordCount === null) return '—'
  if (wordCount >= 1000) {
    return `${(wordCount / 1000).toFixed(wordCount >= 10000 ? 0 : 1)}k`
  }
  return String(wordCount)
}

function fmtPages(
  pages: number | null,
  isPartial: boolean = false,
  unknownLabel: string = '—'
): string {
  if (pages === null) {
    return isPartial ? `${unknownLabel} partial` : unknownLabel
  }
  return isPartial ? `${pages}*` : String(pages)
}

function makePendingStatus(
  serialId: number,
  job: ChapterFetchJobResponse
): ChapterFetchStatusResponse {
  return {
    serial_id: serialId,
    state: job.state,
    start: job.start,
    end: job.end,
    total: job.total,
    processed: 0,
    fetched: 0,
    skipped: 0,
    failed: 0,
    current_chapter_number: null,
    current_chapter_title: null,
    started_at: job.started_at,
    finished_at: null,
    logs: [],
    error: null,
  }
}

function normalizeFetchStatus(
  serialId: number,
  status: Partial<ChapterFetchStatusResponse> | null
): ChapterFetchStatusResponse {
  return {
    serial_id: status?.serial_id ?? serialId,
    state: status?.state ?? 'idle',
    start: status?.start ?? null,
    end: status?.end ?? null,
    total: status?.total ?? 0,
    processed: status?.processed ?? 0,
    fetched: status?.fetched ?? 0,
    skipped: status?.skipped ?? 0,
    failed: status?.failed ?? 0,
    current_chapter_number: status?.current_chapter_number ?? null,
    current_chapter_title: status?.current_chapter_title ?? null,
    started_at: status?.started_at ?? null,
    finished_at: status?.finished_at ?? null,
    logs: status?.logs ?? [],
    error: status?.error ?? null,
  }
}

function getMatchingVolumes(
  chapterNumber: number,
  volumes: SerialVolume[]
): SerialVolume[] {
  return volumes
    .filter(
      (volume) =>
        volume.chapter_start <= chapterNumber &&
        volume.chapter_end >= chapterNumber
    )
    .sort((a, b) => a.volume_number - b.volume_number)
}

const LIMIT = 50

export default function ChapterList({
  serialId,
  totalChapters,
  volumes = [],
}: ChapterListProps) {
  const isMountedRef = useRef(true)
  const [offset, setOffset] = useState(0)
  const [chapters, setChapters] = useState<SerialChapter[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchStart, setFetchStart] = useState('')
  const [fetchEnd, setFetchEnd] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetchStatus, setFetchStatus] =
    useState<ChapterFetchStatusResponse | null>(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const loadChapters = useCallback(
    async (silent: boolean = false) => {
      if (!silent) {
        setLoading(true)
      }
      try {
        const data = await api.get<SerialChapter[]>(
          `/api/serials/${serialId}/chapters?offset=${offset}&limit=${LIMIT}`
        )
        if (!isMountedRef.current) return
        setChapters(data ?? [])
      } finally {
        if (isMountedRef.current && !silent) {
          setLoading(false)
        }
      }
    },
    [offset, serialId]
  )

  const loadFetchStatus = useCallback(async () => {
    const data = await api.get<ChapterFetchStatusResponse>(
      `/api/serials/${serialId}/chapters/fetch-status`
    )
    if (!isMountedRef.current) return null
    const status = normalizeFetchStatus(
      serialId,
      (data as Partial<ChapterFetchStatusResponse> | null) ?? null
    )
    setFetchStatus(status)
    return status
  }, [serialId])

  useEffect(() => {
    setChapters(null)
    void loadChapters()
  }, [loadChapters])

  useEffect(() => {
    setFetchStatus(null)
    void loadFetchStatus()
  }, [loadFetchStatus])

  useEffect(() => {
    if (fetchStatus?.state !== 'running') {
      if (
        fetchStatus?.state === 'completed' ||
        fetchStatus?.state === 'error'
      ) {
        void loadChapters(true)
      }
      return
    }

    const intervalId = window.setInterval(() => {
      void loadFetchStatus()
      void loadChapters(true)
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [fetchStatus?.state, loadChapters, loadFetchStatus])

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
      const job = await api.post<ChapterFetchJobResponse>(
        `/api/serials/${serialId}/chapters/fetch`,
        { start, end }
      )
      if (!isMountedRef.current || !job) return
      setFetchStatus(makePendingStatus(serialId, job))
      await loadFetchStatus()
      await loadChapters(true)
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setFetchError(e.data?.detail ?? 'Failed to fetch chapters')
    } finally {
      if (isMountedRef.current) {
        setFetching(false)
      }
    }
  }

  const displayedStatus = fetchStatus
  const running = displayedStatus?.state === 'running'
  const fetched = (chapters ?? []).filter((c) => c.has_content).length
  const shown = chapters?.length ?? 0

  return (
    <div className="space-y-4">
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
          disabled={fetching || running}
          className="flex items-center gap-2 px-4 py-2 text-xs font-black tracking-widest uppercase bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 transition-colors"
        >
          {fetching || running ? (
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

      {displayedStatus && displayedStatus.state !== 'idle' && (
        <div className="border border-white/10 bg-white/[0.03]">
          <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
            <span
              className={`text-[10px] font-black tracking-widest uppercase ${
                displayedStatus.state === 'running'
                  ? 'text-amber-300'
                  : displayedStatus.state === 'error'
                    ? 'text-red-400'
                    : 'text-green-400'
              }`}
            >
              {displayedStatus.state}
            </span>
            <span className="text-[10px] tracking-widest uppercase text-white/40">
              {displayedStatus.processed}/{displayedStatus.total} processed
            </span>
            <span className="text-[10px] tracking-widest uppercase text-white/40">
              {displayedStatus.fetched} fetched
            </span>
            <span className="text-[10px] tracking-widest uppercase text-white/40">
              {displayedStatus.skipped} skipped
            </span>
            <span className="text-[10px] tracking-widest uppercase text-white/40">
              {displayedStatus.failed} failed
            </span>
            {displayedStatus.start !== null && displayedStatus.end !== null && (
              <span className="text-[10px] tracking-widest uppercase text-white/25 ml-auto">
                range {displayedStatus.start}–{displayedStatus.end}
              </span>
            )}
          </div>

          <div className="grid gap-3 px-4 py-3 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-[10px] font-black tracking-widest uppercase text-white/40">
                Active Chapter
              </p>
              <p className="text-xs text-white/70 normal-case">
                {displayedStatus.current_chapter_number !== null
                  ? `${String(displayedStatus.current_chapter_number).padStart(
                      3,
                      '0'
                    )} ${displayedStatus.current_chapter_title ?? ''}`.trim()
                  : 'Waiting for next update'}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-black tracking-widest uppercase text-white/40">
                Timing
              </p>
              <p className="text-xs text-white/70 normal-case">
                Started {fmtTime(displayedStatus.started_at)}
                {displayedStatus.finished_at
                  ? ` • Finished ${fmtTime(displayedStatus.finished_at)}`
                  : ''}
              </p>
            </div>
          </div>

          {displayedStatus.error && (
            <div className="border-t border-white/10 px-4 py-3">
              <p className="text-xs text-red-400 normal-case">
                {displayedStatus.error}
              </p>
            </div>
          )}

          <div className="border-t border-white/10 px-4 py-3">
            <p className="mb-2 text-[10px] font-black tracking-widest uppercase text-white/40">
              Fetch Log
            </p>
            {displayedStatus.logs.length === 0 ? (
              <p className="text-xs text-white/30 normal-case">
                Waiting for log output.
              </p>
            ) : (
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {displayedStatus.logs.map((entry, index) => (
                  <div
                    key={`${entry.timestamp}-${index}`}
                    className="flex gap-3 text-xs normal-case"
                  >
                    <span className="shrink-0 font-mono text-white/30">
                      {fmtTime(entry.timestamp)}
                    </span>
                    <span
                      className={`shrink-0 font-black uppercase tracking-widest text-[10px] ${
                        entry.level === 'error'
                          ? 'text-red-400'
                          : entry.level === 'warning'
                            ? 'text-amber-300'
                            : 'text-white/40'
                      }`}
                    >
                      {entry.level}
                    </span>
                    <span className="text-white/70">{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
        <div className="border border-white/10 overflow-x-auto lg:overflow-visible">
          <table className="w-full min-w-full lg:min-w-[720px] text-xs table-fixed">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left px-3 sm:px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 w-12 sm:w-16">
                  #
                </th>
                <th className="text-left px-3 sm:px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 min-w-0">
                  Title
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 hidden sm:table-cell w-28">
                  Published
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 hidden md:table-cell w-28">
                  Fetched
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 hidden lg:table-cell w-20">
                  Words
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 hidden lg:table-cell w-16">
                  Pages
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 hidden xl:table-cell w-24">
                  Running
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 hidden lg:table-cell w-36">
                  Volumes
                </th>
                <th className="text-center pl-2 pr-3 sm:pr-4 py-2 text-[10px] font-black tracking-widest uppercase text-white/40 w-12 sm:w-14">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {(chapters ?? []).map((chapter) => {
                const matchingVolumes = getMatchingVolumes(
                  chapter.chapter_number,
                  volumes
                )
                return (
                  <tr
                    key={chapter.id}
                    className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
                  >
                    <td className="px-3 sm:px-4 py-2 font-mono text-white/40 align-top">
                      {String(chapter.chapter_number).padStart(3, '0')}
                    </td>
                    <td className="px-3 sm:px-4 py-2 align-top min-w-0">
                      <p className="text-white/80 normal-case break-words">
                        {chapter.title ?? `Chapter ${chapter.chapter_number}`}
                      </p>
                      {chapter.is_stubbed && (
                        <span className="inline-flex mt-1 text-[9px] font-black tracking-widest px-1.5 py-0.5 bg-amber-500/15 text-amber-300">
                          STUBBED
                        </span>
                      )}
                      <div className="mt-1 space-y-1 lg:hidden">
                        <p className="text-[10px] text-white/35 normal-case">
                          Published {fmtDate(chapter.publish_date)} · Fetched{' '}
                          {fmtDate(chapter.fetched_at)}
                        </p>
                        <p className="text-[10px] text-white/35 normal-case">
                          Words {fmtWords(chapter.word_count)} · Pages{' '}
                          {fmtPages(chapter.estimated_pages)} · Run{' '}
                          {fmtPages(
                            chapter.running_estimated_pages,
                            chapter.running_is_partial
                          )}
                        </p>
                        {matchingVolumes.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {matchingVolumes.map((volume) => (
                              <span
                                key={volume.id}
                                className="text-[9px] font-black tracking-widest px-1.5 py-0.5 bg-primary/10 text-primary"
                              >
                                {volume.name ??
                                  `Volume ${String(volume.volume_number).padStart(2, '0')}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-white/30 normal-case hidden sm:table-cell align-top">
                      {fmtDate(chapter.publish_date)}
                    </td>
                    <td className="px-4 py-2 text-white/30 normal-case hidden md:table-cell align-top">
                      {fmtDate(chapter.fetched_at)}
                    </td>
                    <td className="px-4 py-2 text-white/50 normal-case hidden lg:table-cell align-top">
                      {fmtWords(chapter.word_count)}
                    </td>
                    <td className="px-4 py-2 text-white/50 normal-case hidden lg:table-cell align-top">
                      {fmtPages(chapter.estimated_pages)}
                    </td>
                    <td className="px-4 py-2 text-white/50 normal-case hidden xl:table-cell align-top">
                      {fmtPages(
                        chapter.running_estimated_pages,
                        chapter.running_is_partial
                      )}
                    </td>
                    <td className="px-4 py-2 hidden lg:table-cell align-top">
                      {matchingVolumes.length === 0 ? (
                        <span className="text-white/25">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {matchingVolumes.map((volume) => (
                            <span
                              key={volume.id}
                              className="text-[9px] font-black tracking-widest px-1.5 py-0.5 bg-primary/10 text-primary"
                            >
                              {volume.name ??
                                `Volume ${String(volume.volume_number).padStart(2, '0')}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-2 sm:px-4 py-2 text-center align-top">
                      {chapter.has_content ? (
                        <CheckCircle2
                          size={13}
                          className="text-green-500 inline"
                        />
                      ) : (
                        <Circle size={13} className="text-white/20 inline" />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

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
      <p className="text-[10px] text-white/20 normal-case">
        * Running page totals are based on fetched chapters only and are marked
        partial when earlier chapters are still missing word counts.
      </p>
    </div>
  )
}
