<!-- SPDX-License-Identifier: Apache-2.0 -->

# Discord Qualification and Upstream Elimination Report

Date: **October 1, 2026**  
Status: **100% QUALIFIED AND GREEN**

This report records the complete qualification of Discord contracts, runtime packages, consumer bots, and standalone compilation pipelines in the Aphrody monorepo.

---

## 1. Executive Summary

- **Elimination of `upstream/discord`**: 3.9 GB (2,232 files) of legacy vendored snapshots of Discord.js and DiscordX were removed.
- **Root Catalog Locking**: All 8 canonical Discord packages are pinned centrally in `workspaces.catalog` under Bun 1.4.2 and TypeScript 7.0.2.
- **Unified Bot Core (`@aphrody/discord-kit`)**: Created to handle intent preflight negotiation, long-running production cache sweepers, resilient interaction error dispatching, and runtime detection.
- **Rust + Bun Standalone Compiler (`aphrody-discord-compiler`)**: Crate in `crates/discord/aphrody-discord-compiler` orchestrating Oxc AST linting, pre-build hooks, and AOT compilation (`bun build --compile`) producing zero-dependency standalone native binaries (`dist/shenron`, `dist/rg-bot`).
- **Systemd Units Migration**: `shenron-bot.service` and `rg-bot.service` updated to run standalone binaries directly without `node_modules` or a host Bun runtime.

---

## 2. Verification Gate Suite (`discord:verify --compile`)

Run the comprehensive monorepo verification gate:
```bash
bun run discord:verify --compile
# or
aphrody discord verify
```

### Gate Breakdown and Results

| Gate | Target | Scope | Result | Details |
| :--- | :--- | :--- | :--- | :--- |
| **1. Catalog Contract** | `package.json` | 8 required packages | **PASS** | `discordx`, `@discordx/di`, `@discordx/pagination`, `@discordx/importer`, `@discordx/utilities`, `discord.js`, `discord-api-types`, `@discordjs/rest` |
| **2. Core Kit** | `@aphrody/discord-kit` | Typecheck, Unit Tests, Build | **PASS** | 16/16 unit tests passed (180 ms); `tsdown` ESM + DTS build complete |
| **3. Channel Adapter** | `@aphrody/messaging` | Typecheck, Unit Tests, Build | **PASS** | 9/9 unit tests passed (106 ms); `tsdown` ESM + DTS build complete |
| **4. Shenron Bot** | `@shenron/bot` | Typecheck, Test Suite | **PASS** | 412/412 unit tests passed |
| **5. Rose Griffon Bot** | `@rosegriffon/bot` | Test Suite | **PASS** | 1,228/1,228 unit tests passed |
| **6. Native AOT Compilation** | `all` (`shenron`, `rg`) | Standalone Binary + Smoke | **PASS** | `dist/shenron` (~151.6 MB) & `dist/rg-bot` (~144.9 MB); `--help` clean exit 0 |

Total Test Coverage: **1,665 automated tests passed, 0 failures.**

---

## 3. Standalone Compilation Metrics

| Metric | Shenron Discord Bot | Rose Griffon Discord Bot |
| :--- | :--- | :--- |
| **Package** | `@shenron/bot` (`apps/shenron/bot`) | `@rosegriffon/bot` (`apps/rg/bot`) |
| **Entrypoint** | `src/entry-standalone.ts` | `src/entry-standalone.ts` |
| **Modules Bundled** | 2,470 modules | 959 modules |
| **Pre-build Step** | Tailwind CSS v4 generation for dashboard | None |
| **Minification Savings** | -75.12 MB (estimate) | -70.94 MB (estimate) |
| **Compilation Time** | ~26.3 seconds | ~4.4 seconds |
| **Binary Output** | `apps/shenron/bot/dist/shenron` | `apps/rg/bot/dist/rg-bot` |
| **Binary Size** | 151.58 MB | 144.90 MB |
| **Format** | ELF 64-bit LSB executable, x86-64 | ELF 64-bit LSB executable, x86-64 |
| **Smoke Execution** | `dist/shenron --help` (exit 0) | `dist/rg-bot --help` (exit 0) |

---

## 4. Key Engineering Resolutions

### 4.1 Reflection Timing (`entry-standalone.ts`)
In bundled standalone binaries, decorators throw `TypeError: undefined is not an object (evaluating 'descriptor.value')` if `reflect-metadata` is evaluated out of order. `entry-standalone.ts` forces synchronous evaluation of `reflect-metadata` before `import("./index")`, while providing immediate command-line flag handling (`--help`, `--version`, `--dry-run`).

### 4.2 Dynamic Discovery via Static Loaders (`apps/rg/bot/src/modules.ts`)
`bun build --compile` cannot analyze dynamic runtime directory traversals. The static loader map (`MODULE_LOADERS: Record<string, () => Promise<unknown>>`) allows Bun's AOT bundler to trace and package all 50+ command modules into the binary, while maintaining dynamic runtime profile dispatch (`rg` vs `azalee`).

### 4.3 Worker Thread Logger Workaround in Standalone Mode
Worker thread transports (`pino-pretty`) fail in standalone binaries because child threads cannot resolve virtual filesystem paths (`$bunfs`). `@aphrody/discord-kit/src/runtime.ts` exposes `isCompiledBinary()` so loggers safely fall back to synchronous formatted stdio.

### 4.4 Systemd Zero-Dependency Operation
`shenron-bot.service` and `rg-bot.service` directly execute `/srv/{app}/current/apps/bot/dist/{binary}`, requiring no host `node_modules` or Bun binary installation on production servers.
