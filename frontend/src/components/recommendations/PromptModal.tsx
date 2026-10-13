import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Copy, Loader2, X } from 'lucide-react'
import { api } from '../../api/client'
import type { RecommendationKind, RecommendationPrompt } from '../../types/api'

interface Props {
  kind: RecommendationKind
  onClose: () => void
}

/** Copies text, also where the Clipboard API is missing (plain http). */
async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}

/** The request body OpenRouter gets, as a refresh sends it. */
function requestBody(p: RecommendationPrompt) {
  const body: Record<string, unknown> = {
    model: p.model,
    messages: [
      { role: 'system', content: p.system },
      { role: 'user', content: p.user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: p.kind, strict: true, schema: p.schema },
    },
    provider: { require_parameters: true },
  }
  if (p.tools) body.tools = p.tools
  return JSON.stringify(body, null, 2)
}

const KIND_LABEL: Record<RecommendationKind, string> = {
  read_next: 'Read next',
  discover: 'Discover',
}

/** Shows exactly what a refresh would send now, with copy buttons. */
export default function PromptModal({ kind, onClose }: Props) {
  const [prompt, setPrompt] = useState<RecommendationPrompt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [showRequest, setShowRequest] = useState(false)

  useEffect(() => {
    api
      .get<RecommendationPrompt>(`/api/recommendations/prompt?kind=${kind}`)
      .then((p) => setPrompt(p))
      .catch((err) =>
        setError(
          (err as { data?: { detail?: string } }).data?.detail ??
            'Could not build the prompt'
        )
      )
  }, [kind])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const copy = async (what: string, text: string) => {
    try {
      await copyText(text)
      setCopied(what)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('Could not copy; select the text instead')
    }
  }

  const copyButton = (what: string, label: string, text: () => string) => (
    <button
      type="button"
      onClick={() => copy(what, text())}
      disabled={!prompt}
      className="inline-flex items-center gap-1.5 border border-white/25 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white hover:text-black disabled:opacity-40"
    >
      {copied === what ? <Check size={13} /> : <Copy size={13} />}
      {copied === what ? 'Copied' : label}
    </button>
  )

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/80 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="animate-scale-in relative flex w-full max-w-4xl flex-col overflow-hidden border border-white/10 bg-ink-900 sm:max-h-[90vh]"
        role="dialog"
        aria-label={`${KIND_LABEL[kind]} prompt`}
        data-testid="prompt-modal"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-8 sm:py-5">
          <div className="min-w-0">
            <h2 className="text-sm font-black uppercase tracking-widest text-white">
              {KIND_LABEL[kind]} prompt
            </h2>
            {prompt && (
              <p
                className="mt-0.5 text-xs text-white/45"
                data-testid="prompt-meta"
              >
                {prompt.model} · about{' '}
                {(prompt.approx_tokens / 1000).toFixed(1)}k tokens ·{' '}
                {prompt.web_search ? 'web search on' : 'no web search'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-white/50 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-8">
          {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
          {!prompt && !error && (
            <Loader2 className="animate-spin text-white/40" />
          )}
          {prompt && (
            <div className="space-y-5">
              <p className="text-xs text-white/50">
                This is what a refresh would send right now, built from your
                library as it is. The answer format and web search settings
                below go with it.
              </p>
              <section>
                <p className="mb-1.5 text-[10px] font-semibold tracking-widest text-white/50">
                  SYSTEM
                </p>
                <pre className="whitespace-pre-wrap break-words border border-white/10 bg-black p-3 font-mono text-xs leading-relaxed text-white/80">
                  {prompt.system}
                </pre>
              </section>
              <section>
                <p className="mb-1.5 text-[10px] font-semibold tracking-widest text-white/50">
                  USER
                </p>
                <pre
                  className="whitespace-pre-wrap break-words border border-white/10 bg-black p-3 font-mono text-xs leading-relaxed text-white/80"
                  data-testid="prompt-user"
                >
                  {prompt.user}
                </pre>
              </section>
              <section>
                <button
                  type="button"
                  onClick={() => setShowRequest((v) => !v)}
                  className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-white/50 hover:text-white"
                  aria-expanded={showRequest}
                >
                  <ChevronDown
                    size={12}
                    className={showRequest ? '' : '-rotate-90'}
                  />
                  FULL REQUEST (ANSWER FORMAT, WEB SEARCH)
                </button>
                {showRequest && (
                  <pre className="mt-1.5 whitespace-pre-wrap break-words border border-white/10 bg-black p-3 font-mono text-xs leading-relaxed text-white/70">
                    {requestBody(prompt)}
                  </pre>
                )}
              </section>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-3 sm:px-8">
          {copyButton(
            'prompt',
            'Copy prompt',
            () => `${prompt!.system}\n\n${prompt!.user}`
          )}
          {copyButton('request', 'Copy full request', () =>
            requestBody(prompt!)
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
