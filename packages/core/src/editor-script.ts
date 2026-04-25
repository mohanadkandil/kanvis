// The editor script. Runs inside the proxied iframe.
// Injected by the Cloudflare Worker (apps/proxy) into every proxied page.
//
// Architecture (refined after first dogfood):
// - Hover and selection are floating overlay <div>s, NOT classes on page elements.
//   This avoids fighting React/Vue reconciliation and stays out of the page's
//   own DOM concerns entirely.
// - Drag handles reposition via window scroll/resize + ResizeObserver on the
//   selected element. NO global MutationObserver (that was the freeze cause).
// - Communicates with parent kanvis.app via window.postMessage.

import type { DOMEditOp } from './index'

type Mutation =
  | { kind: 'style'; target: string; value: string }
  | { kind: 'text'; target: ''; value: string }
  | { kind: 'attr'; target: string; value: string }
  | { kind: 'html'; target: ''; value: string }

type ParentMessage =
  | { type: 'kanvis:replay'; edits: DOMEditOp[] }
  | { type: 'kanvis:reset' }
  | { type: 'kanvis:apply-class'; selector: string; before: string; after: string }
  | { type: 'kanvis:apply-styles'; selector: string; styles: Record<string, string>; rationale?: string }
  | {
      type: 'kanvis:apply-mutations'
      selector: string
      mutations: Mutation[]
      rationale?: string
      additionalSelectors?: string[]
    }

const STYLE_ID = '__kanvis_style__'
const HOVER_OVERLAY_ID = '__kanvis_hover_overlay__'
const SELECT_OVERLAY_ID = '__kanvis_select_overlay__'
const HANDLE_CLASS = '__kanvis_handle__'

const SPACING_SCALE = [0, 1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96]
const SPACING_TO_TW: Record<number, string> = {
  0: '0', 1: 'px', 2: '0.5', 4: '1', 6: '1.5', 8: '2', 10: '2.5',
  12: '3', 16: '4', 20: '5', 24: '6', 32: '8', 40: '10', 48: '12',
  64: '16', 80: '20', 96: '24',
}

let hoverEl: Element | null = null
let selectedEl: Element | null = null  // primary (last clicked) — used for handles
let selectedEls: Element[] = []          // full multi-select set
let resizeObs: ResizeObserver | null = null
const MULTI_OVERLAY_PREFIX = '__kanvis_multi_overlay_'

