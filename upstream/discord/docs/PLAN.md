# Aphrody Discord plan

The executable blocker and release plan for the next autonomous session is
[`PLAN-DISCORD.md`](../PLAN-DISCORD.md). This page records the architecture
baseline and high-level migration sequence.

## Goal

Make this Bun/TypeScript monorepo the shared Discord framework and transport
source for Aphrody applications. Centralize reusable Discord protocol/runtime
code; keep bot commands, product policy, databases, and domain models in their
own applications.

## Completed baseline — 2026-09-28

- Audited Aphrody AI messaging, Shenron, RG community bot, Achilléa bot, and NIE's
  historical Wonderbot package. Reports and source caveats are in
  [`architecture/upstreams`](architecture/README.md).
- Ported the Aphrody AI common channel contract and Discord REST adapter to
  Bun-first TypeScript as `@aphrody/messaging`. It supports message/file sends,
  DM creation, room enumeration, and cancellable inbox polling. The adapter now
  uses `@discordjs/rest`; its typecheck and nine adapter tests pass.
- Added this repository's shared architecture boundary and migration sequence
  to [`architecture/README.md`](architecture/README.md).
- Configured and deployed `bot.aphrody.com` as the Carbon development example.
  The Gateway is healthy, the HTTP interactions endpoint is set, and `/ping`
  is registered in the test guild. Dedicated TLS renewal and automatic Nginx
  reload are configured and the Certbot dry run succeeded.
- Registered `https://bot.aphrody.com/oauth/callback` in the Discord
  application's redirect allowlist. Discord API readback confirms the URI is
  present, and `/oauth/login` responds with the expected `302` authorization
  redirect.
- Expanded Carbon's authorization-code/advanced-bot request to the documented
  standard scopes requested for the development app. Installation is pinned to
  the configured test guild and asks for permission bitfield `8` (Administrator);
  consent is forced so Discord displays newly requested scopes. Unsupported or
  approval-gated scopes and the distinction between consent and implemented
  capabilities are listed in [`carbon-oauth.md`](carbon-oauth.md).
- Deployed release `30f49b8913c01ef5cbc92e7ff557e757e20b776e`. Live checks
  confirm `/healthz` reports Gateway readiness and `/oauth/login` returns 302
  with the expected scopes, test guild, `permissions=8`, `integration_type=0`,
  consent prompt, state parameter, and state cookie.

The historical development release had OAuth login enabled. Release
`084964f4a95c1d4231a75d282b61c371b4852120` now separates profile login
(`identify`) from bot installation, consumes each OAuth state once, revokes
the profile token and keeps a short local session. Live probes confirm the
new redirects, denial/replay handling, Gateway health and the `ping` command;
an authorized callback with a user and rollback still need proof. Re-register
the callback in Developer Portal → OAuth2 → Redirects when creating or
replacing the Discord application; the bot API cannot change that redirect
allowlist.

Release `4cf6332cdc66b3ec9c0f2b0c288f0a3024acf808` is now active on the
development VPS. Its checksums, health/Gateway, OAuth redirects and
unauthenticated session response passed live probes. The login rate limit is
included and passed its local window/reset test; live exhaustion was avoided.
A controlled rollback to `084964f4a95c1d4231a75d282b61c371b4852120`
and reactivation of `4cf6332cdc66b3ec9c0f2b0c288f0a3024acf808` both
passed public health/Gateway probes. Fresh user consent remains unverified.

## Next work

1. Extend the public contracts in `@aphrody/messaging`; its ESM/types tarball
   and nine mocked transport tests pass. It now uses `@discordjs/rest` for
   rate limits and retries. An external Bun installation, runtime import and
   TypeScript 7 NodeNext declaration check now run in build and publication
   workflows. A manual Build dispatch on `6a5a97a3` ended in GitHub
   `startup_failure` before jobs or logs; CI execution and consumer integration
   remain open.
2. Implement shared lifecycle packages for Discord Gateway
   reconnect/readiness/sharding, signed HTTP interactions, command registration,
   and health contracts. Make Gateway vs HTTP interaction delivery an explicit
   per-application mode.
3. Add thin adapters for selected upstream frameworks. Reuse maintained
   Discord.js/DiscordX capabilities instead of maintaining parallel REST or
   Gateway implementations.
4. Migrate consumers in order: Aphrody AI notifications, Shenron's transport
   boundary, RG and Achilléa, then NIE if a current Discord application is
   restored. Preserve app-owned data,
   permissions, policies, and command/domain logic.
5. Add import-boundary and dependency-duplication checks; migrate old entry
   points through temporary facades, then retire duplicate clients.
6. For each consumer, require Bun typecheck/lint, package export validation,
   focused adapter tests, and a test-guild smoke run before publishing shared
   package versions.
7. Complete the OAuth capability layer for features that actually need user
   grants or incoming webhooks. The current login requests only `identify` and
   revokes its token after reading the profile; optional scopes remain absent
   until their API, storage, permissions and tests are implemented.

## Boundaries

- Never copy secrets, app `.env` files, or production database access into this
  framework repository.
- Do not infer that NIE `main` contains a current Wonderbot implementation; the
  audit found the published package to be historical and not reproducible from
  its manifest alone.
- Keep HTTP interactions signature-verified and mutually exclusive with
  Gateway-delivered interactions for the same Discord application.
- Keep DNS, certificates, Nginx, systemd, releases, and VPS state owned by
  [`aphrody-infra`](https://github.com/aphrody-code/aphrody-infra).
