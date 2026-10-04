<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody Discord Ecosystem

[![Bun](https://img.shields.io/badge/runtime-Bun%201.4.2-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/typescript-7.0.2-blue?logo=typescript)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/compiler-Rust%202024-orange?logo=rust)](https://rust-lang.org)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE.txt)

Aphrody Discord provides a sovereign, unified Discord bot platform and native compilation toolchain for all Aphrody bots and services.

Historically reliant on a 3.9 GB vendored snapshot (`upstream/discord`), the ecosystem has transitioned to **100% monorepo autonomy** using standard npm dependencies via `workspaces.catalog`, dedicated shared packages, a Rust + Bun compiler, and zero-dependency standalone native binaries.

---

## 1. Product & Package Map

```
aphrody/
├── packages/discord/
│   ├── kit/                  # @aphrody/discord-kit — Shared runtime, intents, cache & lifecycle
│   └── aphrody-messaging/    # @aphrody/messaging — Zero-dependency channel & REST adapter
├── crates/discord/
│   └── aphrody-discord-compiler/ # aphrody-discord-compiler — Native Rust + Bun AOT orchestrator
├── apps/
│   ├── shenron/bot/          # @shenron/bot — Dragon Ball bot + Public HTTP/REST/GraphQL API
│   │   └── dist/shenron      # Native standalone binary (~151.6 MB)
│   └── rg/
│       ├── bot/              # @rosegriffon/bot — Rose Griffon & Azalée community bot
│       │   └── dist/rg-bot   # Native standalone binary (~144.9 MB)
│       └── achillea-bot/     # @rosegriffon/achillea-bot — Tournament engine bot
└── systemd/
    ├── shenron-bot.service   # Systemd unit running dist/shenron
    └── rg-bot.service        # Systemd unit running dist/rg-bot
```

### Shared Packages

| Package | Path | Purpose | Dependencies |
| :--- | :--- | :--- | :--- |
| **`@aphrody/discord-kit`** | `packages/discord/kit` | Intent preflight checks, production cache sweepers, safe interaction dispatcher, guards, runtime environment detection (`isCompiledBinary`). | `discordx`, `discord.js`, `reflect-metadata` |
| **`@aphrody/messaging`** | `packages/discord/aphrody-messaging` | Channel contracts (`ChannelPort`), message & file sending, room discovery, inbox streaming, and 429 rate limit backoff. | Zero package dependencies (pure Web API & Bun) |

### Consumer Applications

| Application | Domain | Standalone Binary | Systemd Unit |
| :--- | :--- | :--- | :--- |
| **`@shenron/bot`** | Dragon Ball universe, card games, OCR, public API (`:5006`) | `dist/shenron` (~151.6 MB) | `yolo/config/host/systemd/shenron/shenron-bot.service` |
| **`@rosegriffon/bot`** | Inazuma Eleven community, Azalée game bot, moderation, XP | `dist/rg-bot` (~144.9 MB) | `iecode/config/rg/host/systemd/rg-bot.service` |
| **`@rosegriffon/achillea-bot`** | Inazuma Eleven tournament automation | `dist/achillea` | `iecode/config/rg/host/systemd/rg-achillea-bot.service` |

---

## 2. Autonomy and Upstream Elimination

On **October 1, 2026**:
- **3.9 GB freed**: The nested `upstream/discord` checkout (2,232 files) was removed entirely from the repository.
- **Root Catalog (`workspaces.catalog`)**: All Discord libraries are centrally pinned in root `package.json`:
  - `discordx`: `11.13.3`
  - `@discordx/di`: `^3.3.4`
  - `@discordx/pagination`: `^4.4.2`
  - `@discordx/importer`: `^1.3.3`
  - `@discordx/utilities`: `^8.0.0`
  - `discord.js`: `^14.27.0`
  - `discord-api-types`: `^0.38.55`
  - `@discordjs/rest`: `^2.6.3`
- **Compiler Toolchain**: Bun 1.4.2 and TypeScript 7.0.2 across all packages.

---

## 3. Native Standalone Binaries

Aphrody Discord bots are compiled ahead-of-time (AOT) into standalone native executable binaries using Bun's native compiler orchestrated by Rust (`aphrody-discord-compiler`).

### Compilation Pipeline Highlights

1. **Reflection & Decorator Ordering (`src/entry-standalone.ts`)**:
   Guarantees that `reflect-metadata` is loaded synchronously into memory before TypeScript decorators (`@Discord`, `@Slash`, `@Guard`) are evaluated. Also provides standard CLI flags (`--help`, `--version`, `--dry-run`) without opening a Discord connection.
2. **Static Loader Table (`iecode/apps/rg/bot/src/modules.ts`)**:
   Replaces dynamic directory scans (`fs.readdirSync`) with explicit static import loaders (`MODULE_LOADERS`), allowing Bun's bundler to discover and compile all 50+ command modules while preserving runtime profile selection (`rg` vs `azalee`).
3. **Host Zero-Dependency Model**:
   The output binaries (`dist/shenron`, `dist/rg-bot`) are completely self-contained. Target hosts running `systemd` do not need `node_modules` or a host Bun installation.

---

## 4. Key Workflows & Commands

### Compiling Discord Bots

```bash
# Compile both Shenron and RG bots with smoke testing via Aphrody CLI
aphrody discord compile all --smoke

# Or using the root Bun script
bun run discord:compile all --smoke

# Compile a specific target
aphrody discord compile shenron
aphrody discord compile rg
```

### Inspecting Bot Integrity

```bash
# Inspect bot TypeScript decorators and Oxc AST syntax
aphrody discord inspect shenron
aphrody discord inspect rg --json
```

### Verification Gate

Run the comprehensive monorepo verification gate:
```bash
bun run discord:verify --compile
```
This single gate verifies:
1. Catalog consistency (8 packages)
2. `@aphrody/discord-kit` (typecheck, 16 unit tests, build)
3. `@aphrody/messaging` (typecheck, 9 unit tests, build)
4. Consumer bots (`@shenron/bot` 412 unit tests, `@rosegriffon/bot` 1,228 unit tests)
5. Standalone native compilation (`dist/shenron`, `dist/rg-bot`) and smoke test execution (`--help`).
