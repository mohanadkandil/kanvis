import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'

type AdditionalRequest = {
  selector: string
  tagName: string
  currentClasses: string[]
  currentText?: string
  currentInlineStyle?: string
  currentHtml?: string
  childCount?: number
}

type DesignTokens = {
  body?: { backgroundColor?: string; color?: string; fontFamily?: string; fontSize?: string; lineHeight?: string }
  headings?: Record<string, { color?: string; fontFamily?: string; fontSize?: string; fontWeight?: string }>
  link?: { color?: string; textDecoration?: string } | null
  button?: {
    backgroundColor?: string
    color?: string
    padding?: string
    borderRadius?: string
    fontFamily?: string
  } | null
  topColors?: string[]
  topBackgrounds?: string[]
  radii?: string[]
  shadows?: string[]
  fontFamilies?: string[]
  typography?: Record<string, {
    color?: string
    fontFamily?: string
    fontSize?: string
    fontWeight?: string
    lineHeight?: string
    letterSpacing?: string
    textTransform?: string
  }>
  components?: {
    card?: { backgroundColor?: string; padding?: string; borderRadius?: string; border?: string; boxShadow?: string; childCount?: number }
    badge?: { backgroundColor?: string; color?: string; padding?: string; borderRadius?: string; fontSize?: string }
    section?: { backgroundColor?: string; padding?: string }
  }
  palette?: {
    primaryText?: string
    secondaryTexts?: string[]
    mutedTexts?: string[]
    accents?: string[]
    surfaces?: string[]
  }
  system?: { spacingScale?: string[]; sampledElementCount?: number }
}

type EditRequest = {
  selector: string
  tagName: string
  currentClasses: string[]
  currentText?: string
  currentInlineStyle?: string
  currentHtml?: string
  childCount?: number
  additional?: AdditionalRequest[]
  designTokens?: DesignTokens | null
  prompt: string
}

type Mutation =
  | { kind: 'style'; target: string; value: string }
  | { kind: 'text'; target: ''; value: string }
  | { kind: 'attr'; target: string; value: string }
  | { kind: 'html'; target: ''; value: string }

type EditResponse =
  | { ok: true; mutations: Mutation[]; rationale: string; ms: number; changed: boolean }
  | { ok: false; error: string }

// Single mutation shape — kind discriminator picks how the editor applies it.
// Strict-mode-compatible across providers (no open-ended objects, no oneOf).
const MutationSchema = z.object({
  kind: z.enum(['style', 'text', 'attr', 'html']),
  target: z.string(), // CSS property name | HTML attribute name | '' for text/html
  value: z.string(),
})

const EditOutput = z.object({
  mutations: z.array(MutationSchema),
  rationale: z.string().max(280).optional().default(''),
})

const RESPONSE_SCHEMA = {
  name: 'kanvis_edit',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      mutations: {
        type: 'array',
        description:
          'List of DOM mutations to apply. Empty array = no change. Each mutation has a kind ("style"|"text"|"attr"), a target (CSS property for style, attribute name for attr, empty string for text), and a value.',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['style', 'text', 'attr', 'html'],
              description:
                'style = inline CSS (target is kebab-case CSS property). text = textContent (target is empty string). attr = HTML attribute (target is attribute name e.g. src, href, alt, placeholder). html = replace innerHTML of the element with new HTML (target is empty string, value is the new inner HTML — used for restructuring, adding child elements, wrapping text, adding icons, etc).',
            },
            target: {
              type: 'string',
              description:
                'For style: CSS property in kebab-case (color, padding, font-size). For attr: attribute name (src, href, alt). For text: empty string.',
            },
            value: {
              type: 'string',
              description:
                'For style: CSS value (#ef4444, 1.5rem, 700). For text: the new text content. For attr: the new attribute value.',
            },
          },
          required: ['kind', 'target', 'value'],
          additionalProperties: false,
        },
      },
      rationale: {
        type: 'string',
        description: 'One short concrete sentence describing what changed.',
      },
    },
    required: ['mutations', 'rationale'],
    additionalProperties: false,
  },
} as const

