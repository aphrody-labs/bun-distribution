<!-- SPDX-License-Identifier: Apache-2.0 -->

# backend

Material asset mirroring for the Aphrody CLI. The `aphrody mirror start` command
consumes `Md3Mirror` from this crate. Its standalone binary is an optional
compatibility entry point; `aphrody-kernel` remains the OS control plane.

## What is `backend`?

`backend` implements the low-level OS integration layer for Aphrody. Linux
paths use `/proc/<pid>` and `nix` syscall wrappers; Windows paths use
`OpenProcess` and `NtQuerySystemInformation` via `windows-rs`; WASM targets
expose a limited surface with no process inspection.

Three primary subsystems are exposed:

- **`Md3Mirror`** — async HTTP mirroring of Material Web and Google Fonts assets.
  `APHRODY_MIRROR_DIR` selects the destination; otherwise the legacy VFS maps
  `/var/mirror` under the process working directory. A failed asset returns an error.
- **`dns::DnsRecon`** — OSINT-grade subdomain discovery combining crt.sh
  certificate transparency logs with HackerTarget DNS lookups.
- **`chromium::ChromiumParser`** — Chromium DPAPI master-key extraction and
  AES-GCM cookie decryption. Windows-only (`#[cfg(target_os = "windows")]`).

## Install

```toml
[dependencies]
backend = "1.0.0-canary"
```

`backend` is not yet published to crates.io independently; use a path
dependency from within the Aphrody workspace:

```toml
backend = { path = "crates/aphrody-backend", version = "1.0.0-canary" }
```

## Public API

### `Md3Mirror`

```rust
pub struct Md3Mirror { /* private */ }

impl Md3Mirror {
    pub fn new() -> Result<Self>;
    pub async fn start_mirroring(&self) -> Result<()>;
}
```

`new()` resolves the destination and creates it, then builds a `reqwest::Client`.
`start_mirroring()` fetches the configured assets and fails if any fetch or write fails.

### `dns::DnsRecon`

```rust
pub struct DnsRecon { /* private */ }

impl DnsRecon {
    pub fn new() -> Self;
    pub async fn fetch_crtsh(&self, domain: &str) -> Result<Vec<String>>;
    pub async fn fetch_hackertarget(&self, domain: &str) -> Result<Vec<String>>;
    pub async fn run_osint(&self, domain: &str) -> Result<Vec<String>>;
}
```

`run_osint` fans out to both sources concurrently via `tokio::join!`,
deduplicates, and returns only confirmed subdomains of the queried domain.

### `chromium::ChromiumParser` (Windows only)

```rust
#[cfg(target_os = "windows")]
pub struct ChromiumParser { /* private */ }

impl ChromiumParser {
    pub fn new(user_data_path: PathBuf) -> Self;
    pub fn get_profiles(&self) -> Vec<String>;
    pub fn load_master_key(&mut self) -> Result<()>;
    pub fn get_master_key(&self) -> Option<&Vec<u8>>;
    pub fn get_cookies(&self, profile: &str, host_key: &str) -> Result<Vec<(String, String)>>;
}
```

`load_master_key` reads `Local State`, strips the `DPAPI` prefix, and
decrypts via `base::Crypto::decrypt_dpapi`. `get_cookies` copies the SQLite
cookies database to a temp path (avoiding browser lock conflicts) and decrypts
each value with AES-GCM.

## Cross-platform notes

| Target | `Md3Mirror` |
|---|---|
| Linux (x86_64-unknown-linux-gnu) | Supported |
| Windows (x86_64-pc-windows-msvc) | Supported |
| WASM (wasm32-unknown-unknown) | Not a runtime target |

## Examples

```rust
use aphrody_backend::Md3Mirror;

let mirror = Md3Mirror::new()?;
mirror.start_mirroring().await?;
```

```rust
use backend::Md3Mirror;

let mirror = Md3Mirror::new()?;
mirror.start_mirroring().await?;
```

## Benchmarks

Criterion benchmarks live in `benches/backend_bench.rs`:

```bash
cargo bench -p aphrody-backend
```

Published results will appear here once YOLO #41 lands.

## License

Apache-2.0. See [LICENSE](../../../../LICENSE).

## Related crates

- [`base`](src/base) — no-std primitives, `Vfs`, and `Crypto` used by `backend`.
- `aphrody` — the Aphrody CLI binary in `crates/infra/aphrody`.
