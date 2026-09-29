# Aphrody Discord

[![Build](https://github.com/aphrody-code/aphrody-discord/actions/workflows/build.yml/badge.svg)](https://github.com/aphrody-code/aphrody-discord/actions/workflows/build.yml)
[![Bun](https://img.shields.io/badge/runtime-Bun%201.4.2-black?logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE.txt)

A Bun-managed TypeScript monorepo for developing Discord libraries and bots. It
combines current source snapshots from [Discord.js](https://github.com/discordjs/discord.js)
and [DiscordX](https://github.com/discordx-ts/discordx); upstream package
sources remain under their original names and keep their license notices.
This repository is the shared home for reusable Aphrody Discord transport and
runtime packages. Applications retain their own domain logic, persistence,
authorization policy and secrets. The project removes duplicated Discord
clients without creating a second bot runtime.

## Goal and ownership

The goal is one maintained Discord foundation for Aphrody applications:

- shared contracts for messages, attachments, rooms, capabilities and errors;
- one tested REST/Gateway/interaction lifecycle per Discord application;
- thin Discord.js and DiscordX adapters where their APIs add value;
- Bun-native packages consumable by Shenron, RG, Achilléa and Aphrody
  notifications.

This repository owns Discord protocol and framework code. It does not own
Dragon Ball or RG commands, application databases, business authorization,
OAuth grants, production tokens or deployment. Those remain with the consuming
application and `aphrody-infra`.

## Workspaces

- `packages/*`: Discord.js, DiscordX, and their support packages.
- `apps/guide` and `apps/website`: Discord.js guides and API website.
- `apps/proxy-container`: Discord.js proxy service.
- `docs`: DiscordX framework documentation.
- `apps/carbon-example`: small Bun runtime example using Carbon from npm.
- `packages/aphrody-messaging`: shared message contracts and Bun-native Discord
  REST adapter (send text/files, create DMs, enumerate rooms, cancellable inbox
  polling), with no direct runtime package dependencies.

### Package map

| Package family                                   | Purpose                                               | Provenance                  |
| ------------------------------------------------ | ----------------------------------------------------- | --------------------------- |
| `@aphrody/messaging`                             | Message/room contracts and injectable REST operations | Aphrody-owned               |
| `discord.js`, `@discordjs/*`, `create-discord-*` | Discord REST, Gateway, builders, docs and examples    | Discord.js snapshot         |
| `discordx`, `@discordx/*`                        | Decorators, DI, importers, pagination and utilities   | DiscordX snapshot           |
| `@aphrody/carbon-example`                        | OAuth/interactions development example                | Aphrody integration example |

See [upstream provenance](../../reference/discord/UPSTREAMS.md) for exact revisions, licenses and
refresh rules; the repository never silently replaces an upstream snapshot.
See the
[stack notes](../../reference/discord/STACK.md) for the framework comparison and development tools.
See [shared architecture and upstream bot audits](../../architecture/discord/architecture/README.md)
for the Aphrody AI, RG/Achilléa and NIE architecture reports and the migration
plan toward one shared Discord framework. The current package map and remaining
work are tracked in [docs/PLAN.md](../../plans/discord/PLAN.md); the executable blocker and
release plan is [PLAN-DISCORD.md](../../plans/discord/PLAN-DISCORD.md). Carbon's OAuth scopes,
installation permissions, and Discord approval limits are documented in
[docs/carbon-oauth.md](../../reference/discord/carbon-oauth.md).

## Commands

Requires Bun `1.4.2` or newer and TypeScript `7` from the workspace catalog.

```sh
bun install
bun run check
bun run format
bun run typecheck
bun run build
bun run test
```

Check the messaging adapter independently with
`cd packages/aphrody-messaging && bun run typecheck`.

Run a docs site with `bun run dev:discordx-docs`,
`bun run dev:discordjs-guide`, or `bun run dev:discordjs-website`.

The imported upstream apps may require additional service credentials and
external services for deploy or production builds. No upstream `.env` files are
included; use local untracked environment files when needed.

## Consumer integration

Consumers should depend on a published package or an explicit immutable commit,
not on an implicit sibling checkout. Shenron is migrating its transport boundary
while retaining its commands, canon, PostgreSQL/SQLite, API and auth; see its
[integration note](https://github.com/aphrody-code/shenron/blob/main/docs/APHRODY-DISCORD-INTEGRATION.md).

Gateway delivery and signed HTTP interactions are explicit mutually exclusive
modes for each Discord application. Shared packages must not open a second
Gateway connection or hide a second REST client in a consumer.

## Status

`@aphrody/messaging` is the first shared slice. REST rate-limit/error tests,
Gateway lifecycle, signed interactions, command registration and package
publication remain gated work in [PLAN-DISCORD.md](../../plans/discord/PLAN-DISCORD.md).
`aphrody-infra` owns release and deployment evidence.
