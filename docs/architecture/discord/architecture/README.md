<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody Discord Architecture & Upstream Consolidation

> [!NOTE]
> Canonical documentation for Discord architecture and standalone native compilation is located at:
> - [**Aphrody Discord Architecture**](../README.md)
> - [**Discord Bot Compiler Architecture (`aphrody-discord-compiler`)**](../COMPILER.md)
> - [**Discord Operations & Systemd Units**](../../../operations/discord/SYSTEMD-SERVICES.md)

This directory preserves historical audits and records the completion of the Discord architecture consolidation in the Aphrody monorepo.

---

## 1. Audited Upstreams Status

| Repository or bot | Historical Audit | Current Status (October 2026) |
| --- | --- | --- |
| **Aphrody AI messaging** | [aphrody-ai-messaging-discord.md](./upstreams/aphrody-ai-messaging-discord.md) | Fully ported and active as `@aphrody/discord-kit/messaging` (`packages/discord/kit/src/messaging.ts`). Zero-runtime-dependency REST channel transport. |
| **Shenron** | `shenron:docs/architecture/APHRODY-DISCORD-INTEGRATION.md` ([aphrody-labs/shenron](https://github.com/aphrody-labs/shenron)) | Fully autonomous using `@aphrody/discord-kit`. Compiles to standalone native binary `dist/shenron` (not in repo) (generated or machine-local artifact; presence depends on the build host) (~151.6 MB) executed by `shenron-bot.service`. |
| **Rose Griffon (`rg`)** | [rg-discord-bots.md](https://github.com/aphrody-labs/iecode/blob/main/docs/rg/architecture/rg-discord-bots.md) | Fully autonomous using `@aphrody/discord-kit`. Dynamic profile dispatch (`rg` vs `azalee`) via static loader registry `src/modules.ts`. Compiles to native binary `dist/rg-bot` (not in repo) (generated or machine-local artifact; presence depends on the build host) (~144.9 MB) executed by `rg-bot.service`. |
| **NIE Wunderbot** | [nie-wunderbot.md](https://github.com/aphrody-labs/iecode/blob/main/docs/nie/nie-wunderbot.md) | Historical upstream review; superseded by shared framework. |

---

## 2. Consolidation Completion Status (October 1, 2026)

All six phases of the original consolidation plan have been **fully achieved**:

1. **Shared contracts:** Stabilized in `@aphrody/discord-kit/messaging` (platform-neutral channel contracts, 9 unit tests passing, tsdown build).
2. **One Discord runtime (`@aphrody/discord-kit`):** Centralized in `packages/discord/kit` with intent preflight checks (`resolveGrantedIntents`), production cache limits and sweepers (`createProductionCacheOptions`), resilient interaction error recovery (`safeExecuteInteraction`), and runtime detection (`isCompiledBinary`).
3. **Elimination of upstream forks:** The legacy nested fork `upstream/discord` (3.9 GB, 2,232 files) was entirely deleted. Dependencies are resolved strictly via npm catalog entries (`workspaces.catalog`) in the root `package.json` under **Bun 1.4.2** and **TypeScript 7.0.2**.
4. **App migration:** `@shenron/bot`, `@rosegriffon/bot`, and `@rosegriffon/achillea-bot` now consume `@aphrody/discord-kit` and catalog dependencies.
5. **Standalone Native Compiler:** Crate `crates/discord/aphrody-discord-compiler` (not in repo) (retired source path; retained as historical evidence) and `crates/infra/aphrody-command/src/discord_cmd.rs` provide native compilation (`aphrody discord compile all --smoke`) producing self-contained native binaries (`dist/shenron` (not in repo) (generated or machine-local artifact; presence depends on the build host), `dist/rg-bot` (not in repo) (generated or machine-local artifact; presence depends on the build host)).
6. **Release & verification gate:** `bun run discord:verify --compile` runs catalog verification, kit unit tests, messaging unit tests, bot test suites (412 tests for Shenron, 1,228 tests for RG), and standalone binary smoke tests with 100% pass rate.
