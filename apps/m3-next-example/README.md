<!-- SPDX-License-Identifier: Apache-2.0 -->

# `@aphrody/m3-next-example`

A Next.js 16 app on the M3 stack: App Router, Cache Components (`use cache`, a static shell with a dynamic `/theme` behind
`<Suspense>`), `proxy.ts`, React Compiler, typed routes, Tailwind v4 (`@aphrody/m3-tailwind`), Base UI wrappers
(`@aphrody/m3-baseui`) rendered from a Server Component, `next/font/local` mapped onto the M3 typefaces, and a route handler.

```sh
bun run build      # next build, on Bun (Turbopack workers included): `m3-next build`
bun run start      # next start
bun run dev        # next dev
bun run test       # configuration and files, without starting Next
```

Use the canonical example runner for route checks and cold/warm build measurements:

```sh
bun ../../packages/m3-next/scripts/examples.ts check
bun ../../packages/m3-next/scripts/examples.ts bench
```

The static export for Tauri is `../m3-next-tauri-example`. The `AGENTS.md` and `CLAUDE.md` here are written by `next dev`.
