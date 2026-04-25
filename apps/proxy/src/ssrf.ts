// Critical security gate from /plan-eng-review (ARCH-1 + Section 4).
// Without this, the Worker is an open SSRF gateway: anyone could fetch
// internal endpoints (AWS metadata, intranet hosts) via /proxy?url=...
// Must run BEFORE every fetch() in the Worker.

const PRIVATE_V4_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^255\.255\.255\.255$/,
]

const PRIVATE_V6_PATTERNS = [
  /^::1$/i,
  /^::$/i,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^fec0:/i,
]

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
])

export class SsrfBlockedError extends Error {
  constructor(public readonly reason: string, public readonly url: string) {
    super(`SSRF blocked (${reason}): ${url}`)
    this.name = 'SsrfBlockedError'
  }
}

export function assertUrlSafeForFetch(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfBlockedError('invalid_url', rawUrl)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError('non_http_protocol', rawUrl)
  }

  if (url.username || url.password) {
    throw new SsrfBlockedError('credentials_in_url', rawUrl)
  }

  // Strip surrounding [ ] from IPv6 hostnames before checking.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SsrfBlockedError('blocked_hostname', rawUrl)
  }

  if (PRIVATE_V4_PATTERNS.some((re) => re.test(host))) {
    throw new SsrfBlockedError('private_v4', rawUrl)
  }

  if (PRIVATE_V6_PATTERNS.some((re) => re.test(host))) {
    throw new SsrfBlockedError('private_v6', rawUrl)
  }

  // Note on DNS rebinding: a hostname could resolve to a public IP at check
  // time and a private IP at fetch time. Cloudflare Workers do not expose a
  // direct DNS lookup API, but a defense-in-depth approach is to also
  // inspect the IP that fetch() ends up using via the cf object on the
  // response. v0 ships this static check; v1 should add the dynamic check.
  return url
}
