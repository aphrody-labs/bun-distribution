# aphrody-ovh

Native in-process Rust engine for OVHcloud operations in Aphrody Infrastructure.

## Architecture & Invariants

- **Cryptographic Engine**: SHA-1 hex digest computed via `ring::digest::SHA1_FOR_LEGACY_USE_ONLY`. Zero C/OpenSSL bindings, zero external native libraries.
- **Strict Compliance**: 100% compliant with `cargo deny check` (Apache-2.0 / MIT licenses, 0 advisories, 0 bans).
- **Asynchronous Transport**: Built on `reqwest` (with `rustls-tls-manual-roots`) and `tokio`.
- **Clock Drift Sync**: In-process atomic clock synchronization against `/auth/time`.

## Features

- **DNS**: Zones inspection, record CRUD, apex + www batch A records update, BIND format export, and DNSSEC audit.
- **VPS**: Hardware specifications, IP routing, operational status, ping checks, and guarded reboot (`--apply`).
- **Email**: Domains, redirections/aliases, and email deliverability audit (MX, SPF, DMARC, DKIM).
- **Multi-Profile Resolution**: Resolves credentials across `aphrody.com`, `rosegriffon.fr`, and `dragonballfr.com` from `.bash_secrets`, `~/.ovh.conf`, and environment variables.

## CLI Usage

```bash
cargo run -p aphrody-infra -- ovh profiles
cargo run -p aphrody-infra -- ovh status
cargo run -p aphrody-infra -- ovh dns zones
cargo run -p aphrody-infra -- ovh dns records aphrody.com --type A
cargo run -p aphrody-infra -- ovh dns audit aphrody.com
cargo run -p aphrody-infra -- ovh vps list
cargo run -p aphrody-infra -- ovh email audit aphrody.com
```
