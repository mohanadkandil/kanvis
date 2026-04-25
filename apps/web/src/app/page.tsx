'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const CURATED = [
  { name: 'Stripe', url: 'https://stripe.com' },
  { name: 'Linear', url: 'https://linear.app' },
  { name: 'Vercel', url: 'https://vercel.com' },
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
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-12 px-6">
      <header className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight">kanvis</h1>
        <p className="mt-3 text-lg text-neutral-600 dark:text-neutral-400">
          Paste any URL. Edit it live. No words required.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          go(url)
        }}
        className="flex w-full gap-2"
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-site.com"
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
        />
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-5 py-3 text-base font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Edit it
        </button>
      </form>

      <section className="w-full">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Or try one of these
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {CURATED.map((site) => (
            <button
              key={site.url}
              onClick={() => go(site.url)}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-6 text-left transition hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-600"
            >
              <div className="text-base font-medium">{site.name}</div>
              <div className="mt-1 text-xs text-neutral-500">{new URL(site.url).hostname}</div>
            </button>
          ))}
        </div>
      </section>

      <footer className="text-center text-xs text-neutral-500">
        Beta. Most sites work, some break (auth-walled, framebusters). Edits are previews
        for now — PR shipping comes in v1.
      </footer>
    </main>
  )
}
