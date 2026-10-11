import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import type { ZLibraryDomainCheck, ZLibraryDomains } from '../../types/api'

const input =
  'w-full border border-white/25 bg-black px-3 py-2 text-sm text-white focus:border-primary focus:outline-none'

type CheckState = ZLibraryDomainCheck | 'checking'

function errorText(err: unknown, fallback: string) {
  return (err as { data?: { detail?: string } }).data?.detail ?? fallback
}

/** Settings: pick the Z-Library domain, check which ones answer, add more. */
export default function ZLibrarySettings() {
  const [data, setData] = useState<ZLibraryDomains | null>(null)
  const [checks, setChecks] = useState<Record<string, CheckState>>({})
  const [newDomain, setNewDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = useCallback((domain: string) => {
    setChecks((c) => ({ ...c, [domain]: 'checking' }))
    api
      .get<ZLibraryDomainCheck>(
        `/api/zlibrary/domains/check?domain=${encodeURIComponent(domain)}`
      )
      .then((res) => {
        if (res) setChecks((c) => ({ ...c, [domain]: res }))
      })
      .catch(() =>
        setChecks((c) => ({
          ...c,
          [domain]: { domain, ok: false, ms: 0, error: 'Check failed' },
        }))
      )
  }, [])

  const checkAll = useCallback(
    (d: ZLibraryDomains) => d.domains.forEach((x) => check(x.domain)),
    [check]
  )

  useEffect(() => {
    api
      .get<ZLibraryDomains>('/api/zlibrary/domains')
      .then((d) => {
        if (!d || !Array.isArray(d.domains)) return
        setData(d)
        checkAll(d)
        // Then bring in Z-Library's current list, checking what's new.
        const known = new Set(d.domains.map((x) => x.domain))
        api
          .post<ZLibraryDomains>('/api/zlibrary/domains/refresh')
          .then((fresh) => {
            if (!fresh || !Array.isArray(fresh.domains)) return
            setData(fresh)
            fresh.domains
              .filter((x) => !known.has(x.domain))
              .forEach((x) => check(x.domain))
          })
          .catch(() => {
            // No domain answered: the stored list stays.
          })
      })
      .catch(() => setError('Could not load the Z-Library domains'))
  }, [check, checkAll])

  const run = async (fn: () => Promise<ZLibraryDomains | null>) => {
    setBusy(true)
    setError(null)
    try {
      const d = await fn()
      if (d) setData(d)
      return d
    } catch (err) {
      setError(errorText(err, 'Something went wrong'))
      return null
    } finally {
      setBusy(false)
    }
  }

  const select = (domain: string) =>
    run(() => api.put<ZLibraryDomains>('/api/zlibrary/domain', { domain }))

  const remove = (domain: string) =>
    run(() =>
      api.delete<ZLibraryDomains>(
        `/api/zlibrary/domains/${encodeURIComponent(domain)}`
      )
    )

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDomain.trim()) return
    const before = new Set(data?.domains.map((d) => d.domain))
    const d = await run(() =>
      api.post<ZLibraryDomains>('/api/zlibrary/domains', {
        domain: newDomain.trim(),
      })
    )
    if (d) {
      setNewDomain('')
      d.domains
        .filter((x) => !before.has(x.domain))
        .forEach((x) => check(x.domain))
    }
  }

  if (!data) {
    return error ? (
      <p className="text-sm text-red-400">{error}</p>
    ) : (
      <Loader2 size={14} className="animate-spin text-white/40" />
    )
  }

  return (
    <div className="space-y-4" data-testid="zlibrary-settings">
      {!data.enabled && (
        <p className="border border-white/[0.14] bg-white/[0.03] px-3 py-2 text-xs text-white/60">
          Z-Library is off until an account is set:{' '}
          <code className="text-white">SHELFLOOM_ZLIBRARY_EMAIL</code> and{' '}
          <code className="text-white">SHELFLOOM_ZLIBRARY_PASSWORD</code>.
        </p>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] font-semibold tracking-widest text-white/50">
            DOMAIN
          </p>
          <button
            onClick={() => checkAll(data)}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-white/50 hover:text-white"
          >
            <RefreshCw size={12} />
            Check again
          </button>
        </div>
        <ul className="border border-white/[0.14]">
          {data.domains.map((d) => {
            const selected = d.domain === data.selected
            const state = checks[d.domain]
            return (
              <li
                key={d.domain}
                className="flex items-center gap-3 border-b border-white/[0.08] px-3 py-2.5 last:border-0"
                data-testid="zlibrary-domain"
              >
                <button
                  onClick={() => !selected && select(d.domain)}
                  disabled={busy}
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Use ${d.domain}`}
                  className={`flex size-5 shrink-0 items-center justify-center border ${
                    selected
                      ? 'border-primary bg-primary text-white'
                      : 'border-white/30 hover:border-white'
                  }`}
                >
                  {selected && <Check size={12} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    {d.domain}
                    {selected && (
                      <span className="ml-2 text-[10px] font-semibold tracking-widest text-primary-400">
                        IN USE
                      </span>
                    )}
                  </p>
                  <p
                    className={`truncate text-xs ${
                      state === 'checking' || !state
                        ? 'text-white/40'
                        : state.ok
                          ? 'text-emerald-400'
                          : 'text-red-400'
                    }`}
                    data-testid="zlibrary-domain-status"
                  >
                    {state === 'checking' || !state
                      ? 'Checking…'
                      : state.ok
                        ? `Works · ${state.ms} ms`
                        : state.error}
                  </p>
                </div>
                {d.source !== 'custom' ? (
                  <span className="shrink-0 text-[10px] font-semibold tracking-widest text-white/30">
                    {d.source === 'official' ? 'OFFICIAL' : 'FROM Z-LIBRARY'}
                  </span>
                ) : (
                  <button
                    onClick={() => remove(d.domain)}
                    disabled={busy}
                    className="text-white/40 hover:text-red-400"
                    aria-label={`Remove ${d.domain}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {data.fetched_from && data.fetched_at && (
        <p className="text-xs text-white/45" data-testid="zlibrary-fetched">
          Z-Library’s own domain list, from {data.fetched_from},{' '}
          {new Date(data.fetched_at * 1000).toLocaleString()}.
        </p>
      )}

      <form onSubmit={add} className="grid grid-cols-[1fr_auto] gap-2">
        <input
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          placeholder="New domain, e.g. z-library.example"
          aria-label="New domain"
          autoComplete="off"
          autoCapitalize="none"
          className={input}
        />
        <button
          type="submit"
          disabled={busy || !newDomain.trim()}
          className="flex items-center gap-1.5 border border-white/25 px-3 text-xs font-semibold text-white/80 hover:bg-white hover:text-black disabled:opacity-40"
        >
          <Plus size={13} />
          Add
        </button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <p className="text-xs text-white/45">
        Z-Library moves domains now and then. When search stops working, pick
        one marked “Works”, or add a new one from Z-Library’s latest list.
      </p>
    </div>
  )
}