const SYSTEM_PROMPT = `You are a DOM mutation generator for kanvis. The runtime sends you an HTML element snippet (tag, classes, text, inline style) and a natural-language request. You output a list of DOM mutations to apply.

ABSOLUTE RULES (never violate these):
1. NEVER refuse for vagueness, ambiguity, "lacking context", "needs an ID", or "structural concerns." Pick something reasonable. The user can iterate. Refusal is worse than a mediocre guess.
2. Style + text + attribute + html changes are ALL supported. Never decline them. "Restructuring" / "redesigning" / "adding child elements" is supported via the html mutation kind.
3. Empty mutations array is ONLY valid for requests that fundamentally cannot affect a single element (multi-page navigation, dynamic JS behavior the runtime cannot express, modifying elements OTHER than the one selected). Even then, prefer making a reasonable visual change to the element you were given.
4. NEVER write a rationale like "I cannot determine..." / "needs clarification..." / "this requires HTML changes" / "this needs restructuring" — none of those are valid refusal reasons. Just produce mutations.

You do not query the DOM. You do not verify anything. Assume the element exists. Choose mutations.

CRITICAL: MATCH THE SITE'S TASTE.
The user message opens with "Site design tokens — these ARE the design system." It is structured into PAGE, COLOR ROLES, TYPOGRAPHY, COMPONENTS, and SYSTEM blocks. Each block tells you exactly what value to use for what kind of mutation. THIS IS THE DESIGN SYSTEM. You are not designing one — you are extending the one that exists.

How to read each block and pick values:

- COLOR ROLES → "primary text" is the body text color (#... use this for normal text). "secondary text" is for de-emphasized labels. "muted/disabled text" is for hints/timestamps. "accent colors" is what to reach for when the user says "make it stand out", "highlight", "emphasize", "primary", "CTA", or any request that needs a non-neutral color. NEVER pick #3b82f6 or another stock blue when the accent list contains the site's actual accent. The site's accent might be green, orange, deep red — use what's listed.

- TYPOGRAPHY → per-tag snapshot of font-size, weight, color, family. When you generate a heading inside an html mutation, copy h1's settings. When you generate body text, copy p's settings. When you generate fine print, copy small's settings. Don't invent a 1.5rem heading if the site's h2 is 1rem.

- COMPONENTS → archetypes for card/badge/section/button/link. If the user asks for a status badge, take badge.backgroundColor + badge.color + badge.borderRadius + badge.fontSize as your starting point and only deviate when the user is explicitly asking for difference. If the user asks to redesign a card, take card.backgroundColor and card.padding and card.borderRadius — these ARE the site's card style.

- SYSTEM → radii, shadows, spacing scale, fonts in use. When you set padding or margin, snap to the spacing scale. When you set border-radius, snap to one of the listed radii (often 0px on editorial sites; never invent 1rem unless 1rem already appears).

Hard rules that follow from this:
- NEVER drop in Tailwind blue (#3b82f6) when the accents list doesn't include it.
- NEVER use border-radius 1rem when the radii list is "0px, 0.25rem".
- NEVER swap the font-family unless the user explicitly asks for a different typeface.
- NEVER use generic "make-it-look-good" defaults like #22c55e/0.5rem/1rem when the design system has its own equivalents.

The kanvis output should look like the same designer wrote it. If you find yourself reaching for a value not listed in the tokens, ask whether that value is justified. The answer is almost always to pick the closest listed value instead.

The "Primary element" block in the user message shows the actual outerHTML of the selected element including nested children when available (truncated if very long). Use this to understand structure before deciding what to change. If the element contains multiple children with similar shapes (a list of cards, a row of buttons), structural mutations should respect that: rebuild the children with consistent styling, not collapse them into a single block. If the user selected a wrapper expecting a section-level change, your html mutation should still preserve the children that exist — don't drop them.

When multiple additional elements are also selected, the same mutations apply to each. Pick mutations that make sense across all of them.

Restructuring is a first-class operation. When the user asks to "stack these," "make this a row," "redesign this layout," "change orientation," "split into columns," or any other request that changes how children sit inside the parent, you SHOULD emit an html mutation that rebuilds the children with the new layout. Combine with style mutations on the parent for layout properties (display/grid/flex), but the html mutation IS the right tool to actually change child structure. Don't avoid it just to keep the response short.

Mutation kinds:
- kind="style": inline CSS. target = property (kebab-case), value = CSS value.
- kind="text": replace textContent of the element. target = "", value = new text. Strips child elements.
- kind="attr": set HTML attribute. target = attribute name, value = new value (src, href, alt, placeholder, title, type, name, value, target, rel, role, aria-label, etc).
- kind="html": replace innerHTML of the element. target = "", value = the new HTML for the inside of the element. The element ITSELF stays — only its children change. Use this for: wrapping text in <strong>/<em>/<a>, adding inline icons (SVG), splitting children into columns, adding badges/pills, restructuring card content, anything that needs new child elements. Never include <script> tags. Never include event handlers (onclick=, etc).

Vague request handling — use these as defaults:
- "make it nicer" / "improve" / "polish" / "make it pretty" → 2-4 tasteful improvements. Common pattern: padding 1.5rem, border-radius 0.75rem, subtle background (#f9fafb or #f5f5f5), font-weight 500, line-height 1.5, transition 200ms.
- "make this section better" → improve THIS element. Don't restructure. Add breathing room (padding) and visual hierarchy (font-weight on headings, neutral-700 secondary text).
- "make it pop" / "stand out" → bold color background (#3b82f6 or #ef4444), white text, higher font-weight, slight border-radius.
- "modernize" / "make it look modern" → softer shadows, rounded corners (0.5-1rem), neutral palette (#171717 text on #ffffff bg), lighter font-weights (400-500 for body, 700 for emphasis).
- "minimal" / "clean" → strip backgrounds, light borders, generous padding, neutral colors.
- For ANY visual request you don't recognize, default to: padding 1.5rem, border-radius 0.5rem, border 1px solid #e5e7eb, background #ffffff. Better than refusing.

Style conventions:
- Property names: kebab-case (color, background-color, font-size, padding, padding-left, margin, font-weight, border-radius, line-height, letter-spacing, box-shadow, border, transition).
- Colors: hex preferred. Tailwind palette: red-500=#ef4444, blue-500=#3b82f6, green-500=#22c55e, neutral-900=#171717, neutral-700=#404040, neutral-500=#737373, neutral-300=#d4d4d4, neutral-100=#f5f5f5, neutral-50=#fafafa, white=#ffffff, black=#000000.
- Spacing: rem in 0.25 increments (0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4rem).
- Font-size scale: 0.75, 0.875, 1, 1.125, 1.25, 1.5, 1.875, 2.25, 3rem.
- Font-weight: 400, 500, 600, 700.
- Box-shadow: prefer "0 1px 3px rgba(0,0,0,0.1)" or "0 4px 6px -1px rgba(0,0,0,0.1)".
- Never output Tailwind class names. Output equivalent CSS values.

You can return multiple mutations of mixed kinds in one response.`

