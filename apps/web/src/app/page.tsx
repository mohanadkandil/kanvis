'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const CURATED = [
  { name: 'Stripe', url: 'https://stripe.com', accent: '#635BFF', tag: 'Payments infra' },
  { name: 'Linear', url: 'https://linear.app', accent: '#5E6AD2', tag: 'Issue tracker' },
  { name: 'Vercel', url: 'https://vercel.com', accent: '#ffffff', tag: 'Frontend cloud' },
  { name: 'Resend', url: 'https://resend.com', accent: '#ff5a1f', tag: 'Email API' },
]

export default function Landing() {
  const router = useRouter()
  const [url, setUrl] = useState('')

  function go(target: string) {
    if (!target) return
    const u = target.startsWith('http') ? target : `https://${target}`
    router.push(`/edit?url=${encodeURIComponent(u)}`)
  }

  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-[#0a0908] text-[#f5f3ee]">
      {/* Film grain over the whole page */}
      <div className="bg-grain absolute inset-0 -z-10" />
      {/* Faint vignette glow at top */}
      <div className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-96 w-[60vw] -translate-x-1/2 rounded-full bg-[#3b82f6]/5 blur-[120px]" />

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-[#1f1c19] bg-[#0a0908]/70 backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="grid h-5 w-5 place-items-center rounded-[5px] bg-[#f5f3ee] text-[#0a0908]">
              <span className="font-serif text-[13px] italic leading-none">k</span>
            </div>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#c8c4bb]">
              kanvis
            </span>
            <span className="ml-1 rounded-full border border-[#1f1c19] px-1.5 font-mono text-[9px] uppercase tracking-wider text-[#6c6862]">
              v0
            </span>
          </div>
          <div className="flex items-center gap-5">
            <a
              href="https://github.com/mohanadkandil/kanvis"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] uppercase tracking-[0.15em] text-[#6c6862] transition hover:text-[#f5f3ee]"
            >
              github
            </a>
            <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-[#6c6862]">
              live edit
            </span>
          </div>
        </div>
      </header>

      <div className="kanvis-stagger mx-auto max-w-6xl px-6">
        {/* Hero — editorial, asymmetric */}
        <section className="grid grid-cols-1 gap-12 pt-24 lg:grid-cols-12 lg:gap-10 lg:pt-32">
          {/* Left: type */}
          <div className="lg:col-span-7">
            <div className="mb-8 flex items-center gap-3">
              <div className="h-px w-10 bg-[#1f1c19]" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8580]">
                A live editor for any website
              </span>
            </div>
            <h1 className="font-serif text-[60px] font-normal leading-[0.95] tracking-tight text-[#f5f3ee] sm:text-[88px] lg:text-[112px]">
              Edit any
              <br />
              website,{' '}
              <span className="italic text-[#f5f3ee]">live</span>
              <span className="text-[#3b82f6]">.</span>
            </h1>
            <p className="mt-8 max-w-md text-base leading-relaxed text-[#c8c4bb] sm:text-lg">
              Paste a URL. Click anything. Describe the change.
              See it happen, instantly. No code.
            </p>

            {/* Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                go(url)
              }}
              className="mt-10 max-w-xl"
            >
              <div className="group relative flex items-center gap-2 rounded-full border border-[#1f1c19] bg-[#14110f]/60 p-1.5 backdrop-blur transition focus-within:border-[#f5f3ee]/60">
                <div className="ml-3 flex items-center gap-2 text-[#6c6862]">
                  <div className="flex gap-1">
                    <div className="h-2 w-2 rounded-full bg-[#1f1c19]" />
                    <div className="h-2 w-2 rounded-full bg-[#1f1c19]" />
                    <div className="h-2 w-2 rounded-full bg-[#1f1c19]" />
                  </div>
                </div>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="paste a url"
                  spellCheck={false}
                  autoComplete="off"
                  className="flex-1 bg-transparent px-2 py-2 font-mono text-sm text-[#f5f3ee] outline-none placeholder:text-[#6c6862]"
                />
                <button
                  type="submit"
                  disabled={!url.trim()}
                  className="group/btn flex items-center gap-2 rounded-full bg-[#f5f3ee] px-5 py-2.5 text-sm font-medium text-[#0a0908] transition hover:bg-[#e8e4d8] disabled:opacity-30 disabled:hover:bg-[#f5f3ee]"
                >
                  <span>Open editor</span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-transform group-hover/btn:translate-x-0.5"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </button>
              </div>
            </form>

            <div className="mt-4 flex items-center gap-2 text-[11px] text-[#6c6862]">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#3b82f6]" />
              <span className="font-mono uppercase tracking-wider">no signup, no install</span>
            </div>
          </div>

          {/* Right: live demo mockup */}
          <div className="lg:col-span-5">
            <BrowserMock />
          </div>
        </section>

        {/* Hairline + meta strip */}
        <div className="my-24 border-t border-[#1f1c19]" />

        {/* Curated examples — editorial card grid */}
        <section>
          <div className="mb-8 flex items-end justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8580]">
                §02
              </div>
              <h2 className="mt-2 font-serif text-3xl text-[#f5f3ee] sm:text-4xl">
                Or open one of these.
              </h2>
            </div>
            <div className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-[#6c6862] sm:block">
              tested · works end-to-end
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1f1c19] bg-[#1f1c19] sm:grid-cols-4">
            {CURATED.map((site) => (
              <button
                key={site.url}
                onClick={() => go(site.url)}
                className="group/tile relative bg-[#0a0908] p-6 text-left transition hover:bg-[#14110f]"
              >
                <div className="flex items-start justify-between">
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: site.accent, boxShadow: `0 0 18px ${site.accent}80` }}
                    aria-hidden
                  />
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-[#6c6862] opacity-0 transition group-hover/tile:translate-x-0.5 group-hover/tile:opacity-100"
                  >
                    <path d="M7 7h10v10" />
                    <path d="M7 17 17 7" />
                  </svg>
                </div>
                <div className="mt-10 font-serif text-2xl text-[#f5f3ee]">{site.name}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[#6c6862]">
                  {site.tag}
                </div>
                <div className="mt-6 truncate font-mono text-[11px] text-[#8a8580]">
                  {new URL(site.url).hostname}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Hairline */}
        <div className="my-24 border-t border-[#1f1c19]" />

        {/* Process — editorial type */}
        <section>
          <div className="mb-10">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8580]">
              §03
            </div>
            <h2 className="mt-2 font-serif text-3xl text-[#f5f3ee] sm:text-4xl">
              Three steps. One window.
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[#1f1c19] bg-[#1f1c19] md:grid-cols-3">
            {[
              {
                n: '01',
                title: 'Paste your URL',
                copy: 'kanvis loads it through a sandbox proxy. Auth-walled or aggressively framed sites won’t work; everything else does.',
              },
              {
                n: '02',
                title: 'Click anything',
                copy: 'Drag handles to nudge spacing. Or open the chat and describe the change in plain language: “make this red,” “restructure this card.”',
              },
              {
                n: '03',
                title: 'See it live',
                copy: 'AI returns a structured set of mutations and they apply instantly. Diffs land in a side panel. Share via URL hash.',
              },
            ].map((s) => (
              <div key={s.n} className="bg-[#0a0908] p-8">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8a8580]">
                  Step {s.n}
                </div>
                <div className="mt-5 font-serif text-2xl text-[#f5f3ee]">{s.title}</div>
                <p className="mt-3 max-w-xs text-sm leading-relaxed text-[#c8c4bb]">{s.copy}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Marquee — small detail near the bottom */}
        <div className="mt-24 overflow-hidden border-y border-[#1f1c19] py-5">
          <div className="kanvis-loop-marquee flex w-fit gap-12 whitespace-nowrap font-serif text-2xl italic text-[#3a3631] sm:text-3xl">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex shrink-0 gap-12">
                {[
                  '“make this red”',
                  '“tighter padding”',
                  '“rename to Mohanad”',
                  '“redesign with a status badge”',
                  '“stack vertically”',
                  '“more breathing room”',
                  '“change the photo”',
                  '“rounder corners”',
                ].map((t, j) => (
                  <span key={j} className="shrink-0">
                    {t}
                    <span className="ml-12 text-[#1f1c19]">·</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <footer className="flex flex-col items-start justify-between gap-3 py-10 sm:flex-row sm:items-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6c6862]">
            kanvis · v0 beta · built solo
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6c6862]">
            previews only · pr shipping in v1
          </div>
        </footer>
      </div>
    </main>
  )
}

/**
 * BrowserMock — a static-but-animated browser frame that loops through the
 * actual kanvis interaction (hover → click → describe → applied) so the
 * landing has a real product moment instead of a generic feature list.
 */
function BrowserMock() {
  return (
    <div className="relative">
      {/* Outer frame */}
      <div className="relative overflow-hidden rounded-2xl border border-[#1f1c19] bg-[#14110f] shadow-2xl shadow-black/50">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-[#1f1c19] bg-[#0a0908] px-3 py-2.5">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-[#1f1c19]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#1f1c19]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#1f1c19]" />
          </div>
          <div className="ml-2 flex flex-1 items-center gap-1.5 rounded-full bg-[#14110f] px-2.5 py-0.5 text-[10px] text-[#6c6862]">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="font-mono">kandil.io</span>
          </div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-[#3b82f6]">
            kanvis on
          </div>
        </div>

        {/* Iframe stage — fake page content with kanvis editing happening */}
        <div className="relative h-[420px] bg-[#e8e3d3] p-6 font-mono text-[#0a0908]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#737373]">(01) Active</div>

          {/* The "highlighted" element — outline pulses, text color morphs */}
          <div className="kanvis-loop relative mt-3 inline-block rounded-[2px] bg-[#f0ebd9] px-4 py-3">
            <div className="text-[14px] font-bold leading-snug">
              <span className="kanvis-loop-color">BUILDING SOMETHING BIG</span>
            </div>
            <div className="mt-1 text-[11px] text-[#737373]">STEALTH</div>
            <div className="mt-0.5 text-[10px] text-[#a3a3a3]">2026—</div>
          </div>

          {/* A second card — static, for context */}
          <div className="mt-3 inline-block rounded-[2px] bg-[#f0ebd9] px-4 py-3">
            <div className="text-[14px] font-bold leading-snug text-[#0a0908]">RESEARCHER</div>
            <div className="mt-1 text-[11px] text-[#737373]">MIT MEDIA LAB</div>
            <div className="mt-0.5 text-[10px] text-[#a3a3a3]">2024—</div>
          </div>

          {/* Floating cursor that appears, clicks, then descends */}
          <div className="kanvis-loop-cursor pointer-events-none absolute left-[180px] top-[88px]">
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
              <path d="M2 1.5 L13 12 L7.5 12.5 L11 18 L9 19 L5.5 13 L1.5 16 Z" fill="#0a0908" stroke="#f5f3ee" strokeWidth="1.2" />
            </svg>
          </div>

          {/* Floating chat bubble at the bottom of the iframe stage */}
          <div className="kanvis-loop-chat absolute bottom-4 left-1/2 w-[280px] -translate-x-1/2 rounded-xl border border-[#1f1c19] bg-[#0a0908] px-3 py-2 shadow-xl">
            <div className="flex items-center gap-1.5 text-[9px] text-[#8a8580]">
              <span className="inline-block h-1 w-1 rounded-full bg-[#3b82f6]" />
              <span className="font-mono uppercase tracking-wider">Editing div</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="flex-1 text-[12px] text-[#f5f3ee]">make this red</span>
              <span className="rounded-md bg-[#f5f3ee] px-2 py-0.5 text-[9px] font-medium text-[#0a0908]">
                Apply
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Caption strip below the mock */}
      <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-[#6c6862]">
        <span>real interaction · 6s loop</span>
        <span>kanvis selection in #3b82f6</span>
      </div>
    </div>
  )
}
