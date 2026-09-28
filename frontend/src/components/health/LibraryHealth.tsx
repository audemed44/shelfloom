import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Fingerprint,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { api } from '../../api/client'

export interface HealthBook {
  id: string
  title: string
  author: string | null
  format: string | null
  cover_path: string | null
  detail: string | null
}

export interface HealthIssue {
  key: string
  severity: 'error' | 'warning' | 'info'
  title: string
  ok_title: string
  description: string
  count: number
  books: HealthBook[]
}

interface HealthLink {
  key: string
  severity: string
  title: string
  count: number
  tab: string
}

export interface HealthReport {
  checked_at: string
  total_books: number
  issues: HealthIssue[]
  links: HealthLink[]
}

const SEVERITY_DOT: Record<string, string> = {
  error: 'bg-accent',
  warning: 'bg-primary',
  info: 'bg-white/40',
}

const btn =
  'flex items-center gap-2 border border-white/25 px-3 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white hover:text-black disabled:opacity-40'
const primaryBtn =
  'flex items-center gap-2 bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-40'

const PREVIEW_LIMIT = 12

/** Cover previews rendered by Shelfloom for books that have none. */
function CoverGrid({
  books,
  busy,
  onUse,
  version,
}: {
  books: HealthBook[]
  busy: string | null
  onUse: (id: string) => void
  version: number
}) {
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? books : books.slice(0, PREVIEW_LIMIT)
  return (
    <>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {shown.map((b) => (
          <li key={b.id} className="min-w-0" data-testid="cover-preview">
            <Link to={`/books/${b.id}`} className="block">
              <img
                src={`/api/books/${b.id}/generated-cover?v=${version}`}
                alt={`Generated cover for ${b.title}`}
                loading="lazy"
                className="aspect-[2/3] w-full bg-white/5 object-cover"
              />
            </Link>
            <p className="mt-1.5 truncate text-xs font-semibold text-white">
              {b.title}
            </p>
            <button
              onClick={() => onUse(b.id)}
              disabled={busy !== null}
              className="mt-1 text-[11px] font-semibold text-primary-400 hover:underline disabled:opacity-40"
            >
              {busy === b.id ? 'Saving…' : 'Use this cover'}
            </button>
          </li>
        ))}
      </ul>
      {books.length > PREVIEW_LIMIT && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-3 text-xs font-semibold text-white/60 hover:text-white"
        >
          Show all {books.length}
        </button>
      )}
    </>
  )
}

function BookList({ books, total }: { books: HealthBook[]; total: number }) {
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? books : books.slice(0, 8)
  return (
    <>
      <ul className="border border-white/[0.14]">
        {shown.map((b) => (
          <li
            key={b.id}
            className="flex items-center gap-3 border-b border-white/[0.08] px-3 py-2 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <Link
                to={`/books/${b.id}`}
                className="block truncate text-sm font-semibold text-white hover:underline"
              >
                {b.title}
              </Link>
              <p className="truncate text-xs text-white/45">
                {b.detail ?? b.author ?? 'Unknown author'}
              </p>
            </div>
            <ArrowRight size={13} className="shrink-0 text-white/30" />
          </li>
        ))}
      </ul>
      {(books.length > shown.length || total > books.length) && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs font-semibold text-white/60 hover:text-white"
        >
          {showAll
            ? `Showing the first ${books.length} of ${total}`
            : `Show all ${Math.min(total, books.length)}`}
        </button>
      )}
    </>
  )
}

