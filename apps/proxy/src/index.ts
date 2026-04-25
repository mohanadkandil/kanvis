// Cloudflare Worker entry point for kanvis proxy.
// Architecture: ARCH-1 from /plan-eng-review.
// Pipeline: parse URL → SSRF guard → fetch origin → strip XFO/CSP → inject editor.js → serve.

import type { ProxyFailure } from '@kanvis/core'
import { assertUrlSafeForFetch, SsrfBlockedError } from './ssrf'

interface Env {
  EDITOR_SCRIPT_URL: string
  PROXY_FETCH_TIMEOUT_MS: string
  PROXY_MAX_BYTES: string
  // KANVIS_CACHE: KVNamespace  // uncomment after wrangler kv:namespace create
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const target = url.searchParams.get('url')

    if (!target) {
      return jsonError({ category: 'unknown', url: '', detail: 'missing url param' }, 400)
    }

    let safeUrl: URL
    try {
      safeUrl = assertUrlSafeForFetch(target)
    } catch (e) {
      const reason = e instanceof SsrfBlockedError ? e.reason : 'unknown'
      return jsonError({ category: 'ssrf_blocked', url: target, detail: reason }, 400)
    }

    // TODO: KV cache lookup before fetch.
    // TODO: HTMLRewriter pipeline (strip XFO, strip CSP, inject script).
    // TODO: framebuster detection.
    // For now, return a placeholder response so the SSRF gate is wired up
    // and tests pass. The full pipeline lands in the next commit.
    return new Response(
      `kanvis proxy — SSRF gate passed for ${safeUrl.toString()}\n\n` +
        `Next commits:\n` +
        `  - HTMLRewriter pipeline (strip headers, inject editor.js)\n` +
        `  - KV cache layer\n` +
        `  - Framebuster detection\n` +
        `  - Failure-mode categorization\n`,
      { headers: { 'content-type': 'text/plain' } },
    )
  },
}

function jsonError(failure: ProxyFailure, status: number): Response {
  return new Response(JSON.stringify(failure, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
