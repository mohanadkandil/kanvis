'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { DOMEditOp } from '@kanvis/core'
import { decodeEdits, encodeEdits } from '@/lib/url-hash'

const PROXY_BASE = process.env.NEXT_PUBLIC_PROXY_BASE ?? 'http://localhost:8787'

type IncomingMessage =
  | { type: 'kanvis:ready' }
  | { type: 'kanvis:hover'; selector: string }
  | { type: 'kanvis:select'; selector: string; tagName: string; classes: string[] }
  | { type: 'kanvis:edit'; op: DOMEditOp }

type Selection = { selector: string; tagName: string; classes: string[] }

export default function EditorClient() {
  const params = useSearchParams()
  const router = useRouter()
  const targetUrl = params.get('url') ?? ''

  const [edits, setEdits] = useState<DOMEditOp[]>([])
  const [selected, setSelected] = useState<Selection | null>(null)
  const [ready, setReady] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [aiPending, setAiPending] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [editsOpen, setEditsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  const proxiedSrc = useMemo(() => {
    if (!targetUrl) return ''
    return `${PROXY_BASE}/?url=${encodeURIComponent(targetUrl)}`
  }, [targetUrl])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash.slice(1)
    if (hash.startsWith('edits=')) {
      try {
        setEdits(decodeEdits(hash.slice('edits='.length)))
      } catch {
        // ignore corrupt hash
      }
    }
  }, [])

  useEffect(() => {
    function onMessage(e: MessageEvent<IncomingMessage>) {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      const msg = e.data
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return

      switch (msg.type) {
        case 'kanvis:ready':
          setReady(true)
          if (edits.length > 0 && iframeRef.current.contentWindow) {
            iframeRef.current.contentWindow.postMessage(
              { type: 'kanvis:replay', edits },
              '*',
            )
          }
          break
        case 'kanvis:select':
          setSelected({ selector: msg.selector, tagName: msg.tagName, classes: msg.classes })
          // Auto-focus the prompt input when something gets selected.
          requestAnimationFrame(() => promptRef.current?.focus())
          break
        case 'kanvis:edit':
          setEdits((prev) => [...prev, msg.op])
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [edits])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window === 'undefined') return
      const encoded = encodeEdits(edits)
      const newHash = encoded ? `#edits=${encoded}` : ''
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${newHash}`)
    }, 300)
    return () => clearTimeout(timer)
  }, [edits])

  async function submitPrompt() {
    if (!prompt.trim() || aiPending) return
    if (!selected) {
      setAiError('Click an element on the page first.')
      return
    }

    setAiPending(true)
    setAiError(null)

    // Hard timeout — guarantees the UI recovers even if the backend hangs.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort('client_timeout'), 25_000)

    console.log('[chat] →', { selector: selected.selector, prompt: prompt.trim() })

    try {
      const resp = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          selector: selected.selector,
          tagName: selected.tagName,
          currentClasses: selected.classes,
          prompt: prompt.trim(),
        }),
        signal: controller.signal,
      })
      console.log('[chat] response status:', resp.status)
      const data = await resp.json()
      console.log('[chat] response body:', data)

      if (!data.ok) {
        setAiError(data.error || 'AI request failed')
        return
      }
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'kanvis:apply-class', selector: selected.selector, before: data.before, after: data.after },
        '*',
      )
      setPrompt('')
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      const msg = aborted ? 'timed out after 25s' : e instanceof Error ? e.message : 'unknown error'
      console.error('[chat] error:', msg, e)
      setAiError(msg)
    } finally {
      clearTimeout(timeoutId)
      setAiPending(false)
    }
  }

  function copyShare() {
    if (typeof window === 'undefined') return
    void navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function clearEdits() {
    if (edits.length === 0) return
    if (!confirm(`Clear all ${edits.length} edit${edits.length === 1 ? '' : 's'}?`)) return
    setEdits([])
    iframeRef.current?.contentWindow?.postMessage({ type: 'kanvis:reset' }, '*')
  }

  if (!targetUrl) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-neutral-500">No URL provided.</p>
          <button onClick={() => router.push('/')} className="mt-3 text-sm underline">
            Back to landing
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#fafaf9] dark:bg-neutral-950">
      {/* Top bar */}
      <header className="absolute inset-x-0 top-0 z-40 flex h-12 items-center gap-3 border-b border-neutral-200/70 bg-white/80 px-4 backdrop-blur dark:border-neutral-800/80 dark:bg-neutral-950/80">
        <button
          onClick={() => router.push('/')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          aria-label="Back to landing"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 truncate">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">kanvis</span>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <span className="truncate text-sm text-neutral-700 dark:text-neutral-300" title={targetUrl}>
              {hostnameOf(targetUrl)}
            </span>
          </div>
        </div>
        <button
          onClick={() => setEditsOpen((v) => !v)}
          disabled={edits.length === 0}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-neutral-900 px-1.5 text-[10px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
            {edits.length}
          </span>
          edits
        </button>
        <button
          onClick={copyShare}
          disabled={edits.length === 0}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {copied ? 'Copied!' : 'Share'}
        </button>
      </header>

      {/* Iframe area */}
      <main className="absolute inset-0 top-12 bg-neutral-100 dark:bg-neutral-900">
        <iframe
          ref={iframeRef}
          src={proxiedSrc}
          className="h-full w-full border-0"
          title="kanvis target"
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#fafaf9]/90 dark:bg-neutral-950/90">
            <div className="flex flex-col items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-neutral-100" />
              <div className="text-xs text-neutral-500">Loading {hostnameOf(targetUrl)}…</div>
            </div>
          </div>
        )}
      </main>

      {/* Floating selection card (top-left of iframe area) */}
      {selected && ready && (
        <div className="pointer-events-none absolute left-4 top-16 z-30">
          <div className="pointer-events-auto rounded-lg border border-neutral-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-blue-500" />
              <span className="font-mono text-xs text-neutral-900 dark:text-neutral-100">
                {selected.tagName.toLowerCase()}
              </span>
              {selected.classes.length > 0 && (
                <span className="font-mono text-[10px] text-neutral-500">
                  .{selected.classes.slice(0, 2).join('.')}
                  {selected.classes.length > 2 && '…'}
                </span>
              )}
            </div>
            <div className="mt-1 text-[10px] text-neutral-500">
              Drag the blue handles, or describe a change below
            </div>
          </div>
        </div>
      )}

      {/* Edits drawer (slides in from right) */}
      <aside
        className={`absolute right-0 top-12 z-20 flex h-[calc(100dvh-3rem)] w-80 flex-col border-l border-neutral-200 bg-white shadow-xl transition-transform duration-200 dark:border-neutral-800 dark:bg-neutral-950 ${
          editsOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Edits</span>
            <span className="rounded-full bg-neutral-100 px-2 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              {edits.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearEdits}
              disabled={edits.length === 0}
              className="text-xs text-neutral-500 hover:text-red-600 disabled:opacity-30"
            >
              Clear all
            </button>
            <button
              onClick={() => setEditsOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label="Close edits panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {edits.length === 0 ? (
            <div className="mt-8 text-center text-xs text-neutral-500">
              No edits yet.
              <br />
              Click an element and drag a handle, or use the chat below.
            </div>
          ) : (
            <ul className="space-y-2">
              {edits.map((op, i) => (
                <li key={i} className="rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-800">
                  <div className="truncate font-mono text-[10px] text-neutral-500" title={op.selector}>
                    {op.selector}
                  </div>
                  <div className="mt-1.5 break-all">
                    <span className="font-mono text-red-600 line-through decoration-red-300 dark:text-red-400">
                      {op.before}
                    </span>
                  </div>
                  <div className="mt-1 break-all">
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">
                      {op.after}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Floating chat bar (bottom) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-6">
        <div className="pointer-events-auto w-full max-w-2xl">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submitPrompt()
            }}
            className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
          >
            <div className="flex items-end gap-2 px-3 py-2.5">
              <div className="flex-1 self-stretch">
                {selected ? (
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] text-neutral-500">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    Editing <span className="font-mono">{selected.tagName.toLowerCase()}</span>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="ml-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                <textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    selected
                      ? 'Describe the change… "make it red", "tighter padding", "bigger text"'
                      : 'Click an element on the page first to start editing'
                  }
                  rows={1}
                  disabled={aiPending}
                  className="w-full resize-none border-0 bg-transparent text-sm outline-none placeholder:text-neutral-400 disabled:opacity-50"
                  style={{ maxHeight: '120px' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void submitPrompt()
                    }
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={aiPending || !prompt.trim() || !selected}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-neutral-900 px-3.5 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                {aiPending ? (
                  <>
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
                    Thinking…
                  </>
                ) : (
                  <>
                    Apply
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </>
                )}
              </button>
            </div>
            {aiError && (
              <div className="border-t border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {aiError}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