// Few-shot examples covering all three mutation kinds. Order anchors the
// model toward "produce mutations" rather than "refuse."
const FEW_SHOT_MESSAGES = [
  {
    role: 'user' as const,
    content: `Input element: <p class="about-statement">\nText: "Building products since 2018"\nRequest: make it red`,
  },
  {
    role: 'assistant' as const,
    content: `{"mutations":[{"kind":"style","target":"color","value":"#ef4444"}],"rationale":"Set text color to red."}`,
  },
  {
    role: 'user' as const,
    content: `Input element: <h1>\nText: "Welcome"\nRequest: change the text to "Hey there"`,
  },
  {
    role: 'assistant' as const,
    content: `{"mutations":[{"kind":"text","target":"","value":"Hey there"}],"rationale":"Replaced heading text."}`,
  },
  {
    role: 'user' as const,
    content: `Input element: <img class="avatar">\nRequest: change the picture to https://example.com/me.jpg`,
  },
  {
    role: 'assistant' as const,
    content: `{"mutations":[{"kind":"attr","target":"src","value":"https://example.com/me.jpg"}],"rationale":"Updated image source."}`,
  },
  {
    role: 'user' as const,
    content: `Input element: <button class="cta">\nText: "Submit"\nRequest: make it red and say "Buy now"`,
  },
  {
    role: 'assistant' as const,
    content: `{"mutations":[{"kind":"style","target":"background-color","value":"#ef4444"},{"kind":"style","target":"color","value":"#ffffff"},{"kind":"text","target":"","value":"Buy now"}],"rationale":"Red background with white text and updated label."}`,
  },
  {
    role: 'user' as const,
    content: `Input element: <a class="nav-link">\nText: "Home"\nRequest: make this link go to /about instead`,
  },
  {
    role: 'assistant' as const,
    content: `{"mutations":[{"kind":"attr","target":"href","value":"/about"}],"rationale":"Repointed the link to /about."}`,
  },
  {
    role: 'user' as const,
    content: `Input element: <div class="hero">\nRequest: tighter padding and rounded corners`,
  },
  {
    role: 'assistant' as const,
    content: `{"mutations":[{"kind":"style","target":"padding","value":"1.5rem"},{"kind":"style","target":"border-radius","value":"0.75rem"}],"rationale":"Reduced padding to 1.5rem and added rounded corners."}`,
  },
  {
    role: 'user' as const,
    content: `Input element: <div class="active-processes-section">\nRequest: make this section nicer`,
  },
  {
    role: 'assistant' as const,
    content: `{"mutations":[{"kind":"style","target":"padding","value":"2rem"},{"kind":"style","target":"border-radius","value":"0.75rem"},{"kind":"style","target":"background-color","value":"#fafafa"},{"kind":"style","target":"box-shadow","value":"0 1px 3px rgba(0,0,0,0.08)"}],"rationale":"Added breathing room with 2rem padding, soft rounded corners, a subtle off-white background, and a low-key shadow for depth."}`,
  },
  {
    role: 'user' as const,
    content: `Input element: <article class="job-card">\nText: "Software Engineer SAP 2024-25"\nRequest: improve it`,
  },
  {
    role: 'assistant' as const,
    content: `{"mutations":[{"kind":"style","target":"padding","value":"1.5rem"},{"kind":"style","target":"border-radius","value":"0.5rem"},{"kind":"style","target":"border","value":"1px solid #e5e7eb"},{"kind":"style","target":"background-color","value":"#ffffff"},{"kind":"style","target":"transition","value":"all 200ms"}],"rationale":"Tightened the card with 1.5rem padding, soft rounded corners, a thin neutral border, white background, and a smooth transition for hover-ready polish."}`,
  },
  {
    role: 'user' as const,
    content: `Input element: <p>\nText: "Building products since 2018"\nRequest: bold the word "Building"`,
  },
  {
    role: 'assistant' as const,
    content: `{"mutations":[{"kind":"html","target":"","value":"<strong>Building</strong> products since 2018"}],"rationale":"Wrapped 'Building' in a strong tag for emphasis."}`,
  },
  {
    role: 'user' as const,
    content: `Input element: <div class="card">\nText: "Stealth 2026"\nRequest: redesign this card with a status badge and better hierarchy`,
  },
  {
    role: 'assistant' as const,
    content: `{"mutations":[{"kind":"style","target":"padding","value":"1.5rem"},{"kind":"style","target":"border-radius","value":"0.75rem"},{"kind":"style","target":"background-color","value":"#fafafa"},{"kind":"style","target":"border","value":"1px solid #e5e7eb"},{"kind":"html","target":"","value":"<div style=\\"display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem\\"><span style=\\"display:inline-block;background:#22c55e;width:0.5rem;height:0.5rem;border-radius:9999px\\"></span><span style=\\"font-size:0.75rem;color:#737373;text-transform:uppercase;letter-spacing:0.05em\\">Active</span></div><div style=\\"font-weight:600;font-size:1rem;color:#171717\\">Stealth</div><div style=\\"font-size:0.875rem;color:#737373;margin-top:0.25rem\\">2026</div>"}],"rationale":"Restructured the card with a status pill, hierarchical typography, and softer container styling."}`,
  },
]