/** Library Health tab: problems worth fixing, with fixes where Shelfloom can do them. */
export default function LibraryHealth({
  onOpenTab,
}: {
  onOpenTab: (tab: string) => void
}) {
  const [report, setReport] = useState<HealthReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [embed, setEmbed] = useState(true)
  const [coverVersion, setCoverVersion] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<HealthReport>('/api/library-health')
      if (!res || !Array.isArray(res.issues)) throw new Error('bad report')
      setReport({ ...res, links: Array.isArray(res.links) ? res.links : [] })
    } catch {
      setMessage('Could not run the health check')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key)
    setMessage(null)
    try {
      setMessage(await action())
      setCoverVersion((v) => v + 1)
      await load()
    } catch {
      setMessage('That didn’t work; try again')
    } finally {
      setBusy(null)
    }
  }

  const generateAll = (issue: HealthIssue) =>
    run(`all-${issue.key}`, async () => {
      const res = await api.post<{ generated: number; failed: number }>(
        '/api/library-health/generate-covers',
        {
          book_ids:
            issue.key === 'no_cover' ? null : issue.books.map((b) => b.id),
          embed,
        }
      )
      const n = res?.generated ?? 0
      return `Made ${n} cover${n === 1 ? '' : 's'}${
        res?.failed ? `; ${res.failed} failed` : ''
      }.`
    })

  const saveOne = (id: string) =>
    run(id, async () => {
      await api.post(`/api/books/${id}/generate-cover`, { embed })
      return 'Cover saved.'
    })

  if (!report) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-white/50">
        {loading ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Checking every book…
          </>
        ) : (
          message
        )}
      </div>
    )
  }

  const problems = report.issues.filter((i) => i.count > 0)
  const passed = report.issues.filter(
    (i) => i.count === 0 && i.key !== 'generated_cover'
  )
  const links = report.links.filter((l) => l.count > 0)

  return (
    <div className="space-y-8" data-testid="library-health">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/60">
          Checked {report.total_books} book{report.total_books === 1 ? '' : 's'}
          {problems.filter((p) => p.severity !== 'info').length === 0 &&
            links.length === 0 && (
              <span className="ml-2 inline-flex items-center gap-1 font-semibold text-white">
                <CheckCircle2 size={14} className="text-primary-400" />
                Everything looks good
              </span>
            )}
        </p>
        <button onClick={() => void load()} disabled={loading} className={btn}>
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          Check again
        </button>
      </div>

      {message && (
        <p className="border border-white/25 px-3 py-2 text-sm text-white/80">
          {message}
        </p>
      )}

      {problems.map((issue) => (
        <section
          key={issue.key}
          className="border-t-2 border-white pt-4"
          data-testid={`health-${issue.key}`}
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
                <span className={`size-2 ${SEVERITY_DOT[issue.severity]}`} />
                {issue.title}
                <span className="text-sm font-semibold tabular-nums text-white/45">
                  {issue.count}
                </span>
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-white/55">
                {issue.description}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {issue.key === 'missing_file' && (
                <button
                  className={btn}
                  disabled={busy !== null}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${issue.count} book${issue.count === 1 ? '' : 's'} whose file is gone? Their reading history is removed too.`
                      )
                    )
                      void run(issue.key, async () => {
                        const res = await api.post<{ removed: number }>(
                          '/api/library-health/remove-missing',
                          { book_ids: issue.books.map((b) => b.id) }
                        )
                        return `Removed ${res?.removed ?? 0} record(s).`
                      })
                  }}
                >
                  <Trash2 size={12} />
                  Remove from library
                </button>
              )}
              {issue.key === 'no_fingerprint' && (
                <button
                  className={primaryBtn}
                  disabled={busy !== null}
                  onClick={() =>
                    void run(issue.key, async () => {
                      const res = await api.post<{ updated: number }>(
                        '/api/library-health/fingerprints'
                      )
                      return `Recorded ${res?.updated ?? 0} fingerprint(s).`
                    })
                  }
                >
                  <Fingerprint size={12} />
                  Record fingerprints
                </button>
              )}
              {(issue.key === 'no_cover' ||
                issue.key === 'generated_cover') && (
                <button
                  className={issue.key === 'no_cover' ? primaryBtn : btn}
                  disabled={busy !== null}
                  onClick={() => void generateAll(issue)}
                  data-testid={`generate-${issue.key}`}
                >
                  {busy === `all-${issue.key}` ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Sparkles size={12} />
                  )}
                  {issue.key === 'no_cover'
                    ? `Make ${issue.count} cover${issue.count === 1 ? '' : 's'}`
                    : 'Regenerate all'}
                </button>
              )}
            </div>
          </div>

          {issue.key === 'no_cover' || issue.key === 'generated_cover' ? (
            <>
              {issue.key === 'no_cover' && (
                <label className="mb-3 flex items-start gap-2.5 text-sm text-white/70">
                  <input
                    type="checkbox"
                    checked={embed}
                    onChange={(e) => setEmbed(e.target.checked)}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    Also write the cover into the EPUB file, so it shows on your
                    e-reader (KOReader sync keeps working)
                  </span>
                </label>
              )}
              <CoverGrid
                books={issue.books}
                busy={busy}
                onUse={(id) => void saveOne(id)}
                version={coverVersion}
              />
            </>
          ) : (
            <BookList books={issue.books} total={issue.count} />
          )}
        </section>
      ))}

      {links.map((link) => (
        <section
          key={link.key}
          className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-white pt-4"
        >
          <h3 className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
            <AlertTriangle size={15} className="text-primary-400" />
            {link.title}
            <span className="text-sm font-semibold tabular-nums text-white/45">
              {link.count}
            </span>
          </h3>
          <button className={btn} onClick={() => onOpenTab(link.tab)}>
            Review <ArrowRight size={12} />
          </button>
        </section>
      ))}

      {passed.length > 0 && (
        <section className="border-t border-white/[0.14] pt-4">
          <p className="mb-2 text-[10px] font-semibold tracking-widest text-white/40">
            PASSED
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
            {passed.map((i) => (
              <li key={i.key} className="flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-primary-400" />
                {i.ok_title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
