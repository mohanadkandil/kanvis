# Kanvis

Live edit on the fly. Paste any URL, edit it visually, share what you'd change.

Design doc: `~/.gstack/projects/mohanadkandil-kanvis/mohannedkandil-mohanadkandil-live-edit-tool-design-20260425-154203.md`

## Workspace layout

```
kanvis/
├── apps/
│   ├── web/          (kanvis.app — Next.js, Vercel — landing + editor shell)
│   └── proxy/        (proxy.kanvis.app — Cloudflare Worker)
└── packages/
    └── core/         (shared types, picker primitive, edit-op schemas)
```

## v0 status

- Foundation scaffold + ARCH-5 interfaces in `packages/core` ✅
- SSRF guard + tests in `apps/proxy` ✅ (the critical gate from /plan-eng-review)
- Worker entry point with SSRF wired, HTMLRewriter pipeline TODO ⏳
- `apps/web` not scaffolded yet (run `bun create next-app apps/web` to bootstrap)

## Build sequence (next steps from the eng review)

1. `bun install` (pulls workspace deps)
2. `bun test` (verify SSRF tests pass before any other code lands)
3. Implement HTMLRewriter pipeline in `apps/proxy/src/index.ts`
4. Scaffold `apps/web` with `bun create next-app apps/web`
5. Wire `packages/core` into `apps/web`, build the editor shell
6. Build the curated demo gallery
7. Ship.

## Architecture decisions (locked in /plan-eng-review)

- **Approach C** (edit-any-URL via server-side proxy) for v0
- **Cloudflare Worker** for the proxy runtime (HTMLRewriter API + KV cache)
- **Bun monorepo** with workspaces
- **Event delegation + MutationObserver** for hydration-proof element picker
- **DOM-only edits** in v0, persisted via URL hash; AST patches + GitHub PRs come in v1
- **SSRF guard before every fetch** — non-negotiable, lives in `apps/proxy/src/ssrf.ts`

See the design doc for the full rationale.
