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

// AI-driven style mutations. Universal — works on any page regardless of
// CSS framework.
export type StyleEditOp = {
  kind: 'style'
  selector: string
  fingerprint: string
  styles: Record<string, string>
  beforeStyles: Record<string, string>
  rationale?: string
}

// AI-driven text content edits. Replaces el.textContent.
export type TextEditOp = {
  kind: 'text'
  selector: string
  fingerprint: string
  before: string
  after: string
  rationale?: string
}

// AI-driven attribute mutations (src, href, alt, placeholder, title, etc).
export type AttrEditOp = {
  kind: 'attr'
  selector: string
  fingerprint: string
  attributes: Record<string, string>
  beforeAttributes: Record<string, string>
  rationale?: string
}

// AI-driven innerHTML replacement. Used for restructuring an element's
// children — wrapping text, adding inline icons, building hierarchical layouts.
// Sanitized in the editor script before applying.
export type HtmlEditOp = {
  kind: 'html'
  selector: string
  fingerprint: string
  before: string
  after: string
  rationale?: string
}

export type EditOp = DOMEditOp | StyleEditOp | TextEditOp | AttrEditOp | HtmlEditOp

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