// Defense for kanvis:apply-html. The runtime accepts AI-generated HTML and
// sets it via innerHTML. Strip the obvious XSS vectors so a hostile model
// (or an adversarial input passing through the model) can't drop a
// <script> or onclick handler into the proxied page. Not a full DOMPurify
// replacement — for v0 this catches the high-impact patterns.
function sanitizeHtml(html: string): string {
  return html
    // Remove <script>...</script> blocks entirely
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove standalone closing script tags just in case
    .replace(/<\/?script[^>]*>/gi, '')
    // Strip inline event handlers (onclick=, onerror=, onload=, etc)
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    // Neutralize javascript: and data:text/html URLs in href/src
    .replace(/(\s(?:href|src|action|formaction)\s*=\s*["'])\s*javascript:/gi, '$1#blocked-')
    .replace(/(\s(?:href|src)\s*=\s*["'])\s*data:text\/html/gi, '$1#blocked-')
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #${HOVER_OVERLAY_ID}, #${SELECT_OVERLAY_ID} {
      position: fixed; pointer-events: none; z-index: 2147483646;
      border-radius: 4px; box-sizing: border-box; display: none;
      transition: top 80ms ease-out, left 80ms ease-out, width 80ms ease-out, height 80ms ease-out;
    }
    #${HOVER_OVERLAY_ID} { border: 2px dashed rgba(59,130,246,0.55); }
    #${SELECT_OVERLAY_ID} { border: 2px solid rgb(59,130,246); box-shadow: 0 0 0 9999px rgba(0,0,0,0.04); }
    .${HANDLE_CLASS} {
      position: fixed; z-index: 2147483647; background: rgb(59,130,246);
      width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 2px white, 0 1px 3px rgba(0,0,0,0.25);
      pointer-events: auto;
    }
  `
  document.documentElement.appendChild(style)
}

function ensureOverlay(id: string): HTMLDivElement {
  let el = document.getElementById(id) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = id
    document.body.appendChild(el)
  }
  return el
}

function positionOverlay(id: string, el: Element | null) {
  const overlay = ensureOverlay(id)
  if (!el) {
    overlay.style.display = 'none'
    return
  }
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    overlay.style.display = 'none'
    return
  }
  overlay.style.display = 'block'
  overlay.style.left = `${rect.left}px`
  overlay.style.top = `${rect.top}px`
  overlay.style.width = `${rect.width}px`
  overlay.style.height = `${rect.height}px`
}

function buildSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  const path: string[] = []
  let node: Element | null = el
  while (node && node !== document.body && path.length < 6) {
    let part = node.tagName.toLowerCase()
    if (node.classList.length > 0) {
      part += '.' + Array.from(node.classList).map((c) => CSS.escape(c)).join('.')
    }
    const parent = node.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter((s) => s.tagName === node!.tagName)
      if (siblings.length > 1) {
        const idx = siblings.indexOf(node)
        part += `:nth-of-type(${idx + 1})`
      }
    }
    path.unshift(part)
    node = node.parentElement
  }
  return path.join(' > ')
}

function fingerprint(el: Element): string {
  const text = (el.textContent ?? '').trim().slice(0, 50)
  return `${el.tagName.toLowerCase()}|${text}`
}

// Capture the element's outerHTML (children included) so the AI can reason
// about structure: which children exist, how they're laid out, what to
// restructure. Truncated to ~4KB to keep prompts cheap; the model gets
// enough to understand the shape without bloating context.
function captureSnapshot(el: Element, maxChars = 4000): string {
  // Strip our own runtime markers before serializing.
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll(`#${HOVER_OVERLAY_ID}, #${SELECT_OVERLAY_ID}, .${HANDLE_CLASS}, [id^="${MULTI_OVERLAY_PREFIX}"], #${STYLE_ID}`).forEach((n) => n.remove())
  const html = (clone as HTMLElement).outerHTML ?? ''
  if (html.length <= maxChars) return html
  return html.slice(0, maxChars) + ' …[truncated]'
}

// Capture the site's "taste" — colors, fonts, spacing, radii, shadows —
// so AI-generated mutations match the existing design instead of defaulting
// to Tailwind blue + sans-serif. Run once after the page loads, then cached.
type DesignTokens = {
  body: { backgroundColor: string; color: string; fontFamily: string; fontSize: string; lineHeight: string }
  headings: Record<string, { color: string; fontFamily: string; fontSize: string; fontWeight: string }>
  link: { color: string; textDecoration: string } | null
  button: { backgroundColor: string; color: string; padding: string; borderRadius: string; fontFamily: string } | null
  topColors: string[]
  topBackgrounds: string[]
  radii: string[]
  shadows: string[]
  fontFamilies: string[]
}

function rgbToHex(rgb: string): string {
  // Pass through if already hex or non-rgb. Convert "rgb(r, g, b)" / "rgba(r,g,b,a)" to #rrggbb.
  if (/^#/.test(rgb)) return rgb
  const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!m) return rgb
  const r = parseInt(m[1] ?? '0', 10)
  const g = parseInt(m[2] ?? '0', 10)
  const b = parseInt(m[3] ?? '0', 10)
  const a = m[4] ? parseFloat(m[4]) : 1
  if (a < 0.05) return 'transparent'
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
}

function captureDesignTokens(): DesignTokens {
  const body = getComputedStyle(document.body)
  const tokens: DesignTokens = {
    body: {
      backgroundColor: rgbToHex(body.backgroundColor),
      color: rgbToHex(body.color),
      fontFamily: body.fontFamily,
      fontSize: body.fontSize,
      lineHeight: body.lineHeight,
    },
    headings: {},
    link: null,
    button: null,
    topColors: [],
    topBackgrounds: [],
    radii: [],
    shadows: [],
    fontFamilies: [],
  }

  // Headings — pull computed styles for h1/h2/h3 if present.
  for (const tag of ['h1', 'h2', 'h3']) {
    const el = document.querySelector(tag)
    if (el) {
      const cs = getComputedStyle(el)
      tokens.headings[tag] = {
        color: rgbToHex(cs.color),
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
      }
    }
  }

  // First link.
  const linkEl = document.querySelector('a[href]')
  if (linkEl) {
    const cs = getComputedStyle(linkEl)
    tokens.link = { color: rgbToHex(cs.color), textDecoration: cs.textDecoration.split(' ')[0] ?? 'none' }
  }

  // First button.
  const btnEl = document.querySelector('button, .btn, [role="button"]')
  if (btnEl) {
    const cs = getComputedStyle(btnEl)
    tokens.button = {
      backgroundColor: rgbToHex(cs.backgroundColor),
      color: rgbToHex(cs.color),
      padding: cs.padding,
      borderRadius: cs.borderRadius,
      fontFamily: cs.fontFamily,
    }
  }

  // Sample up to 300 elements for color/background/radius/shadow/font frequency.
  const colorCounts = new Map<string, number>()
  const bgCounts = new Map<string, number>()
  const radiusCounts = new Map<string, number>()
  const shadowSet = new Set<string>()
  const fontSet = new Set<string>()
  const candidates = Array.from(document.querySelectorAll('*'))
  const sampleSize = Math.min(candidates.length, 300)
  for (let i = 0; i < sampleSize; i++) {
    const el = candidates[i]
    if (!el || isKanvisEl(el)) continue
    const cs = getComputedStyle(el)
    const color = rgbToHex(cs.color)
    if (color !== 'transparent') colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1)
    const bg = rgbToHex(cs.backgroundColor)
    if (bg !== 'transparent' && bg !== tokens.body.backgroundColor) {
      bgCounts.set(bg, (bgCounts.get(bg) ?? 0) + 1)
    }
    const r = cs.borderRadius
    if (r && r !== '0px') radiusCounts.set(r, (radiusCounts.get(r) ?? 0) + 1)
    const sh = cs.boxShadow
    if (sh && sh !== 'none' && shadowSet.size < 4) shadowSet.add(sh)
    const ff = cs.fontFamily
    if (ff && fontSet.size < 4) fontSet.add(ff)
  }

  tokens.topColors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([c]) => c)
  tokens.topBackgrounds = [...bgCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c]) => c)
  tokens.radii = [...radiusCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([r]) => r)
  tokens.shadows = [...shadowSet]
  tokens.fontFamilies = [...fontSet]

  return tokens
}

function send(msg: object) {
  window.parent.postMessage(msg, '*')
}

function isKanvisEl(el: Element | null): boolean {
  if (!el) return true
  return (
    el.id === HOVER_OVERLAY_ID ||
    el.id === SELECT_OVERLAY_ID ||
    el.classList.contains(HANDLE_CLASS) ||
    el.id === STYLE_ID
  )
}

function attachListeners() {
  document.addEventListener(
    'mouseover',
    (e) => {
      const target = e.target as Element | null
      if (!target || isKanvisEl(target)) return
      hoverEl = target
      positionOverlay(HOVER_OVERLAY_ID, target)
      send({ type: 'kanvis:hover', selector: buildSelector(target) })
    },
    true,
  )

  document.addEventListener(
    'mouseout',
    (e) => {
      const target = e.target as Element | null
      if (target === hoverEl) {
        hoverEl = null
        positionOverlay(HOVER_OVERLAY_ID, null)
      }
    },
    true,
  )

  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null
      if (!target || isKanvisEl(target)) return
      e.preventDefault()
      e.stopPropagation()
      // Shift+click adds to selection. Plain click replaces.
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        toggleAdditionalSelection(target)
      } else {
        selectElement(target)
      }
    },
    true,
  )

  // Block link navigation inside the iframe (kanvis is single-page in v0).
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest('a')
      if (a) {
        e.preventDefault()
        e.stopPropagation()
      }
    },
    true,
  )
}

