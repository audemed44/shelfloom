import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bookmark,
  BookmarkCheck,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  SearchX,
  Settings as SettingsIcon,
  Sparkles,
  ThumbsDown,
  Trash2,
} from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { usePersistedState } from '../hooks/usePersistedState'
import { getBookCoverUrl } from '../utils/bookCover'
import { CoverImage } from '../components/shared/CoverFallback'
import ZLibraryModal from '../components/library/ZLibraryModal'
import PromptModal from '../components/recommendations/PromptModal'
import type {
  DiscoverKinds,
  Recommendation,
  RecommendationKind,
  RecommendationList,
  RecommendationRun,
  RecommendationsResponse,
  RecommendationVerdict,
  SavedRecommendation,
  ZLibraryStatus,
} from '../types/api'

type Tab = RecommendationKind | 'saved'

function errorText(err: unknown, fallback: string) {
  return (err as { data?: { detail?: string } }).data?.detail ?? fallback
}

function fmtWhen(iso: string | null) {
  if (!iso) return ''
  // Stored times are UTC without an offset.
  const d = new Date(iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtTokens(n: number | null) {
  if (n == null) return '–'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** One line on what the last refresh used. */
function RunInfo({ run }: { run: RecommendationRun | null }) {
  if (!run || run.status === 'running') return null
  const parts = [
    fmtWhen(run.finished_at ?? run.started_at),
    run.model,
    `${fmtTokens(run.input_tokens)} in / ${fmtTokens(run.output_tokens)} out`,
  ]
  if (run.web_search) parts.push(`${run.web_searches ?? 0} web searches`)
  if (run.cost != null)
    parts.push(`$${run.cost.toFixed(run.cost < 0.01 ? 4 : 3)}`)
  return (
    <p
      className="text-[11px] tabular-nums text-white/40"
      data-testid="run-info"
    >
      Last refresh: {parts.join(' · ')}
    </p>
  )
}

/** Where to look for a pick: Z-Library for books, the site for serials. */
function findLinks(
  item: {
    title: string
    author: string | null
    format: string
    site: string | null
    source_url: string | null
  },
  zlib: ZLibraryStatus | null,
  onZLib: (q: string) => void
) {
  const query = [item.title, item.author].filter(Boolean).join(' ')
  const links: React.ReactNode[] = []
  const linkClass =
    'inline-flex items-center gap-1 text-xs font-semibold text-primary-400 hover:text-white'
  const site = (item.site ?? '').toLowerCase()
  const source = item.source_url ?? ''
  // A Royal Road fiction page found by search is the link itself.
  const sourceIsFiction = /royalroad\.com\/fiction\/\d+/.test(source)
  if (item.format === 'web_serial') {
    if (site.includes('royal road') || sourceIsFiction) {
      const href = sourceIsFiction
        ? source
        : `https://www.royalroad.com/fictions/search?title=${encodeURIComponent(item.title)}`
      links.push(
        <a
          key="rr"
          href={href}
          target="_blank"
          rel="noreferrer"
          className={linkClass}
        >
          Royal Road <ExternalLink size={11} />
        </a>
      )
    } else if (site.includes('scribble')) {
      links.push(
        <a
          key="sh"
          href={`https://www.scribblehub.com/?s=${encodeURIComponent(item.title)}&post_type=fictionposts`}
          target="_blank"
          rel="noreferrer"
          className={linkClass}
        >
          Scribble Hub <ExternalLink size={11} />
        </a>
      )
    }
  } else if (zlib?.enabled) {
    links.push(
      <button
        key="zl"
        type="button"
        onClick={() => onZLib(query)}
        className={linkClass}
      >
        Find on Z-Library
      </button>
    )
  } else if (zlib) {
    links.push(
      <a
        key="zl"
        href={`https://${zlib.domain}/s/${encodeURIComponent(query)}`}
        target="_blank"
        rel="noreferrer"
        className={linkClass}
      >
        Z-Library <ExternalLink size={11} />
      </a>
    )
  }
  if (source && !(item.format === 'web_serial' && sourceIsFiction)) {
    let host = ''
    try {
      host = new URL(source).hostname.replace(/^www\./, '')
    } catch {
      host = ''
    }
    if (host) {
      links.push(
        <a
          key="src"
          href={source}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-white/45 hover:text-white"
        >
          via {host} <ExternalLink size={11} />
        </a>
      )
    }
  }
  return links
}

function FormatBadge({
  format,
  site,
}: {
  format: string
  site: string | null
}) {
  return (
    <span className="text-[10px] font-semibold tracking-widest text-white/40">
      {format === 'web_serial' ? 'WEB SERIAL' : 'BOOK'}
      {site ? ` · ${site.toUpperCase()}` : ''}
    </span>
  )
}

const actionClass =
  'inline-flex items-center gap-1.5 border border-white/20 px-2 py-1 text-[11px] font-semibold text-white/70 transition-colors hover:border-white hover:text-white disabled:opacity-40'

// ── Read next ──────────────────────────────────────────────────────────────

function ReadNextCard({
  item,
  index,
  busy,
  onVerdict,
}: {
  item: Recommendation
  index: number
  busy: boolean
  onVerdict: (item: Recommendation, v: RecommendationVerdict | null) => void
}) {
  const book = item.book
  if (!book) return null
  return (
    <li
      className="flex gap-4 border-t border-white/[0.14] py-4"
      data-testid="read-next-item"
    >
      <Link
        to={`/books/${book.id}`}
        className="book-cover relative aspect-[2/3] w-20 shrink-0 overflow-hidden bg-white/[0.04] sm:w-24"
      >
        <CoverImage
          src={getBookCoverUrl(book.id, book.cover_path)}
          title={item.title}
          author={item.author}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <span className="w-6 shrink-0 text-xs font-semibold tabular-nums text-primary-400">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0">
            <Link
              to={`/books/${book.id}`}
              className="text-base font-bold leading-snug text-white hover:text-primary-300"
            >
              {item.title}
            </Link>
            <p className="text-xs text-white/50">
              {[
                item.author,
                book.series_name &&
                  `${book.series_name}${book.series_sequence != null ? ` #${book.series_sequence}` : ''}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <p className="mt-2 text-sm text-white/75 sm:pl-9">{item.reason}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-9">
          <Link to={`/books/${book.id}/read`} className={actionClass}>
            Read
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={() => onVerdict(item, 'not_interested')}
            className={actionClass}
          >
            <ThumbsDown size={12} /> Not for me
          </button>
        </div>
      </div>
    </li>
  )
}

// ── Discover ───────────────────────────────────────────────────────────────

function DiscoverItem({
  item,
  index,
  busy,
  zlib,
  onZLib,
  onVerdict,
}: {
  item: Recommendation
  index: number
  busy: boolean
  zlib: ZLibraryStatus | null
  onZLib: (q: string) => void
  onVerdict: (item: Recommendation, v: RecommendationVerdict | null) => void
}) {
  const saved = item.feedback === 'saved'
  return (
    <li
      className="border-t border-white/[0.14] py-4"
      data-testid="discover-item"
    >
      <div className="flex items-baseline gap-3">
        <span className="w-6 shrink-0 text-xs font-semibold tabular-nums text-primary-400">
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <FormatBadge format={item.format} site={item.site} />
          <p className="text-base font-bold leading-snug text-white">
            {item.title}
          </p>
          {item.author && (
            <p className="text-xs text-white/50">{item.author}</p>
          )}
          <p className="mt-2 text-sm text-white/75">{item.reason}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {findLinks(item, zlib, onZLib)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onVerdict(item, saved ? null : 'saved')}
              className={`${actionClass} ${saved ? 'border-primary bg-primary text-white hover:text-white' : ''}`}
              aria-pressed={saved}
            >
              {saved ? <BookmarkCheck size={12} /> : <Bookmark size={12} />}
              {saved ? 'Saved' : 'Save'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onVerdict(item, 'already_read')}
              className={actionClass}
            >
              <Check size={12} /> Read it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onVerdict(item, 'not_interested')}
              className={actionClass}
            >
              <ThumbsDown size={12} /> Not for me
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onVerdict(item, 'not_found')}
              className={actionClass}
              title="The book doesn't seem to exist, or the author is wrong"
            >
              <SearchX size={12} /> Doesn’t exist
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}

const KINDS: { value: DiscoverKinds; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'books', label: 'Books' },
  { value: 'web_serials', label: 'Web serials' },
]

const VERDICT_TEXT: Record<RecommendationVerdict, string> = {
  not_interested: 'Won’t be suggested again',
  already_read: 'Counted as read',
  not_found: 'Marked as not existing',
  saved: 'Saved',
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function Recommendations() {
  const [data, setData] = useState<RecommendationsResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = usePersistedState<Tab>(
    'shelfloom:recs-tab',
    'read_next'
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    item: Recommendation
    verdict: RecommendationVerdict
  } | null>(null)
  const [zlibQuery, setZlibQuery] = useState<string | null>(null)
  const [promptKind, setPromptKind] = useState<RecommendationKind | null>(null)
  const { data: zlib } = useApi<ZLibraryStatus>('/api/zlibrary/status')

  const load = useCallback(async () => {
    try {
      const d = await api.get<RecommendationsResponse>('/api/recommendations')
      if (d) setData(d)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err, 'Could not load recommendations'))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const running = !!data && (data.read_next.running || data.discover.running)
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(load, 3000)
    return () => window.clearInterval(id)
  }, [running, load])

  const refresh = async (kind: RecommendationKind | 'all') => {
    setError(null)
    try {
      await api.post('/api/recommendations/refresh', { kind })
      await load()
    } catch (err) {
      setError(errorText(err, 'Could not start a refresh'))
    }
  }

  const verdict = async (
    item: Recommendation,
    v: RecommendationVerdict | null
  ) => {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/api/recommendations/${item.id}/feedback`, { verdict: v })
      setNotice(v ? { item, verdict: v } : null)
      await load()
    } catch (err) {
      setError(errorText(err, 'Could not save that'))
    } finally {
      setBusy(false)
    }
  }

  const removeSaved = async (s: SavedRecommendation) => {
    setBusy(true)
    try {
      await api.delete(`/api/recommendations/feedback/${s.id}`)
      await load()
    } catch (err) {
      setError(errorText(err, 'Could not remove it'))
    } finally {
      setBusy(false)
    }
  }

  const setKinds = async (k: DiscoverKinds) => {
    if (!data) return
    setData({ ...data, settings: { ...data.settings, discover_kinds: k } })
    try {
      await api.put('/api/recommendations/settings', { discover_kinds: k })
    } catch (err) {
      setError(errorText(err, 'Could not save that'))
      load()
    }
  }

  // Picks turned down (or read, or not found) drop out of the list.
  const visible = useCallback(
    (list: RecommendationList | undefined) =>
      (list?.items ?? []).filter((i) => !i.feedback || i.feedback === 'saved'),
    []
  )
  const readNext = useMemo(() => visible(data?.read_next), [data, visible])
  const discover = useMemo(() => visible(data?.discover), [data, visible])

  if (!data) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-12">
        {loadError ? (
          <p className="text-sm text-red-400">{loadError}</p>
        ) : (
          <Loader2 className="animate-spin text-white/40" />
        )}
      </div>
    )
  }

  const current: RecommendationList | null =
    tab === 'saved'
      ? null
      : tab === 'read_next'
        ? data.read_next
        : data.discover
  const lastError = current?.run?.status === 'error' ? current.run.error : null

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6 lg:px-12 lg:py-10">
      <header className="mb-8 grid grid-cols-12 gap-4 sm:mb-10">
        <div className="col-span-12 lg:col-span-8">
          <h1 className="text-[3.25rem] font-extrabold leading-[0.9] tracking-tighter sm:text-8xl">
            For you<span className="text-primary">.</span>
          </h1>
        </div>
        <div className="col-span-12 flex flex-col justify-end gap-2 lg:col-span-4 lg:border-l lg:border-white/[0.14] lg:pl-4">
          <p className="text-sm text-white/60">
            Picked by {data.settings.model} from your ratings and reading time.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => refresh('all')}
              disabled={!data.enabled || running}
              className="inline-flex items-center gap-2 bg-white px-3 py-2 text-xs font-bold text-black transition-colors hover:bg-primary hover:text-white disabled:opacity-40"
              data-testid="refresh-all"
            >
              {running ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              {running ? 'Picking…' : 'Refresh both'}
            </button>
            <Link
              to="/settings"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/50 hover:text-white"
            >
              <SettingsIcon size={13} /> Settings
            </Link>
          </div>
        </div>
      </header>

      {!data.enabled && (
        <p
          className="mb-8 border border-white/[0.14] bg-white/[0.03] px-4 py-3 text-sm text-white/70"
          data-testid="recs-disabled"
        >
          Recommendations need an OpenRouter API key: set{' '}
          <code className="text-white">OPENROUTER_API_KEY</code> for Shelfloom
          and restart it.
        </p>
      )}

      {/* Tabs */}
      <div className="mb-6 flex border-b border-white/[0.14]" role="tablist">
        {(
          [
            ['read_next', 'Read next', null],
            ['discover', 'Discover', null],
            ['saved', 'Saved', data.saved.length],
          ] as [Tab, string, number | null][]
        ).map(([value, label, count]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors sm:px-4 ${
              tab === value
                ? 'border-primary text-white'
                : 'border-transparent text-white/50 hover:text-white'
            }`}
          >
            {label}
            {count ? (
              <span className="ml-1.5 tabular-nums text-white/40">{count}</span>
            ) : null}
          </button>
        ))}
      </div>

      {current && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-white/50">
            {tab === 'read_next'
              ? 'From the unread books in your library.'
              : 'Titles you don’t have yet. Saving or turning one down shapes the next refresh.'}
          </p>
          <div className="flex items-center gap-3">
            {tab === 'discover' && (
              <div
                className="flex border border-white/20"
                role="radiogroup"
                aria-label="What to discover"
              >
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    role="radio"
                    aria-checked={data.settings.discover_kinds === k.value}
                    onClick={() => setKinds(k.value)}
                    className={`px-2.5 py-1 text-[11px] font-semibold ${
                      data.settings.discover_kinds === k.value
                        ? 'bg-white text-black'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setPromptKind(tab as RecommendationKind)}
              className="inline-flex items-center gap-1.5 border border-white/25 px-2.5 py-1 text-[11px] font-semibold text-white/80 hover:bg-white hover:text-black"
              data-testid="view-prompt"
            >
              <FileText size={12} />
              Prompt
            </button>
            <button
              type="button"
              onClick={() => refresh(tab as RecommendationKind)}
              disabled={!data.enabled || current.running}
              className="inline-flex items-center gap-1.5 border border-white/25 px-2.5 py-1 text-[11px] font-semibold text-white/80 hover:bg-white hover:text-black disabled:opacity-40"
              data-testid="refresh-tab"
            >
              <RefreshCw
                size={12}
                className={current.running ? 'animate-spin' : ''}
              />
              Refresh
            </button>
          </div>
        </div>
      )}

      {current?.running && (
        <p
          className="mb-4 flex items-center gap-2 border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-white/80"
          data-testid="recs-running"
        >
          <Loader2 size={14} className="animate-spin text-primary-400" />
          {tab === 'discover' && data.settings.web_search
            ? 'Picking and searching the web… this can take a minute or two.'
            : 'Picking… this takes a few seconds.'}
        </p>
      )}
      {lastError && !current?.running && (
        <p
          className="mb-4 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          data-testid="recs-error"
        >
          The last refresh failed: {lastError}
        </p>
      )}
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {notice && (
        <div className="mb-4 flex items-center justify-between gap-3 border border-white/[0.14] px-4 py-2 text-sm text-white/70">
          <span>
            <span className="font-semibold text-white">
              {notice.item.title}
            </span>
            : {VERDICT_TEXT[notice.verdict]}.
          </span>
          <button
            type="button"
            onClick={() => verdict(notice.item, null)}
            disabled={busy}
            className="text-xs font-semibold text-primary-400 hover:text-white"
          >
            Undo
          </button>
        </div>
      )}

      {tab === 'read_next' && (
        <>
          {readNext.length > 0 ? (
            <ol>
              {readNext.map((item, i) => (
                <ReadNextCard
                  key={item.id}
                  item={item}
                  index={i}
                  busy={busy}
                  onVerdict={verdict}
                />
              ))}
            </ol>
          ) : (
            !current?.running && (
              <Empty
                enabled={data.enabled}
                onRefresh={() => refresh('read_next')}
              />
            )
          )}
          <RunInfo run={data.read_next.run} />
        </>
      )}

      {tab === 'discover' && (
        <>
          {discover.length > 0 ? (
            <ol>
              {discover.map((item, i) => (
                <DiscoverItem
                  key={item.id}
                  item={item}
                  index={i}
                  busy={busy}
                  zlib={zlib}
                  onZLib={setZlibQuery}
                  onVerdict={verdict}
                />
              ))}
            </ol>
          ) : (
            !current?.running && (
              <Empty
                enabled={data.enabled}
                onRefresh={() => refresh('discover')}
              />
            )
          )}
          <RunInfo run={data.discover.run} />
        </>
      )}

      {tab === 'saved' &&
        (data.saved.length > 0 ? (
          <ol>
            {data.saved.map((s) => (
              <li
                key={s.id}
                className="border-t border-white/[0.14] py-4"
                data-testid="saved-item"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <FormatBadge format={s.format} site={s.site} />
                    <p className="text-base font-bold leading-snug text-white">
                      {s.title}
                    </p>
                    {s.author && (
                      <p className="text-xs text-white/50">{s.author}</p>
                    )}
                    {s.reason && (
                      <p className="mt-2 text-sm text-white/75">{s.reason}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                      {findLinks(s, zlib, setZlibQuery)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSaved(s)}
                    disabled={busy}
                    aria-label={`Remove ${s.title}`}
                    className="text-white/40 hover:text-red-400"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="border-t border-white/[0.14] py-8 text-sm text-white/50">
            Nothing saved yet. Save picks from Discover to keep them here.
          </p>
        ))}

      {promptKind && (
        <PromptModal kind={promptKind} onClose={() => setPromptKind(null)} />
      )}
      {zlibQuery != null && (
        <ZLibraryModal
          initialQuery={zlibQuery}
          onClose={() => setZlibQuery(null)}
          onAdded={() => undefined}
        />
      )}
    </div>
  )
}

function Empty({
  enabled,
  onRefresh,
}: {
  enabled: boolean
  onRefresh: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-3 border-t border-white/[0.14] py-8">
      <Sparkles size={18} className="text-primary-400" />
      <p className="text-sm text-white/60">
        No picks yet.
        {enabled ? ' Refresh to get some — it costs a cent or so.' : ''}
      </p>
      {enabled && (
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 bg-white px-3 py-2 text-xs font-bold text-black hover:bg-primary hover:text-white"
        >
          <RefreshCw size={13} /> Get picks
        </button>
      )}
    </div>
  )
}
