# Standalone X (Twitter) Web API Client

A high-performance headless client (one Rust implementation, `aphrody-x`, with a thin Bun import for mass scripting) to interact directly with the private web API of X (Twitter). Bypasses developer portal restrictions using session cookies, dynamic queryIds, and stealth HTTP headers.

## Features

- **GraphQL & REST legacy fallback**: Fully maps X's private web endpoint gateway.
- **Dynamic queryId scraping**: Reads current javascript bundle queryIds from x.com at runtime to remain resilient against client updates.
- **Local-first SQLite storage**: one schema (Rust owns it) storing tweets, users, timeline edges, and follows, with a virtual FTS5 index for instant search.
- **Job API and batches**: `aphrody_x::ops` is one table of named operations with JSON arguments and a result envelope; `aphrody_x::batch` runs many of them with bounded concurrency, retry, rate-limit waiting, pacing and a resumable JSONL checkpoint. Bun reaches both in process through `aphrody-ffi` (`aphrody_web_x_*`, Web ABI 5).
- **Stealth and rate-limit safety**: Captures rate limit headers and queues requests, using user-agent and UUID generation to resemble authentic browser clients.
- **Media uploads & note tweets**: Native chunked uploads for media attachments and long-form tweet posting.

## Directory Structure

- `crates/web/x/src/` — the Rust crate `aphrody-x` (library `aphrody_x` and the `aphrody x` CLI): client, parsers, store, policy, ops, batch.
- `crates/interop/ffi/src/web/x.rs` — the native job API (`aphrody_web_x_client_*`, `_call`, `_submit`, `_batch_*`).
- `packages/interop/native/src/x.ts` — `@aphrody/bun/x`, the bun:ffi marshalling.
- `packages/web/x` — `@aphrody/x`, a thin Bun import (`XClient`, `xBatch`, `Store`, function tools) plus the purge, radar and crawler orchestration.
- `data/` — GraphQL operation catalogs.

## Installation & Build

### Prerequisites
- Rust (Edition 2024)
- Bun (latest)
- Just (Task runner, optional)

### Build the Rust target:
```bash
cargo build --release
```

See sibling crate `../x-algorithm` (and `packages/web/x/src/algo.ts`) for the native port of the X For You recommendation algorithm (candidate pipeline, filters, weighted scorer, diversity) from xai-org/x-algorithm. Exposed as `aphrody_web_x_algorithm_rank` in the cdylib and `rankPosts()` in the TS client. Use to locally re-rank search/timeline results the X way.

### Install TypeScript dependencies:
```bash
bun install
```

### Run tests:
```bash
# Rust
cargo test

# TypeScript/Bun (needs the aphrody-ffi library: APHRODY_FFI_DEV=1 or APHRODY_FFI_LIB=...)
bun test packages/web/x packages/interop/native/test/x.test.ts
```

Using `just` task runner:
```bash
just build
just test
```

## License
Apache-2.0