function clearMultiOverlays() {
  document.querySelectorAll(`[id^="${MULTI_OVERLAY_PREFIX}"]`).forEach((n) => n.remove())
}

function renderMultiOverlays() {
  clearMultiOverlays()
  // Skip the primary — it's already shown via SELECT_OVERLAY_ID.
  selectedEls
    .filter((el) => el !== selectedEl)
    .forEach((el, i) => {
      const overlay = document.createElement('div')
      overlay.id = `${MULTI_OVERLAY_PREFIX}${i}`
      // Clone the visual style of the select overlay but slightly dimmer.
      Object.assign(overlay.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '2147483646',
        borderRadius: '4px',
        boxSizing: 'border-box',
        border: '2px solid rgba(59,130,246,0.7)',
        boxShadow: '0 0 0 1px rgba(59,130,246,0.3)',
      })
      const rect = el.getBoundingClientRect()
      overlay.style.left = `${rect.left}px`
      overlay.style.top = `${rect.top}px`
      overlay.style.width = `${rect.width}px`
      overlay.style.height = `${rect.height}px`
      document.body.appendChild(overlay)
    })
}

function emitSelectionState() {
  send({
    type: 'kanvis:select',
    selector: selectedEl ? buildSelector(selectedEl) : '',
    tagName: selectedEl?.tagName ?? '',
    classes: selectedEl ? Array.from(selectedEl.classList) : [],
    text: selectedEl ? (selectedEl.textContent ?? '').trim().slice(0, 200) : '',
    inlineStyle: selectedEl ? (selectedEl as HTMLElement).style.cssText || '' : '',
    outerHtml: selectedEl ? captureSnapshot(selectedEl) : '',
    childCount: selectedEl ? selectedEl.children.length : 0,
    additional: selectedEls
      .filter((el) => el !== selectedEl)
      .map((el) => ({
        selector: buildSelector(el),
        tagName: el.tagName,
        classes: Array.from(el.classList),
        text: (el.textContent ?? '').trim().slice(0, 200),
        inlineStyle: (el as HTMLElement).style.cssText || '',
        outerHtml: captureSnapshot(el),
        childCount: el.children.length,
      })),
  })
}

