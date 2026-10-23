<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-config

Shared development presets for Material 3 packages: tsconfig bases, the `Bun.build` package preset, a `bun:sqlite` UI cache and a happy-dom test preload.

```sh
bun add -d @aphrody/m3-config
```

```ts
// build.config.ts (tsconfig.json: { "extends": "@aphrody/m3-config/tsconfig.json" })
import { m3Package } from "@aphrody/m3-config/bun-build";

export default m3Package({ entry: ["src/index.ts"] });
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

Contract and status: [M3-PLAN.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/plans/design/M3-PLAN.md).

| Export                                   | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@aphrody/m3-config/tsconfig.json`       | `"extends"` for `tsconfig.json`; the package keeps only `include` and its own overrides.                                                                                                                                                                                                                                                                                                                                                           |
| `@aphrody/m3-config/tsconfig.build.json` | Second entry of `"extends": ["./tsconfig.json", "@aphrody/m3-config/tsconfig.build.json"]` (declaration-only emit); the package sets `outDir`, `rootDir`, `include`.                                                                                                                                                                                                                                                                               |
| `@aphrody/m3-config/bun-build`           | The one build preset, on `Bun.build`: `m3Package({ entry, target, splitting, external, useClient })` types a package's `build.config.ts`; `scripts/m3/build.ts` at the repository root runs every config (dependency order, content-hash cache, declarations through native `bun check`). `m3BunBuild(...)` is the imperative form; `M3_EXTERNAL` and `prependUseClient` (`'use client';` through `Bun.file` / `Bun.write`) are defined once here. |
| `@aphrody/m3-config/cache-db`            | `M3UiCache` / `getSharedUiCache()`: embedded SQLite cache on `bun:sqlite` (WAL mode) for themes, icons, tokens, sessions.                                                                                                                                                                                                                                                                                                                          |
| `@aphrody/m3-config/test/dom`            | `bun test` preload: happy-dom + ElementInternals polyfill.                                                                                                                                                                                                                                                                                                                                                                                         |

Workspace packages resolve to their sources under Bun (`bun` / `import` conditions); `dist/` is built by
`bun scripts/build.ts` for consumers that need the `default` condition and the declarations. Bun resolves bare
package specifiers natively before any runtime plugin sees them, so a preload cannot redirect them to sources.
