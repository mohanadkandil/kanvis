// Cloudflare Worker entry point for kanvis proxy.
// Pipeline (ARCH-1 from /plan-eng-review):
//   1. parse incoming URL
//   2. SSRF guard
//   3. fetch origin with timeout
//   4. classify response (categorized failure modes from CQ-4)
//   5. HTMLRewriter: strip X-Frame-Options + CSP frame-ancestors,
//      neutralize common framebuster patterns, inject editor.js
//   6. serve under kanvis.app origin so Same-Origin Policy passes

import type { ProxyFailure } from '@kanvis/core'
import { assertUrlSafeForFetch, SsrfBlockedError } from './ssrf'

interface Env {
  EDITOR_SCRIPT_URL: string
  PROXY_FETCH_TIMEOUT_MS: string
  PROXY_MAX_BYTES: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return new Response('ok', { headers: cors() })
    }

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

    const timeoutMs = parseInt(env.PROXY_FETCH_TIMEOUT_MS, 10) || 5000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    let originResp: Response
    try {
      originResp = await fetch(safeUrl.toString(), {
        signal: controller.signal,
        headers: {
          'user-agent': request.headers.get('user-agent') ?? 'kanvis-proxy/0.0.1',
          accept: 'text/html,application/xhtml+xml,*/*',
        },
        redirect: 'follow',
      })
    } catch (e) {
      const isTimeout = e instanceof Error && e.name === 'AbortError'
      return jsonError(
        {
          category: isTimeout ? 'timeout' : 'fetch_error',
          url: target,
          detail: e instanceof Error ? e.message : 'unknown',
        },
        502,
      )
    } finally {
      clearTimeout(timeoutId)
    }

    if (!originResp.ok) {
      return jsonError(
        { category: 'fetch_error', url: target, detail: `origin ${originResp.status}` },
        502,
      )
    }

    const contentType = originResp.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) {
      // Not HTML — pass through as-is (images, CSS, JS chunks the page references).
      return passthrough(originResp)
    }

    const proxyBase = new URL(request.url).origin
    return rewriteHtml(originResp, env, target, proxyBase)
  },
}