function selectElement(el: Element) {
  selectedEl = el
  selectedEls = [el]
  positionOverlay(SELECT_OVERLAY_ID, el)
  positionOverlay(HOVER_OVERLAY_ID, null)
  clearMultiOverlays()

  emitSelectionState()
  showHandles(el)

  resizeObs?.disconnect()
  resizeObs = new ResizeObserver(() => {
    positionOverlay(SELECT_OVERLAY_ID, el)
    showHandles(el)
    renderMultiOverlays()
  })
  resizeObs.observe(el)
}

function toggleAdditionalSelection(el: Element) {
  // Shift-click on an already-selected element removes it. Otherwise add.
  const idx = selectedEls.indexOf(el)
  if (idx >= 0) {
    selectedEls.splice(idx, 1)
    if (el === selectedEl) {
      selectedEl = selectedEls[0] ?? null
    }
  } else {
    selectedEls.push(el)
  }

  // Re-render visuals.
  if (selectedEl) {
    positionOverlay(SELECT_OVERLAY_ID, selectedEl)
    showHandles(selectedEl)
  } else {
    positionOverlay(SELECT_OVERLAY_ID, null)
    document.querySelectorAll(`.${HANDLE_CLASS}`).forEach((n) => n.remove())
  }
  renderMultiOverlays()
  emitSelectionState()
}

function showHandles(el: Element) {
  document.querySelectorAll(`.${HANDLE_CLASS}`).forEach((n) => n.remove())

  const rect = el.getBoundingClientRect()
  const sides: Array<{ side: 'left' | 'right' | 'top' | 'bottom'; x: number; y: number }> = [
    { side: 'left', x: rect.left, y: rect.top + rect.height / 2 },
    { side: 'right', x: rect.right, y: rect.top + rect.height / 2 },
    { side: 'top', x: rect.left + rect.width / 2, y: rect.top },
    { side: 'bottom', x: rect.left + rect.width / 2, y: rect.bottom },
  ]

  for (const { side, x, y } of sides) {
    const h = document.createElement('div')
    h.className = HANDLE_CLASS
    h.style.left = `${x - 5}px`
    h.style.top = `${y - 5}px`
    h.style.cursor = side === 'left' || side === 'right' ? 'ew-resize' : 'ns-resize'
    h.addEventListener('mousedown', (e) => startDrag(e, el, side))
    document.body.appendChild(h)
  }
}

