import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Loader2, Plus, Trash2 } from 'lucide-react'
import { api } from '../../api/client'

interface SyncAccount {
  username: string
  last_synced_at: number | null
  last_device: string | null
  last_book_title: string | null
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

const input =
  'w-full border border-white/25 bg-black px-3 py-2 text-sm text-white focus:border-primary focus:outline-none'

/** Settings: connect KOReader's built-in Progress sync to Shelfloom. */
export default function KoreaderSync() {
  const serverUrl = `${window.location.origin}/api/kosync`
  const [accounts, setAccounts] = useState<SyncAccount[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .get<SyncAccount[]>('/api/sync-accounts')
      .then((a) => setAccounts(Array.isArray(a) ? a : []))
      .catch(() => setAccounts([]))
  }, [])

  useEffect(load, [load])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serverUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (e.g. plain http): the address is selectable.
    }
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setSaving(true)
    setError(null)
    try {
      await api.post('/api/sync-accounts', {
        username: username.trim(),
        password,
      })
      setUsername('')
      setPassword('')
      load()
    } catch (err) {
      const e = err as { data?: { detail?: string } }
      setError(e.data?.detail ?? 'Could not create the account')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (name: string) => {
    if (
      !window.confirm(
        `Delete the sync account "${name}"? KOReader devices signed in with it stop syncing.`
      )
    )
      return
    await api.delete(`/api/sync-accounts/${encodeURIComponent(name)}`)
    load()
  }

  return (
    <div className="space-y-6" data-testid="koreader-sync">
      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-widest text-white/50">
          CUSTOM SYNC SERVER ADDRESS
        </p>
        <div className="flex items-stretch">
          <code
            className="flex-1 select-all truncate border border-white/25 bg-white/[0.03] px-3 py-2 text-sm text-white"
            data-testid="kosync-url"
          >
            {serverUrl}
          </code>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 border border-l-0 border-white/25 px-3 text-xs font-semibold text-white/80 hover:bg-white hover:text-black"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <ol className="space-y-2 text-sm text-white/70">
        <li>
          <span className="mr-2 font-semibold tabular-nums text-primary-400">
            1
          </span>
          In KOReader, open a book, then{' '}
          <b className="text-white">
            Tools → Progress sync → Custom sync server
          </b>{' '}
          and enter the address above.
        </li>
        <li>
          <span className="mr-2 font-semibold tabular-nums text-primary-400">
            2
          </span>
          Choose <b className="text-white">Register / Login</b> and log in with
          an account below (or register a new one from KOReader).
        </li>
        <li>
          <span className="mr-2 font-semibold tabular-nums text-primary-400">
            3
          </span>
          Turn on{' '}
          <b className="text-white">Automatically keep documents in sync</b>.
          Under <b className="text-white">Sync behavior</b>, “Sync to a newer
          state: Silently” and “Sync to an older state: Prompt” work well. Leave{' '}
          <b className="text-white">Document matching method</b> on Binary.
        </li>
      </ol>
      <p className="text-xs text-white/45">
        Books are matched by their file, so this works with files copied to the
        device by Syncthing, USB or OPDS. Positions also carry over when a book
        is rebuilt or re-imported. Reading in Shelfloom&rsquo;s web reader syncs
        the same way.
      </p>

      <div>
        <p className="mb-2 text-[10px] font-semibold tracking-widest text-white/50">
          ACCOUNTS
        </p>
        {accounts == null ? (
          <Loader2 size={14} className="animate-spin text-white/40" />
        ) : accounts.length === 0 ? (
          <p className="text-sm text-white/45">No accounts yet.</p>
        ) : (
          <ul className="border border-white/[0.14]">
            {accounts.map((a) => (
              <li
                key={a.username}
                className="flex items-center gap-3 border-b border-white/[0.08] px-3 py-2.5 last:border-0"
                data-testid="sync-account"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">
                    {a.username}
                  </p>
                  <p className="truncate text-xs text-white/45">
                    {a.last_synced_at
                      ? `${a.last_device ?? 'A device'} · ${
                          a.last_book_title ?? 'a book not in the library'
                        } · ${timeAgo(a.last_synced_at)}`
                      : 'Not synced yet'}
                  </p>
                </div>
                <button
                  onClick={() => remove(a.username)}
                  className="text-white/40 hover:text-red-400"
                  aria-label={`Delete ${a.username}`}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={create}
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
        >
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            aria-label="Username"
            autoComplete="off"
            className={input}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            autoComplete="new-password"
            className={input}
          />
          <button
            type="submit"
            disabled={saving || !username.trim() || !password}
            className="flex items-center justify-center gap-2 bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-40"
          >
            {saving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Plus size={12} />
            )}
            Add account
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  )
}
