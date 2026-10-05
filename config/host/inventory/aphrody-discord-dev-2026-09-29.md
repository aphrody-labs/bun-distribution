# Aphrody Discord development endpoint — 2026-09-29 08:50 UTC

- Active release: `084964f4a95c1d4231a75d282b61c371b4852120` under `/srv/aphrody-discord/releases/`.
- `SHA256SUMS` verified in the active release; `aphrody-discord-dev.service` active.
- Public `https://bot.aphrody.com/healthz`: HTTP 200, Gateway connected.
- Development guild commands: `ping` registered.
- `/oauth/login`: HTTP 302, `identify` only, state cookie set.
- `/oauth/install`: HTTP 302, `bot applications.commands`, permission bitfield `8`.
- `/oauth/session` without cookie: HTTP 401. Denied callback and replay: HTTP 400, state cookie cleared.
- Same-origin `/oauth/logout`: HTTP 204; foreign-origin request: HTTP 403.
- TLS certificate expiry: 2026-12-27 17:37:33 UTC.
- Still to verify: authorized callback with real consent and rollback drill.

## Update — 2026-09-29 08:56 UTC

- Active release: `4cf6332cdc66b3ec9c0f2b0c288f0a3024acf808`.
- Active checksums verified; service active; public health HTTP 200 with Gateway connected.
- Login and installation redirect HTTP 302 with the expected scopes; unauthenticated session HTTP 401.
- Login rate limit present in this release and tested locally; the live rate limit was not deliberately exhausted.
- Rollback drill: previous release `084964f4a95c1d4231a75d282b61c371b4852120`
  reactivated with public health and Gateway connected, then current release
  `4cf6332cdc66b3ec9c0f2b0c288f0a3024acf808` reactivated with the same
  checks. Service remains active on the current release.
- Authorized callback with fresh user consent remains open.
