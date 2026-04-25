import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'

type EditRequest = {
  selector: string
  tagName: string
  currentClasses: string[]
  prompt: string
}

type EditResponse =
  | { ok: true; before: string; after: string; rationale: string; ms: number }
  | { ok: false; error: string }

// Looser than strict json_schema — works with brand-new models that don't yet
// support constrained decoding. We get JSON object enforcement at the API
// layer, then validate the shape with Zod ourselves.
const EditOutput = z.object({
  after: z.string().min(1),
  rationale: z.string().max(280).optional().default(''),
})

const SYSTEM_PROMPT = `You transform Tailwind CSS class strings on HTML elements based on natural language requests.

Output ONLY a JSON object: {"after": "<new class string>", "rationale": "<one short sentence>"}.
No prose, no markdown fences, no preamble.

Rules:
- Use only standard Tailwind v4 utility classes — no arbitrary values like p-[13px] unless the user asks for it specifically.
- Preserve any existing classes that are not relevant to the request.
- For spacing requests ("tighter", "more padding"), step ±1 on the Tailwind spacing scale (e.g. p-3 → p-4 for "more", p-3 → p-2 for "less").
- For color requests ("make it red"), pick a sensible Tailwind color class (e.g. bg-red-500, text-red-500). Match the existing color scale (-500, -600, etc.) if there is one.
- For font/size requests, use text-sm/text-base/text-lg/text-xl/text-2xl progression.
- If the request is ambiguous or unsafe (would break layout), output the same classes unchanged with rationale explaining why.
- Never invent custom CSS, never use inline styles, never reference variables that don't exist.`

const MODEL = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-flash'
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

  const before = body.currentClasses.join(' ')
  const userMessage = `Element: <${body.tagName.toLowerCase()} class="${before}">

Request: ${body.prompt}

Reply with JSON only.`

  console.log(`[/api/edit] → ${MODEL} | prompt: "${body.prompt}" | classes: "${before}"`)

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 256,
      temperature: 0.2,
      // json_object mode is broadly supported across providers and doesn't
      // require strict json_schema, which some new models don't fully implement.
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    })

    const text = response.choices[0]?.message?.content
    if (!text) {
      const finish = response.choices[0]?.finish_reason ?? 'unknown'
      console.warn(`[/api/edit] empty content (finish_reason=${finish})`)
      return NextResponse.json({ ok: false, error: `empty_response (${finish})` }, { status: 502 })
    }

    // Defensive parse — strip markdown code fences if a model adds them.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn(`[/api/edit] no JSON in response: ${text.slice(0, 200)}`)
      return NextResponse.json({ ok: false, error: 'no_json_in_response' }, { status: 502 })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (e) {
      console.warn(`[/api/edit] JSON parse failed: ${e instanceof Error ? e.message : e}`)
      return NextResponse.json({ ok: false, error: 'json_parse_error' }, { status: 502 })
    }

    const validated = EditOutput.safeParse(parsed)
    if (!validated.success) {
      console.warn(`[/api/edit] schema validation failed: ${validated.error.message}`)
      return NextResponse.json({ ok: false, error: 'schema_validation_failed' }, { status: 502 })
    }

    const ms = Date.now() - t0
    console.log(`[/api/edit] ✓ ${ms}ms | after: "${validated.data.after}"`)

    return NextResponse.json({
      ok: true,
      before,
      after: validated.data.after.trim(),
      rationale: validated.data.rationale,
      ms,
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