function startDrag(downEvent: MouseEvent, el: Element, side: 'left' | 'right' | 'top' | 'bottom') {
  downEvent.preventDefault()
  downEvent.stopPropagation()

  const startX = downEvent.clientX
  const startY = downEvent.clientY
  const beforeClasses = Array.from(el.classList)
  const property = side === 'left' ? 'pl' : side === 'right' ? 'pr' : side === 'top' ? 'pt' : 'pb'

  const currentClass = beforeClasses.find((c) => new RegExp(`^${property}-`).test(c))
  let currentValue = 16
  if (currentClass) {
    const match = currentClass.match(/-(\d+)/)
    if (match && match[1]) currentValue = parseInt(match[1], 10) * 4 || 16
  }

  let raf = 0
  function onMove(e: MouseEvent) {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const delta = side === 'left' ? -(e.clientX - startX)
        : side === 'right' ? e.clientX - startX
        : side === 'top' ? -(e.clientY - startY)
        : e.clientY - startY
      const target = currentValue + delta
      const snapped = SPACING_SCALE.reduce((p, c) =>
        Math.abs(c - target) < Math.abs(p - target) ? c : p,
      SPACING_SCALE[0]!)
      applyTailwindPadding(el, property, snapped)
    })
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    const afterClasses = Array.from(el.classList)
    const beforeStr = beforeClasses.join(' ')
    const afterStr = afterClasses.join(' ')
    if (beforeStr !== afterStr) {
      const op: DOMEditOp = {
        kind: 'dom',
        selector: buildSelector(el),
        fingerprint: fingerprint(el),
        property: 'class',
        before: beforeStr,
        after: afterStr,
      }
      send({ type: 'kanvis:edit', op })
    }
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function applyTailwindPadding(el: Element, property: 'pl' | 'pr' | 'pt' | 'pb', valuePx: number) {
  const tw = SPACING_TO_TW[valuePx]
  if (!tw) return
  const re = new RegExp(`^${property}-`)
  const filtered = Array.from(el.classList).filter((c) => !re.test(c))
  el.className = [...filtered, `${property}-${tw}`].join(' ')
}

function applyEditOp(op: DOMEditOp): boolean {
  let el = document.querySelector(op.selector)
  if (!el) {
    el = Array.from(document.querySelectorAll(op.fingerprint.split('|')[0] ?? '*'))
      .find((node) => fingerprint(node) === op.fingerprint) ?? null
  }
  if (!el) return false
  if (op.property === 'class') el.className = op.after
  return true
}

