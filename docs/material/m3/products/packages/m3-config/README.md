# @aphrody/m3-config

Shared presets for the first-party Material Design 3 packages (`packages/m3-*`, `packages/m3-react`,
`packages/material-web`). Private; consumed as a `workspace:*` devDependency. Contract and status:
[`docs/plans/ui/design/M3-PLAN.md`](../../../plans/design/M3-PLAN.md), enforced by `bun run bun:check` (rule `m3`).

| Export | Use |
| --- | --- |
| `@aphrody/m3-config/tsconfig.json` | `"extends"` for `tsconfig.json`; the package keeps only `include` and its own overrides. |
| `@aphrody/m3-config/tsconfig.build.json` | Second entry of `"extends": ["./tsconfig.json", "@aphrody/m3-config/tsconfig.build.json"]` (declaration-only emit); the package sets `outDir`, `rootDir`, `include`. |
| `@aphrody/m3-config/tsup` | `m3Tsup({ entry, useClient, ... })`: ESM, es2022, externals for React/Lit/motion/Tailwind/`@aphrody/*`, `'use client'` re-injection. |
| `@aphrody/m3-config/test/dom` | `bun test` preload: happy-dom + ElementInternals polyfill. |

Tests import workspace dependencies through their built `dist/`: the turbo `test` task depends
on `^build`, so `bun run test` always builds them first. Bun resolves bare package specifiers
natively before any runtime plugin sees them, so a preload cannot redirect them to sources.
