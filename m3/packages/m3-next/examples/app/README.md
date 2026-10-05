<!-- SPDX-License-Identifier: Apache-2.0 -->

# `@aphrody/m3-next-example`

A Next.js 16 app on the M3 stack: App Router, Cache Components (`use cache`, a static shell with a dynamic `/theme` behind
`<Suspense>`), `proxy.ts`, React Compiler, typed routes, Tailwind v4 (`@aphrody/m3-tailwind`), Base UI wrappers
(`@aphrody/m3-baseui`) rendered from a Server Component, `next/font/local` mapped onto the M3 typefaces, and a route handler.

```sh
bun run build      # next build, on Bun (Turbopack workers included): `yolo m3 next build`
bun run start      # next start
bun run dev        # next dev
bun run test       # configuration and files, without starting Next
```

Through yolo (`yolo web build|dev` runs these scripts), with curl on every route, and cold and warm build times:

```sh
bun ../../scripts/yolo-example.ts check
bun ../../scripts/yolo-example.ts bench
```

The static export for Tauri is `../tauri`. The `AGENTS.md` and `CLAUDE.md` here are written by `next dev`.