function listenForParentMessages() {
  window.addEventListener('message', (e: MessageEvent<ParentMessage>) => {
    const msg = e.data
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return
    if (msg.type === 'kanvis:replay') {
      for (const op of msg.edits) applyEditOp(op)
    } else if (msg.type === 'kanvis:reset') {
      window.location.reload()
    } else if (msg.type === 'kanvis:apply-class') {
      let el = document.querySelector(msg.selector)
      if (!el && selectedEl) {
        const fp = fingerprint(selectedEl)
        el = Array.from(document.querySelectorAll(fp.split('|')[0] ?? '*'))
          .find((node) => fingerprint(node) === fp) ?? null
      }
      if (!el) {
        send({ type: 'kanvis:apply-failed', selector: msg.selector, reason: 'element_not_found' })
        return
      }
      el.className = msg.after
      if (selectedEl === el) {
        positionOverlay(SELECT_OVERLAY_ID, el)
        showHandles(el)
      }
      const op: DOMEditOp = {
        kind: 'dom',
        selector: msg.selector,
        fingerprint: fingerprint(el),
        property: 'class',
        before: msg.before,
        after: msg.after,
      }
      send({ type: 'kanvis:edit', op })
    } else if (msg.type === 'kanvis:apply-styles') {
      let el = document.querySelector(msg.selector) as HTMLElement | null
      if (!el && selectedEl) {
        const fp = fingerprint(selectedEl)
        el = (Array.from(document.querySelectorAll(fp.split('|')[0] ?? '*')) as HTMLElement[])
          .find((node) => fingerprint(node) === fp) ?? null
      }
      if (!el) {
        send({ type: 'kanvis:apply-failed', selector: msg.selector, reason: 'element_not_found' })
        return
      }
      const beforeStyles: Record<string, string> = {}
      for (const prop of Object.keys(msg.styles)) {
        beforeStyles[prop] = el.style.getPropertyValue(prop)
      }
      for (const [prop, value] of Object.entries(msg.styles)) {
        el.style.setProperty(prop, value)
      }
      if (selectedEl === el) {
        positionOverlay(SELECT_OVERLAY_ID, el)
        showHandles(el)
      }
      send({
        type: 'kanvis:edit',
        op: {
          kind: 'style',
          selector: msg.selector,
          fingerprint: fingerprint(el),
          styles: msg.styles,
          beforeStyles,
          rationale: msg.rationale,
        },
      })
    } else if (msg.type === 'kanvis:apply-mutations') {
      // Build the list of target elements: primary + any additionals.
      const allSelectors = [msg.selector, ...(msg.additionalSelectors ?? [])]
      const targets: HTMLElement[] = []
      for (const sel of allSelectors) {
        let el = document.querySelector(sel) as HTMLElement | null
        if (!el && selectedEl) {
          const fp = fingerprint(selectedEl)
          el = (Array.from(document.querySelectorAll(fp.split('|')[0] ?? '*')) as HTMLElement[])
            .find((node) => fingerprint(node) === fp) ?? null
        }
        if (el) targets.push(el)
      }
      if (targets.length === 0) {
        send({ type: 'kanvis:apply-failed', selector: msg.selector, reason: 'element_not_found' })
        return
      }

      const styleMutations = msg.mutations.filter((m) => m.kind === 'style')
      const textMutations = msg.mutations.filter((m) => m.kind === 'text')
      const attrMutations = msg.mutations.filter((m) => m.kind === 'attr')
      const htmlMutations = msg.mutations.filter((m) => m.kind === 'html')

      // Apply the same mutations to every target. Each target produces its
      // own edit op so the diff list shows them separately.
      for (let i = 0; i < targets.length; i++) {
        const el = targets[i]!
        const elSelector = allSelectors[i] ?? msg.selector

        if (styleMutations.length > 0) {
          const styles: Record<string, string> = {}
          const beforeStyles: Record<string, string> = {}
          for (const m of styleMutations) {
            beforeStyles[m.target] = el.style.getPropertyValue(m.target)
            styles[m.target] = m.value
            el.style.setProperty(m.target, m.value)
          }
          send({
            type: 'kanvis:edit',
            op: {
              kind: 'style',
              selector: elSelector,
              fingerprint: fingerprint(el),
              styles,
              beforeStyles,
              rationale: msg.rationale,
            },
          })
        }

        if (textMutations.length > 0) {
          const last = textMutations[textMutations.length - 1]
          if (last) {
            const before = el.textContent ?? ''
            el.textContent = last.value
            send({
              type: 'kanvis:edit',
              op: {
                kind: 'text',
                selector: elSelector,
                fingerprint: fingerprint(el),
                before,
                after: last.value,
                rationale: msg.rationale,
              },
            })
          }
        }

        if (attrMutations.length > 0) {
          const attributes: Record<string, string> = {}
          const beforeAttributes: Record<string, string> = {}
          for (const m of attrMutations) {
            beforeAttributes[m.target] = el.getAttribute(m.target) ?? ''
            attributes[m.target] = m.value
            el.setAttribute(m.target, m.value)
          }
          send({
            type: 'kanvis:edit',
            op: {
              kind: 'attr',
              selector: elSelector,
              fingerprint: fingerprint(el),
              attributes,
              beforeAttributes,
              rationale: msg.rationale,
            },
          })
        }

        if (htmlMutations.length > 0) {
          const last = htmlMutations[htmlMutations.length - 1]
          if (last) {
            const before = el.innerHTML
            const safe = sanitizeHtml(last.value)
            el.innerHTML = safe
            send({
              type: 'kanvis:edit',
              op: {
                kind: 'html',
                selector: elSelector,
                fingerprint: fingerprint(el),
                before,
                after: safe,
                rationale: msg.rationale,
              },
            })
          }
        }
      }

      if (selectedEl) {
        positionOverlay(SELECT_OVERLAY_ID, selectedEl)
        showHandles(selectedEl)
      }
      renderMultiOverlays()
    }
  })
}

function start() {
  injectStyles()
  ensureOverlay(HOVER_OVERLAY_ID)
  ensureOverlay(SELECT_OVERLAY_ID)
  attachListeners()
  listenForParentMessages()

  const reposition = () => {
    if (hoverEl) positionOverlay(HOVER_OVERLAY_ID, hoverEl)
    if (selectedEl) {
      positionOverlay(SELECT_OVERLAY_ID, selectedEl)
      showHandles(selectedEl)
    }
    renderMultiOverlays()
  }
  window.addEventListener('scroll', reposition, true)
  window.addEventListener('resize', reposition)

  send({ type: 'kanvis:ready' })

  // Capture design tokens after a short delay so framework hydration has
  // settled and computed styles reflect the final visual state.
  setTimeout(() => {
    try {
      const tokens = captureDesignTokens()
      send({ type: 'kanvis:design-tokens', tokens })
    } catch {
      // Best-effort. If something throws, the AI just falls back to defaults.
    }
  }, 800)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start)
} else {
  start()
}
