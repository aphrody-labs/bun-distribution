# Discord development stack

## Recommended workspace stack

- Bun `1.4.2` for installs and scripts; `bun.lock` is the only workspace lock.
- TypeScript `7.0.2`, Oxlint `1.86.0`, and Oxfmt `0.71.0`, shared through the
  Bun workspace catalog.
- `@discordjs/docgen` uses the TypeScript 6.0.2 package alias at runtime because
  its TypeDoc 0.28 peer range excludes TypeScript 7; the other workspace
  typecheck tasks use the TypeScript 7 catalog.
- Turbo for dependency-aware builds and docs tasks.
- Discord.js as the general-purpose Gateway, REST, voice and API foundation;
  DiscordX remains available for its decorator-driven framework and utilities.
- The published `@discordjs/ws@1.2.3` dependency used by DiscordX resolves
  published `@discordjs/util@1.2.0` through a scoped Bun override. Its
  `polyfillDispose` export is absent from the vendored 1.1.1 package.
- Carbon `@buape/carbon@0.16.0` as an optional Bun-first HTTP interaction
  framework, demonstrated by the small `apps/carbon-example` workspace. It is
  an npm dependency and its source is not copied into this monorepo.

The Discord.js upstream declares Node.js `>=24.17.0` in its root manifest.
Its source can be evaluated under Bun in this development workspace, but the
upstream Node engine declaration means Bun compatibility is a local validation
target, not an upstream support guarantee. See the upstream [runtime
requirements](https://github.com/discordjs/discord.js/blob/main/package.json).

## Alternatives

| Stack                                                                                                       | Best fit                                                                        | Tradeoff                                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Discord.js](https://github.com/discordjs/discord.js) + [DiscordX](https://github.com/discordx-ts/discordx) | Broad Gateway/API support, voice, mature ecosystem, and decorators              | Discord.js currently declares Node as its supported runtime; validate Bun-specific paths locally          |
| [Carbon](https://github.com/buape/carbon)                                                                   | Bun and Fetch runtimes, HTTP interactions first, with optional Gateway features | Different serverless-oriented model; not a drop-in replacement for a stateful Gateway bot                 |
| [Discordeno](https://github.com/discordeno/discordeno)                                                      | Modular REST/Gateway TypeScript library with Bun support                        | Keep as a comparison spike; its API and package ecosystem would duplicate the vendored Discord.js surface |
| [Serenity](https://github.com/serenity-rs/serenity) + [Poise](https://github.com/serenity-rs/poise)         | Full Discord bot stack in Rust with Gateway, REST, cache, and command framework | Requires a Rust workspace and a separate operational/runtime stack                                        |
| [Sapphire](https://github.com/sapphiredev/framework)                                                        | Modular command framework atop Discord.js                                       | Adds framework conventions while reusing the same Discord.js transport layer                              |

Carbon's upstream README advertises Bun runtime support and optional Gateway
support; its package metadata is tracked in the example workspace. Discordeno
documents Bun install and runtime support. Serenity describes REST, Gateway,
cache and voice features, while Poise supplies its command framework. See each
upstream project for current feature and support details.

## Bun runtime APIs

Use Bun's native APIs at Aphrody-owned runtime boundaries: `Bun.env` for
configuration and `Bun.serve` for Fetch-style HTTP handlers. The Carbon example
uses Carbon's Bun adapter, which owns the interaction server lifecycle. Prefer
standard `Request` and `Response` handlers for new HTTP code so they remain easy
to move between Bun and other Fetch runtimes.

The imported Discord.js proxy currently exposes a Node
`IncomingMessage`/`ServerResponse` handler, so its container uses
`node:http.createServer`; Bun runs that compatibility API. Move it to
`Bun.serve` only with a deliberate adapter for the handler contract. For
repo-owned scripts, prefer built-in `Bun.file`, `Bun.Glob`, and `$` over adding
small file, glob, or shell dependencies. Keep upstream package internals intact
unless a focused Bun-portability change is validated.

See the official [Bun APIs reference](https://bun.com/docs/runtime/bun-apis)
for the current runtime surface.
