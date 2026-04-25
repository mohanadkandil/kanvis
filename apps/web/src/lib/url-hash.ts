import type { DOMEditOp } from '@kanvis/core'

// ARCH-4 from /plan-eng-review: edits serialize to the URL hash so a share
// link replays them. ~4KB practical limit (~50 edits). On overflow, we drop
// oldest and surface a notice in the UI.

export function encodeEdits(edits: DOMEditOp[]): string {
  if (edits.length === 0) return ''
  const json = JSON.stringify(edits)
  // Browser-native btoa works on Latin-1; encodeURIComponent makes it UTF-safe.
  const utf8 = unescape(encodeURIComponent(json))
  return btoa(utf8)
}

export function decodeEdits(encoded: string): DOMEditOp[] {
  if (!encoded) return []
  try {
    const utf8 = atob(encoded)
    const json = decodeURIComponent(escape(utf8))
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isDOMEditOp)
  } catch {
    return []
  }
}

function isDOMEditOp(value: unknown): value is DOMEditOp {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v['kind'] === 'dom' &&
    typeof v['selector'] === 'string' &&
    typeof v['fingerprint'] === 'string' &&
    (v['property'] === 'class' || v['property'] === 'style' || v['property'] === 'attr') &&
    typeof v['before'] === 'string' &&
    typeof v['after'] === 'string'
  )
}