const MODEL = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4-5'
const REQUEST_TIMEOUT_MS = 20_000

export async function POST(req: Request): Promise<NextResponse<EditResponse>> {
  const t0 = Date.now()

  let body: EditRequest
  try {
    body = (await req.json()) as EditRequest
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  if (!body.prompt || !Array.isArray(body.currentClasses) || !body.tagName) {
    return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'OPENROUTER_API_KEY not set in apps/web/.env.local' },
      { status: 500 },
    )
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
    defaultHeaders: {
      'HTTP-Referer': 'https://kanvis.app',
      'X-Title': 'kanvis',
    },
  })

  // Build the input element preview. If currentHtml is provided and short
  // enough, prefer it (shows nested structure). Otherwise fall back to the
  // tag-only summary.
  function previewFor(req: {
    tagName: string
    currentClasses: string[]
    currentInlineStyle?: string
    currentText?: string
    currentHtml?: string
    childCount?: number
  }): string {
    const classes = req.currentClasses.join(' ')
    const inlineStyle = req.currentInlineStyle ?? ''
    const html = req.currentHtml ?? ''
    // Match the editor-script's capture limit (16KB). The model can handle
    // it, the cost is rounding error.
    if (html && html.length <= 16000) return html
    if (html) return html.slice(0, 16000) + ' …[truncated]'
    const text = (req.currentText ?? '').slice(0, 200)
    const childInfo = req.childCount ? ` (${req.childCount} children)` : ''
    return [
      `<${req.tagName.toLowerCase()}${classes ? ` class="${classes}"` : ''}${inlineStyle ? ` style="${inlineStyle}"` : ''}>${childInfo}`,
      text ? `Text: "${text}"` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  const sections: string[] = []

  // Lead with the site's design tokens — the AI sees them BEFORE the
  // request and treats them as the design source of truth. Structured into
  // clear sections (page, color roles, typography, components, system) so
  // the AI can pick the right value for each kind of mutation it generates.
  if (body.designTokens) {
    const t = body.designTokens
    const blocks: string[] = []

    // PAGE
    if (t.body) {
      const b = t.body
      const pageLines = [
        b.backgroundColor && `background: ${b.backgroundColor}`,
        b.color && `text color: ${b.color}`,
        b.fontFamily && `font: ${b.fontFamily.split(',')[0]?.trim().replace(/['"]/g, '')}`,
        b.fontSize && `base font-size: ${b.fontSize}`,
        b.lineHeight && `line-height: ${b.lineHeight}`,
      ].filter(Boolean) as string[]
      if (pageLines.length) blocks.push(`PAGE\n${pageLines.map((l) => `  ${l}`).join('\n')}`)
    }

    // COLOR ROLES — the highest-leverage info. Tells the AI which color is
    // primary text vs muted secondary vs accent. When the user asks for
    // "make this stand out" the AI picks from accents, not random hex.
    if (t.palette) {
      const p = t.palette
      const paletteLines: string[] = []
      if (p.primaryText) paletteLines.push(`primary text: ${p.primaryText}`)
      if (p.secondaryTexts && p.secondaryTexts.length) {
        paletteLines.push(`secondary text: ${p.secondaryTexts.join(', ')}`)
      }
      if (p.mutedTexts && p.mutedTexts.length) {
        paletteLines.push(`muted/disabled text: ${p.mutedTexts.join(', ')}`)
      }
      if (p.accents && p.accents.length) {
        paletteLines.push(`accent colors (use for CTAs, badges, emphasis): ${p.accents.join(', ')}`)
      }
      if (p.surfaces && p.surfaces.length) {
        paletteLines.push(`surface backgrounds (cards, sections): ${p.surfaces.join(', ')}`)
      }
      if (paletteLines.length) blocks.push(`COLOR ROLES\n${paletteLines.map((l) => `  ${l}`).join('\n')}`)
    }

    // TYPOGRAPHY — per-tag style snapshot. AI now knows h2 vs p vs small.
    if (t.typography && Object.keys(t.typography).length > 0) {
      const typeLines = Object.entries(t.typography)
        .map(([tag, ts]) => {
          const parts = [
            ts.fontSize,
            ts.fontWeight && ts.fontWeight !== '400' ? ts.fontWeight : null,
            ts.color,
            ts.fontFamily,
            ts.textTransform,
            ts.letterSpacing && ts.letterSpacing !== 'normal' ? `tracking ${ts.letterSpacing}` : null,
          ].filter(Boolean)
          return `${tag}: ${parts.join(' · ')}`
        })
      blocks.push(`TYPOGRAPHY\n${typeLines.map((l) => `  ${l}`).join('\n')}`)
    }

    // COMPONENT ARCHETYPES — gives the AI concrete templates to match when
    // it generates new badges, cards, sections.
    if (t.components) {
      const compLines: string[] = []
      if (t.components.card) {
        const c = t.components.card
        compLines.push(
          `card: bg ${c.backgroundColor} · padding ${c.padding} · radius ${c.borderRadius} · ${c.boxShadow ? 'shadow yes' : 'no shadow'}`,
        )
      }
      if (t.components.badge) {
        const b = t.components.badge
        compLines.push(`badge: bg ${b.backgroundColor} · fg ${b.color} · radius ${b.borderRadius} · size ${b.fontSize}`)
      }
      if (t.components.section) {
        const s = t.components.section
        compLines.push(`section: bg ${s.backgroundColor} · padding ${s.padding}`)
      }
      if (t.button) {
        const bt = t.button
        compLines.push(`button: bg ${bt.backgroundColor ?? ''} · fg ${bt.color ?? ''} · radius ${bt.borderRadius ?? ''} · padding ${bt.padding ?? ''}`)
      }
      if (t.link?.color) compLines.push(`link: ${t.link.color}${t.link.textDecoration ? ' · ' + t.link.textDecoration : ''}`)
      if (compLines.length) blocks.push(`COMPONENTS\n${compLines.map((l) => `  ${l}`).join('\n')}`)
    }

    // SYSTEM scale — radii, shadows, spacing, fonts.
    const sysLines: string[] = []
    if (t.radii && t.radii.length > 0) sysLines.push(`radii: ${t.radii.join(', ')}`)
    if (t.shadows && t.shadows.length > 0) sysLines.push(`shadows: ${t.shadows.slice(0, 2).join(' | ')}`)
    if (t.system?.spacingScale && t.system.spacingScale.length > 0) {
      sysLines.push(`spacing scale: ${t.system.spacingScale.slice(0, 6).join(', ')}`)
    }
    if (t.fontFamilies && t.fontFamilies.length > 1) {
      sysLines.push(
        `fonts in use: ${t.fontFamilies.slice(0, 3).map((f) => f.split(',')[0]?.trim().replace(/['"]/g, '')).join(' · ')}`,
      )
    }
    if (sysLines.length) blocks.push(`SYSTEM\n${sysLines.map((l) => `  ${l}`).join('\n')}`)

    if (blocks.length > 0) {
      sections.push(
        `Site design tokens — these ARE the design system. Match them. Do not invent your own colors, fonts, or radii unless the user asks.\n\n${blocks.join('\n\n')}`,
      )
    }
  }

  sections.push(`Primary element:\n${previewFor(body)}`)
  if (body.additional && body.additional.length > 0) {
    sections.push(
      `Additional ${body.additional.length} element${body.additional.length === 1 ? '' : 's'} also selected (apply the same mutations to each):`,
    )
    body.additional.forEach((a, i) => {
      sections.push(`[Element ${i + 2}]\n${previewFor(a)}`)
    })
  }
  sections.push(`Request: ${body.prompt}`)
  const userMessage = sections.join('\n\n')

  console.log(`[/api/edit] → ${MODEL} | prompt: "${body.prompt}"`)

  try {
    const response = (await client.chat.completions.create({
      model: MODEL,
      // Enough headroom for html mutations rebuilding multi-card sections
      // with full design-token-matched inline styles. 4K tokens at Haiku's
      // ~$4/M is ~$0.016 per heavy request — trivial for dogfooding.
      max_tokens: 4096,
      temperature: 0.2,
      stream: false,
      response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
      provider: { require_parameters: true },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...FEW_SHOT_MESSAGES,
        { role: 'user', content: userMessage },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as OpenAI.Chat.Completions.ChatCompletion

    const text = response.choices[0]?.message?.content
    const finishReason = response.choices[0]?.finish_reason ?? 'unknown'

    if (!text) {
      console.warn(`[/api/edit] empty content (finish_reason=${finishReason})`)
      return NextResponse.json({ ok: false, error: `empty_response (${finishReason})` }, { status: 502 })
    }

    // If the model hit max_tokens, the JSON is almost certainly truncated.
    // Surface that clearly instead of letting the user wonder why parse fails.
    if (finishReason === 'length') {
      console.warn(`[/api/edit] response truncated at max_tokens (text length=${text.length})`)
      return NextResponse.json(
        {
          ok: false,
          error:
            'Response was too long and got cut off. Try a smaller selection or a more focused prompt — e.g. one card at a time instead of a whole section.',
        },
        { status: 502 },
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        console.warn(`[/api/edit] non-json content: ${text.slice(0, 200)}`)
        return NextResponse.json({ ok: false, error: 'non_json_response' }, { status: 502 })
      }
      try {
        parsed = JSON.parse(jsonMatch[0])
      } catch (e) {
        console.warn(`[/api/edit] JSON parse failed (finish=${finishReason}, len=${text.length}): ${e instanceof Error ? e.message : e}`)
        return NextResponse.json({ ok: false, error: 'json_parse_error' }, { status: 502 })
      }
    }

    const validated = EditOutput.safeParse(parsed)
    if (!validated.success) {
      console.warn(`[/api/edit] schema validation failed: ${validated.error.message}`)
      return NextResponse.json({ ok: false, error: 'schema_validation_failed' }, { status: 502 })
    }

    const ms = Date.now() - t0
    const mutations = validated.data.mutations as Mutation[]
    const changed = mutations.length > 0

    if (!changed) {
      console.log(`[/api/edit] ⊝ ${ms}ms | no-op | rationale: "${validated.data.rationale}"`)
    } else {
      const summary = mutations
        .map((m) => {
          if (m.kind === 'text') return `text="${m.value.slice(0, 30)}"`
          if (m.kind === 'html') return `html(${m.value.length} chars)`
          return `${m.kind}.${m.target}=${m.value.slice(0, 40)}`
        })
        .join(' | ')
      console.log(`[/api/edit] ✓ ${ms}ms | ${summary}`)
    }

    return NextResponse.json({
      ok: true,
      mutations,
      rationale: validated.data.rationale,
      ms,
      changed,
    })
  } catch (e) {
    const ms = Date.now() - t0
    const message = e instanceof Error ? e.message : 'unknown_error'
    const isTimeout = e instanceof Error && (e.name === 'APIConnectionTimeoutError' || message.includes('timeout'))
    console.error(`[/api/edit] ✗ ${ms}ms | ${isTimeout ? 'TIMEOUT' : 'ERROR'}: ${message}`)
    return NextResponse.json(
      { ok: false, error: isTimeout ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : message },
      { status: 502 },
    )
  }
}
