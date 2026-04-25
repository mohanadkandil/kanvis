import type { EditOp } from '@kanvis/core'

// ARCH-4 from /plan-eng-review: edits serialize to the URL hash so a share
// link replays them. ~4KB practical limit (~50 edits). On overflow, drop
// oldest and surface a notice in the UI.

export function encodeEdits(edits: EditOp[]): string {
  if (edits.length === 0) return ''
  const json = JSON.stringify(edits)
  const utf8 = unescape(encodeURIComponent(json))
  return btoa(utf8)
}

export function decodeEdits(encoded: string): EditOp[] {
  if (!encoded) return []
  try {
    const utf8 = atob(encoded)
    const json = decodeURIComponent(escape(utf8))
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isEditOp)
  } catch {
    return []
  }
}

function isEditOp(value: unknown): value is EditOp {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v['selector'] !== 'string' || typeof v['fingerprint'] !== 'string') return false
  if (v['kind'] === 'dom') {
    return (
      (v['property'] === 'class' || v['property'] === 'style' || v['property'] === 'attr') &&
      typeof v['before'] === 'string' &&
      typeof v['after'] === 'string'
    )
  }
  if (v['kind'] === 'style') {
    return (
      typeof v['styles'] === 'object' && v['styles'] !== null &&
      typeof v['beforeStyles'] === 'object' && v['beforeStyles'] !== null
    )
  }
  if (v['kind'] === 'text') {
    return typeof v['before'] === 'string' && typeof v['after'] === 'string'
  }
  if (v['kind'] === 'attr') {
    return (
      typeof v['attributes'] === 'object' && v['attributes'] !== null &&
      typeof v['beforeAttributes'] === 'object' && v['beforeAttributes'] !== null
    )
  }
  if (v['kind'] === 'html') {
    return typeof v['before'] === 'string' && typeof v['after'] === 'string'
  }
  return false
}
