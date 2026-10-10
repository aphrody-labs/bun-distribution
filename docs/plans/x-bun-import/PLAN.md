<!-- SPDX-License-Identifier: Apache-2.0 -->
# `@aphrody/x`: a thin Bun import over `aphrody-x`

> Contexte courant (2026-10-09) : développement et builds selon l'hôte, la cible et les ressources disponibles ; aucun produit n'est réservé à un poste. Voir le [contexte](../../operations/workspace/windows-native.md).


Date: 2026-10-05. Status: in execution, bounded batches (section 8). Inventory and per-export decisions:
[INVENTORY.md](INVENTORY.md). Everything below is a decision (`tranché`) unless it names its evidence.

## 1. Request and target

Owner request (French, verbatim): « x est originellement en Rust ; migre son package x en import Bun pour du scripting
de masse pour usage web ». Rust is the single implementation; `@aphrody/x` becomes a binding built for mass scripting:
thousands of calls, concurrency, rate limits, retries, resumable batches, in process (no subprocess, no HTTP hop).

```
Bun script
  import { XClient, xBatch } from "@aphrody/x"          packages/web/x          binding + orchestration
    -> @aphrody/bun/x (xClientOpen, xSubmit, xBatch*)    packages/interop/native  bun:ffi marshalling
      -> libaphrody_ffi  aphrody_web_x_*                 crates/interop/ffi       JSON job API, handles
        -> aphrody-x: ops, batch, policy, client, parse, store     crates/web/x    the only implementation
          -> reqwest (rustls) -> x.com
```

## 2. Native API (ABI: `aphrody_web_bridge_abi_version` 4 to 5)

Seven exports are added; the five existing `aphrody_web_x_*` reads and their `_submit` variants stay (compatibility).

| Export | Purpose |
| --- | --- |
| `aphrody_web_x_client_open(session_json, options_json) -> char*` | opens a client handle. `session_json` is `{auth_token, ct0, handle?, transaction_id?}`, `{cookie_string}`, or null for discovery exactly as the Rust crate does it (`X_COOKIE_STRING`, `~/.aphrody/x-session.json`, `X_AUTH_TOKEN` plus `X_CT0`). Options: `api_base`, `upload_base`, `timeout_ms`, `persist_session`, `query_ids_path`, `query_ids_ttl_secs`. Returns `{"ok":true,"client":N}` or an error envelope. |
| `aphrody_web_x_client_close(client) -> i32` | releases the handle (1 closed, 0 unknown). |
| `aphrody_web_x_call(client, op, args_json) -> char*` | synchronous call of a **local** operation (parsers, catalog, store, ranking, metadata). Network operations are refused. |
| `aphrody_web_x_submit(client, op, args_json, options_json) -> u64` | any operation as a job on the shared runtime; result through the existing `aphrody_web_job_take`. `options_json`: `{id?, timeout_ms?, retry?}`. |
| `aphrody_web_x_batch_submit(client, ops_json, options_json) -> u64` | many operations, bounded concurrency inside Rust. |
| `aphrody_web_x_batch_poll(batch, max_items) -> char*` | drains finished items and the batch counters. |
| `aphrody_web_x_batch_cancel(batch) -> i32` | stops dispatching, aborts in-flight operations, forgets the batch. |

Every result is an envelope:

```json
{"ok": true,  "op": "search", "id": "q1", "data": {...}, "rate_limit": {"limit":50,"remaining":49,"reset_epoch":1790000000}, "attempts": 1, "elapsed_ms": 412}
{"ok": false, "op": "like",   "id": "t9", "error": {"message": "...", "kind": "terminal", "code": 139, "status": 403}, "attempts": 1, "elapsed_ms": 88}
```

`kind` is `auth`, `terminal`, `rate_limit`, `transient`, `invalid` or `other` (section 4). Operation names are the Rust
method names in snake case (`create_tweet`, `user_tweets`, `get_news`, ...); the list, with arguments, kind and retry
class, is served by the `meta` operation and is the contract.

## 3. Batch semantics

`xBatch(ops, { concurrency, signal, onProgress, retry, pacing, checkpoint, timeoutMs })` returns an async iterator.

* **Ordering**: operations are dispatched in input order, completed out of order; each result carries its `id`
  (caller supplied, else a stable hash of `{op, args}`; duplicates are rejected).
* **Isolation**: one failing operation never stops the others. The exception is an `auth` failure (a dead session):
  dispatch stops, in-flight operations finish, the remaining ones are reported `not_run` and are not checkpointed.
* **Retry**: a per-operation loop in Rust. `transient` (5xx, transport) retries with exponential backoff and jitter,
  idempotent operations only. `rate_limit` (429, code 88, or `x-rate-limit-remaining: 0` for that endpoint) waits for the
  endpoint's reset (bounded by `max_wait_secs`), does not consume a retry, and gives up after `max_rate_limit_waits`.
  `terminal` and `invalid` are final. Defaults: 3 retries, 1 s base, 30 s cap, 20 % jitter, 900 s maximum wait.
* **Pacing**: optional `pacing` (`min_delay_ms`, `max_delay_ms`, `per_window`, `per_day`, `reserve`) for mutating
  operations, a port of the purge governor (rolling windows plus `x-rate-limit-*` folding).