function rewriteHtml(
  originResp: Response,
  env: Env,
  originalUrl: string,
  proxyBase: string,
): Response {
  let originRoot: string | null = null
  try {
    originRoot = new URL(originalUrl).origin
  } catch {
    // leave URL rewriting disabled if we can't parse
  }

  // Pre-compose the early-injection script. Two responsibilities:
  //   1. defeat `window.top !== self` framebusters (NOT window.parent —
  //      the editor.js uses window.parent.postMessage to talk to the
  //      kanvis.app shell, so overriding parent breaks our own channel)
  //   2. patch history.replaceState / pushState to swallow cross-origin
  //      SecurityError that frameworks (Next.js router) trigger on hydration
  // This MUST run before any page JS, hence prepended into <head>.
  const earlyInit = `
    <script>(function(){
      try{Object.defineProperty(window,'top',{get:function(){return window}});}catch(e){}
      var hp = window.history;
      ['replaceState','pushState'].forEach(function(fn){
        var orig = hp[fn].bind(hp);
        hp[fn] = function(state, title, url){
          try { return orig(state, title, url); }
          catch(e){ if (e && e.name === 'SecurityError') return; throw e; }
        };
      });
    })();</script>
  `.trim()

  // Cache-bust the editor.js URL with a per-request token so the browser
  // never serves a stale bundle. EDITOR_SCRIPT_URL doesn't change in prod
  // builds, but in dev the bundle is rebuilt on every save and the iframe
  // cache silently kept the old version.
  const editorSrcWithVersion = `${env.EDITOR_SCRIPT_URL}${env.EDITOR_SCRIPT_URL.includes('?') ? '&' : '?'}v=${Date.now()}`

  const rewriter = new HTMLRewriter()
    .on('head', {
      element(el) {
        el.prepend(earlyInit, { html: true })
        el.prepend(`<script src="${editorSrcWithVersion}" defer></script>`, { html: true })
      },
    })
    .on('meta[http-equiv]', {
      element(el) {
        const httpEquiv = el.getAttribute('http-equiv')?.toLowerCase()
        if (httpEquiv === 'x-frame-options' || httpEquiv === 'content-security-policy') {
          el.remove()
        }
      },
    })

  // Rewrite all URL-bearing attributes to route through the proxy. This makes
  // every asset fetch same-origin from the browser's perspective, so sites
  // with Sec-Fetch-Site: cross-site CSRF defenses (kandil.io, Vercel-hosted
  // Next, etc.) stop returning 400. The proxy does the cross-site fetch
  // server-side where those headers don't apply.
  if (originRoot) {
    const root = originRoot
    const proxify = (absoluteUrl: string) =>
      `${proxyBase}/?url=${encodeURIComponent(absoluteUrl)}`

    const resolveToAbsolute = (v: string): string | null => {
      if (/^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(v)) return null
      if (/^https?:\/\//i.test(v)) return v
      if (v.startsWith('//')) return `https:${v}`
      if (v.startsWith('/')) return `${root}${v}`
      // Truly relative paths (./foo or foo) — resolve against the page URL.
      try {
        return new URL(v, originalUrl).toString()
      } catch {
        return null
      }
    }

    const fixAttr = (el: Element, attr: string) => {
      const v = el.getAttribute(attr)
      if (!v) return
      const abs = resolveToAbsolute(v)
      if (!abs) return
      el.setAttribute(attr, proxify(abs))
    }

    rewriter
      .on('a[href]', { element: (el) => fixAttr(el, 'href') })
      .on('link[href]', { element: (el) => fixAttr(el, 'href') })
      .on('script[src]', { element: (el) => fixAttr(el, 'src') })
      .on('img[src]', { element: (el) => fixAttr(el, 'src') })
      .on('source[src]', { element: (el) => fixAttr(el, 'src') })
      .on('video[src]', { element: (el) => fixAttr(el, 'src') })
      .on('audio[src]', { element: (el) => fixAttr(el, 'src') })
      .on('iframe[src]', { element: (el) => fixAttr(el, 'src') })
      .on('form[action]', { element: (el) => fixAttr(el, 'action') })
      .on('img[srcset]', {
        element: (el) => {
          const v = el.getAttribute('srcset')
          if (!v) return
          const rewritten = v
            .split(',')
            .map((part) => {
              const trimmed = part.trim()
              const [url, ...desc] = trimmed.split(/\s+/)
              if (!url) return trimmed
              const abs = resolveToAbsolute(url)
              if (!abs) return trimmed
              return [proxify(abs), ...desc].join(' ')
            })
            .join(', ')
          el.setAttribute('srcset', rewritten)
        },
      })
      .on('source[srcset]', {
        element: (el) => {
          const v = el.getAttribute('srcset')
          if (!v) return
          const rewritten = v
            .split(',')
            .map((part) => {
              const trimmed = part.trim()
              const [url, ...desc] = trimmed.split(/\s+/)
              if (!url) return trimmed
              const abs = resolveToAbsolute(url)
              if (!abs) return trimmed
              return [proxify(abs), ...desc].join(' ')
            })
            .join(', ')
          el.setAttribute('srcset', rewritten)
        },
      })
  }

  // Drop a small subset of attribute names that contain extra absolute paths
  // some frameworks rely on (Next.js link prefetch, etc.). We only handle
  // src/href/action above; this catches Next-specific ones cheaply.

  // Build new headers: drop XFO + CSP frame-ancestors, add CORS, set content-type.
  const newHeaders = new Headers(originResp.headers)
  newHeaders.delete('x-frame-options')
  newHeaders.delete('content-security-policy')
  newHeaders.delete('content-security-policy-report-only')
  newHeaders.delete('content-encoding')
  newHeaders.delete('content-length')
  newHeaders.set('access-control-allow-origin', '*')
  newHeaders.set('cache-control', 'no-cache')

  return rewriter.transform(
    new Response(originResp.body, {
      status: originResp.status,
      statusText: originResp.statusText,
      headers: newHeaders,
    }),
  )
}

function passthrough(resp: Response): Response {
  const headers = new Headers(resp.headers)
  headers.delete('x-frame-options')
  headers.delete('content-security-policy')
  headers.delete('content-security-policy-report-only')
  // Cloudflare Workers auto-decompress fetched bodies; the original
  // content-encoding header is no longer accurate.
  headers.delete('content-encoding')
  headers.delete('content-length')
  headers.set('access-control-allow-origin', '*')
  // Fonts loaded via @font-face from the proxied page need this.
  headers.set('cross-origin-resource-policy', 'cross-origin')
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  })
}

function jsonError(failure: ProxyFailure, status: number): Response {
  return new Response(JSON.stringify(failure, null, 2), {
    status,
    headers: { 'content-type': 'application/json', ...cors() },
  })
}

function cors(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
  }
}
