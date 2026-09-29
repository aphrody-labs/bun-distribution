# Aphrody Discord architecture

This monorepo is the shared home for Discord transport and runtime capabilities used across Aphrody repositories. Applications keep their own domain logic, persistence, and product APIs; shared packages own reusable Discord contracts, REST/Gateway/interaction adapters, and framework integrations.

## Audited upstreams

| Repository or bot | Audit | Main shape |
| --- | --- | --- |
| Aphrody AI messaging | [aphrody-ai-messaging-discord.md](upstreams/aphrody-ai-messaging-discord.md) | Rust messaging contract and REST-only Discord adapter, now ported as Bun-first `@aphrody/messaging`. |
| Shenron | [Shenron integration](../../shenron/docs/APHRODY-DISCORD-INTEGRATION.md) | Bun Dragon Ball bot; keeps commands, canon, auth, PostgreSQL/SQLite and API while adopting shared Discord transport incrementally. |
| Rosegriffon (`rg`) | [rg-discord-bots.md](upstreams/rg-discord-bots.md) | Separate DiscordX bot and Achillea application with substantial REST, Socket.IO, persistence, and tournament domains. |
| NIE Wunderbot | [nie-wunderbot.md](upstreams/nie-wunderbot.md) | Current upstream and published package review; local NIE checkout was not a valid source at audit time. |

Reports document dependency names and configuration key names only. They do not copy secrets or claim that all upstream runtime states are deployed.

## Current shared package

`packages/aphrody-messaging` contains the platform-neutral channel data contract and a Bun-native Discord REST adapter. It supports text/file sends, DM creation, room discovery, and cancellable polling. The adapter uses the maintained `@discordjs/rest` client for authentication, rate limits, and retries; `Bun.file` supplies upload bytes.

The legacy inbox poller is a compatibility path, not the preferred event runtime. A shared production framework should use a single Gateway connection for gateway events, and a separately selected signed HTTP interactions endpoint where that deployment mode is required. Discord only permits one interaction delivery mode per application at a time; configure the application's deployment mode explicitly.

## Consolidation plan

1. **Shared contracts:** stabilize message, attachment, room, error, and capability types in `@aphrody/messaging`; keep transport operations injectable for application testing.
2. **One Discord runtime:** centralize token validation, REST rate-limit/retry behavior, Gateway lifecycle/reconnect/sharding, interaction signature validation, command registration, and health/readiness contracts in shared packages. Keep Gateway and HTTP interaction delivery as explicit mutually exclusive modes.
3. **Framework adapters:** provide thin adapters for the chosen Discord framework(s). Reuse Discord.js or DiscordX only where their maintained API adds value; do not duplicate their gateway or REST stacks in Aphrody packages.
4. **App migration:** migrate Aphrody AI notifications first, then RG and Achillea, then NIE Wunderbot. Each application retains its domain modules, database schemas, job queues, and product-specific commands; replace only shared Discord infrastructure.
5. **Compatibility and retirement:** add import-boundary checks and package dependency audits; preserve old entry points as short-lived facades, migrate consumers, then remove duplicate clients and stale packages.
6. **Release gate:** require Bun typecheck/lint, focused adapter tests with mocked Fetch/WebSocket, package export checks, and a test-guild smoke run before publishing a shared package.

## Ownership boundary

Shared framework code may own Discord protocols and common runtime lifecycle. It must not own Shenron/RG/NIE content models, application database access, bot-specific authorization policy, or secrets. Each consuming app supplies those through explicit interfaces.