* **Checkpoint**: `checkpoint: "run.jsonl"` makes Rust append one line per completed operation (atomic line write,
  `fsync` on close). On the next run, lines whose result is final (`ok` or `terminal`) are replayed to the iterator
  flagged `resumed: true` and not executed again; `transient`, `rate_limit`, `auth` and `other` failures run again.
  The file holds results, never credentials.
* **Back pressure**: the driver stops dispatching while more than `buffer` (default 10,000) results wait to be drained.
* **Cancellation**: `signal` aborts in-flight operations (the HTTP futures are dropped); the checkpoint keeps every
  completed result, so a rerun resumes.
* **Summary**: the iterator ends with a summary (`total`, `ok`, `failed`, `resumed`, `not_run`, `elapsed_ms`,
  `stopped_by`), also exposed as `batch.summary`.

## 4. Error taxonomy (one owner)

`crates/web/x/src/policy.rs`, shared as data in `crates/web/x/data/x-policy.json` (read by Rust through `include_str!`
and by the TypeScript purge engine through a JSON import, so no table is copied):

* `auth`: codes 32, 89, 99, 215 and HTTP 401, 403 (the session itself is rejected; never retried);
* `terminal`: codes 34, 50, 63, 108, 144, 162, 179, 220, 425 and HTTP 404, plus the idempotent "already applied" codes
  139 (already favorited), 187 (duplicate post) and 327 (already retweeted);
* `rate_limit`: code 88 and HTTP 429;
* `transient`: HTTP 500, 502, 503, 504, timeouts and transport errors;
* `invalid`: malformed arguments, unknown operation or operation name;
* everything else is `other` (retried like `transient` for idempotent operations, then final).

## 5. What changes in Rust

| Area | Change |
| --- | --- |
| `client.rs` | per-request dynamic `Cookie` and `x-csrf-token` (the static default header defeated rotation); `Set-Cookie` rotation of `ct0` and `auth_token`, persisted atomically to the session file when it came from a file; `api_base` and `upload_base` options (loopback tests); per-endpoint rate-limit table; 414 and 404 fallbacks; transport retry owned by `policy`. |
| `api.rs`, `parse.rs` | `user_tweets_and_replies`, `user_media`, public `timeline_tweets`, `timeline_users`, `tweet_detail_raw`; `Tweet.media`; `search` gains `query_source`. |
| `runtime_query_ids.rs` | refresh merges into the cached ids instead of overwriting them; concurrent refreshes coalesce. |
| `algorithm.rs`, `lib.rs` | X timestamps (`Wed May 22 10:00:00 +0000 2026`) and RFC 3339 parse correctly; `has_media` set. |
| new `policy.rs`, `ops.rs`, `batch.rs` | taxonomy, retry and pacing; the operation table; the batch driver with checkpoint. |
| `news.rs`, `archive.rs`, `premium.rs`, `x_pro_deck.rs` | helpers made public for the pure operations. |
| `ops.rs` (maintenance) | `bundles_discover`, `query_ids_live`, `bundle_extract` (live bundle discovery and extraction, so the TypeScript copy of that logic is deleted); `coverage` no longer fails offline (no `query_id_cache` then). |

`crates/interop/ffi`: `src/web/x.rs` owns the handle registries and the seven exports; the five legacy exports delegate
to the same operations; the cdylib defines the glibc 2.43 re-versioned libm functions (`src/glibc_compat.rs`) so a
build on the factory (glibc 2.43) loads on WSL (glibc 2.39).

## 6. What changes in Bun

`@aphrody/bun/x` (`packages/interop/native/src/x.ts`) marshals the exports. `@aphrody/x` re-exports its previous names
(`XClient`, `XSession`, `Store`, parsers, services, tools, constants, types) over it, and adds `xBatch`, `xCall`,
`XBatchResult`. `XClient` opens its native handle lazily, so constructing a client or `XTools` needs no native library.
The duplicated TypeScript implementations are deleted (INVENTORY.md section 2); purge, unfollow, radar, cron, crawler,
function tools and recon stay.

## 7. Gates

* Rust (factory, never WSL): `check`, `test`, strict `clippy -- -D warnings` for `aphrody-x`, `aphrody-ffi` and every
  crate touched; loopback HTTP mock server for the client, batch and FFI tests (no real X host, no cookie).
* Bun: `bun test` for `packages/web/x` and `packages/interop/native` (loopback `Bun.serve` mock through the real
  library), scoped oxlint and oxfmt, TypeScript.
* Artifact: the cdylib is built on the factory, fetched, checked with `scripts/audit/elf-glibc-imports.ts <so> --max 2.39`
  (no import above glibc 2.39), loaded from WSL, and smoke-tested from the consumer package.
  Source, tested behaviour, packaging, installation and activation are reported as separate states.

## 8. Batches

1. glibc shim for the cdylib, artifact built, fetched and loaded; inventory (this directory).
2. Native job API (`policy`, `ops`, `batch`, FFI exports, header, ABI 5) with Rust tests.
3. Bun binding and batch API with tests.
4. Consumers, deletions of the duplicated TypeScript, documentation, regenerated inventory.

## 9. Evidence log

(filled in as batches land: commits, gates, artifact hashes)
