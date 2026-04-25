// ARCH-5 architecture seam from /plan-eng-review.
// Three interfaces enforced from day 1 so v1 (GitHub OAuth + AST patches)
// is not a rewrite of v0.

export interface Picker {
  onHover(callback: (target: Element) => void): void
  onSelect(callback: (target: Element) => void): void
  destroy(): void
}

export type DOMEditOp = {
  kind: 'dom'
  selector: string
  fingerprint: string
  property: 'class' | 'style' | 'attr'
  attrName?: string
  before: string
  after: string
}

// v1 will extend this union with SourcePatchOp.
export type EditOp = DOMEditOp

export interface Applier {
  preview(op: EditOp): void
  apply(op: EditOp): Promise<void>
  ship?(ops: EditOp[]): Promise<{ prUrl: string }>
}

// Failure-mode taxonomy from CQ-4 in the design doc.
export type ProxyFailureCategory =
  | 'xfo'
  | 'framebuster'
  | 'csp'
  | 'fetch_error'
  | 'timeout'
  | 'too_large'
  | 'ssrf_blocked'
  | 'unknown'

export type ProxyFailure = {
  category: ProxyFailureCategory
  url: string
  detail?: string
}
