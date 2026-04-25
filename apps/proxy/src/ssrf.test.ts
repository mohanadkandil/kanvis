import { describe, it, expect } from 'vitest'
import { assertUrlSafeForFetch, SsrfBlockedError } from './ssrf'

describe('assertUrlSafeForFetch', () => {
  describe('rejects', () => {
    it.each([
      ['loopback v4', 'http://127.0.0.1'],
      ['loopback v4 with port', 'http://127.0.0.1:3000'],
      ['loopback name', 'http://localhost'],
      ['loopback name with port', 'http://localhost:8080'],
      ['private 10.x', 'http://10.0.0.1'],
      ['private 192.168.x', 'http://192.168.1.1'],
      ['private 172.16.x', 'http://172.16.0.1'],
      ['private 172.31.x', 'http://172.31.255.255'],
      ['link-local 169.254.x (AWS metadata)', 'http://169.254.169.254'],
      ['unspecified 0.0.0.0', 'http://0.0.0.0'],
      ['unspecified 0.x', 'http://0.1.2.3'],
      ['broadcast', 'http://255.255.255.255'],
      ['IPv6 loopback', 'http://[::1]'],
      ['IPv6 ULA fc00::', 'http://[fc00::1]'],
      ['IPv6 ULA fd00::', 'http://[fd00::1]'],
      ['IPv6 link-local fe80::', 'http://[fe80::1]'],
      ['credentials in URL', 'http://user:pass@example.com'],
      ['file: scheme', 'file:///etc/passwd'],
      ['ftp: scheme', 'ftp://example.com'],
      ['javascript: scheme', 'javascript:alert(1)'],
      ['data: scheme', 'data:text/html,<script>alert(1)</script>'],
      ['gopher: scheme', 'gopher://example.com'],
      ['malformed URL', 'not a url'],
      ['empty', ''],
    ])('%s → %s', (_label, url) => {
      expect(() => assertUrlSafeForFetch(url)).toThrow(SsrfBlockedError)
    })
  })

  describe('allows', () => {
    it.each([
      ['public https', 'https://example.com'],
      ['public http', 'http://example.com'],
      ['public with path', 'https://stripe.com/pricing'],
      ['public with query', 'https://example.com/search?q=foo'],
      ['public with port', 'https://example.com:8443'],
      ['IPv4 public', 'http://8.8.8.8'],
      ['subdomain', 'https://docs.example.com'],
    ])('%s → %s', (_label, url) => {
      expect(() => assertUrlSafeForFetch(url)).not.toThrow()
      expect(assertUrlSafeForFetch(url)).toBeInstanceOf(URL)
    })
  })

  it('preserves the parsed URL for downstream use', () => {
    const url = assertUrlSafeForFetch('https://example.com/foo?bar=1')
    expect(url.hostname).toBe('example.com')
    expect(url.pathname).toBe('/foo')
    expect(url.search).toBe('?bar=1')
  })

  it('attaches reason and url to thrown errors', () => {
    try {
      assertUrlSafeForFetch('http://127.0.0.1')
    } catch (e) {
      expect(e).toBeInstanceOf(SsrfBlockedError)
      expect((e as SsrfBlockedError).reason).toBe('private_v4')
      expect((e as SsrfBlockedError).url).toBe('http://127.0.0.1')
    }
  })
})
