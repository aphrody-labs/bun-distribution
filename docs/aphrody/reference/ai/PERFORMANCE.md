<!-- SPDX-License-Identifier: Apache-2.0 -->

# Performance

Performance targets for `aphrody` with reproducible recipes. Complements
[`PERFORMANCE-HISTORY.md`](./PERFORMANCE-HISTORY.md) (historical trend log) by
covering the wider workspace: CLI cold start, criterion micro-benchmarks in
`backend`, A2A coordination latency, WASM artifact size, and memory footprint.

Unless a section cites a recorded measurement, the numbers below are targets
and estimates for a 2024-class x86_64 laptop (~4.0 GHz, AES-NI, NVMe SSD),
Windows 11 Insider Canary, Rust nightly 1.97 release profile (`lto = "fat"`,
`codegen-units = 1`). No result file for them is committed in this repository;
run the recipes before quoting any of them as a fact.

## 1. Targets (not measured in this repository)

- `aphrody doctor` cold start: **< 100 ms** on a warm filesystem.
- `aphrody --version`: **< 30 ms** cold, **< 10 ms** warm.
- `mrx scan` (historical monolith audit, ~19,213 files, 482 MB): **~1.4 s** warm cache,
  **~3 s** cold, as recorded by the 2026-05-17 audit (see §4 below).
- AES-256-GCM decrypt of a 1 KiB Chromium-format payload: **< 50 µs**.
- A2A `file_jsonl` inbox poll with 100 envelopes (~50 KB): **< 5 ms**.
- WASM bundle (`aphrody-wasm` release, `wasm-pack --target web`): **~91 KB**
  gzip-compressed _(historical — crate extracted to `aphrody-ts` 2026-05-23, see §6)._

The CI workflow that was meant to check these bounds is not in this repository;
the only recorded criterion results are listed in §3 and in
[`PERFORMANCE-HISTORY.md`](./PERFORMANCE-HISTORY.md).

## 2. How to reproduce

```bash
# Clone siblings next to this checkout (see README.md)
for r in ai os web contracts compat shell ui native infra; do
  git clone https://github.com/aphrody-code/aphrody-$r.git
done
cd aphrody-ai
export RUSTC_WRAPPER=
cargo build --release -p aphrody --locked

# CLI startup (use /usr/bin/time on Linux, Measure-Command on PowerShell)
/usr/bin/time -f '%e s' ./target/release/aphrody --version
/usr/bin/time -f '%e s' ./target/release/aphrody doctor

# Criterion micro-benches (warm-up + sample + plot)
cargo bench -p aphrody-backend

# Quick smoke pass (one sample per bench, no plots)
cargo bench -p aphrody-backend -- --quick
```

Criterion writes HTML reports under `target/criterion/<bench_name>/report/`.
Open `index.html` for distribution, regression vs previous run, violin plots.

## 3. Bench results (criterion runs)

The five micro-benches in
[`crates/os/ostd/backend/benches/backend_bench.rs`](../../../../crates/aphrody-backend/benches/backend_bench.rs)
exercise the algorithmic primitives that dominate hot paths in the backend
crate. Expected ranges on the reference laptop (estimates, not a recorded run;
the only recorded p50 values are in [`CHANGELOG.md`](./CHANGELOG.md) "Performance":
`vfs_resolve_hit_short` 233 ns, `aes_gcm_decrypt_64b` 247 ns,
`aes_gcm_decrypt_64kib` 43.4 µs):

| Bench name               | Expected range | Notes                                                                                                                                                                               |
| ------------------------ | -------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vfs_resolve`            |     ~200 ns/op | HashMap lookup + prefix match + `PathBuf::push` chain. Zero syscalls.                                                                                                               |
| `dns_dedup_sort`         |       ~5 µs/op | 20-entry domain list: lowercase, filter, sort, dedup.                                                                                                                               |
| `aes_gcm_decrypt_1kb`    |   ~10-50 µs/op | RustCrypto `aes-gcm` decryption of a 1 KiB Chromium-format ciphertext (3-byte prefix + 12-byte nonce + payload + tag). Lower bound assumes AES-NI; pure software path lands higher. |
| `sha256_hash_1mb`        |     ~3-5 ms/op | `sha2` crate, ~250 MB/s sustained throughput.                                                                                                                                       |
| `serde_json_parse_crtsh` |      ~10 µs/op | `serde_json::from_slice` on a 20-entry crt.sh-shaped payload.                                                                                                                       |

Hardware without AES-NI (or ARM without crypto extensions) will see
`aes_gcm_decrypt_1kb` drift up. File an issue if your numbers are an order
of magnitude off — that usually points at a build-flag regression.

## 4. Historical monorepo scan performance

> **Note (2026-05-21).** The `mrx` crate and CLI were retired during workspace cleanup
> and repository splitting; the benchmark below is preserved as an archival reference.

Numbers below are reproduced from
the 2026-05-17 aggressive scan audit of the retired `aphrody` monolith (retired; `aphrody-os`
git history):

- Target repo: **19,213 files, 482 MB**, 53 workspaces, 9 submodules.
- Warm cache (median of 3 consecutive runs): **1.4 s** wall clock.
- Cold cache (first run, fs cache empty): **~3 s** wall clock.
- Output artifacts: `path.json` and `monorepo-map.json`, ~50 KB each.
- Throughput: ~14,000 files/s, ~351 MB/s including content classification
  and a blake3 root-config hash.

Methodology:

```bash
cargo build --release -p aphrody-mrx
for i in 1 2 3; do
    /usr/bin/time -f '%e s' ./target/release/mrx --root . scan \
        --out path.json --map monorepo-map.json
done
```

Take the median of the warm runs (#2 and #3) — the first run pays the cold
filesystem cost.

## 5. A2A coordination performance

The A2A protocol is file-based (JSONL mailbox) with an optional HTTP listener
for liveness checks. Expected latency on localhost (estimates, no recorded run):

- Inbox poll (`file_jsonl` backend): **O(file_size)**. A 100-envelope inbox
  (~50 KB JSONL) parses in **< 5 ms**.
- HTTP listener round-trip (port 8788, `/ping`): **2-10 ms** on localhost.
- Heartbeat poll (single `stat()` on `heartbeat-*.txt`): **< 1 ms**.
- 3-deep handshake (round-trip × 3): **~30 ms** localhost, **~100-300 ms**
  across machines depending on network RTT.

The listener is a Bun script and the Rust side reads files directly — no IPC
channel, no broker, no message bus. Cross-host coordination is bounded by
SSH round-trip plus disk fsync.

## 6. WASM bundle

> **Note (2026-06-04).** The `aphrody-wasm` crate was **extracted to the
> `aphrody-ts` repository on 2026-05-23** and no longer lives in this tree, so
> the bundle below is **not reproducible from this repo**. The numbers are
> retained as a historical reference for the extracted crate. For WASM targets
> still in-tree, see the matrix in the README (`base`/`mrx`/`aphrody` stub on
> `wasm32-unknown-unknown` + `wasm32-wasip1`).

Historical: `wasm-pack build --target web --release <aphrody-wasm>` produced:

| Artifact               |                                   Size | Role                         |
| ---------------------- | -------------------------------------: | ---------------------------- |
| `aphrody_wasm_bg.wasm` | **~91 KB gzip** (~250 KB uncompressed) | Rust core compiled to wasm32 |
| `aphrody_wasm.js`      |                                 ~10 KB | wasm-bindgen JS glue         |
| `aphrody_wasm.d.ts`    |                                  ~3 KB | TypeScript types             |

Optimisations were pinned in the crate's `Cargo.toml` under
`[package.metadata.wasm-pack.profile.release]`: `wasm-opt` enabled with SIMD
and bulk-memory flags. A no-opt build of the same crate was ~1.2 MB
uncompressed — roughly 10× worse than the release artifact.

## 7. Memory footprint

Expected resident set size (estimates, no recorded run; measure with
`ps -o rss=` on Linux or `Get-Process | Select-Object WorkingSet` in PowerShell):

- `aphrody --version`: **~5 MB RSS** with the `mimalloc` global allocator.
- `aphrody doctor`: **~12 MB RSS** (the diagnostic path loads `reqwest` +
  `rustls` for the network probe).
- Long-running A2A listener: **~15 MB RSS**.

## 8. Comparison to alternatives (estimates)

Apples-to-oranges — different tools do different things — and none of these
values comes from a recorded run in this repository:

| Tool                | Cold start | Notes                                                        |
| ------------------- | ---------: | ------------------------------------------------------------ |
| `just`              |     ~10 ms | Smaller surface, no diagnostic subcommand.                   |
| `taskfile`          |     ~50 ms | Go runtime overhead.                                         |
| `gh`                | ~80-150 ms | Go + HTTP client init.                                       |
| `aphrody --version` |     ~30 ms | Rust + `mimalloc`.                                           |
| `aphrody doctor`    |   < 100 ms | Wider scope than the others (network probe included).        |

Run the recipes in §2 before drawing a ranking from this table.

## 9. Profiling tips

```bash
# CPU flamegraph (Linux: perf_events; Windows: requires WPR)
cargo install flamegraph
cargo flamegraph -p aphrody-backend --bench backend_bench

# Heap profile (Linux/valgrind)
valgrind --tool=massif ./target/release/aphrody doctor
ms_print massif.out.*

# Async runtime introspection
# Build the cli with `--features tokio-console-instrument`, then
tokio-console http://127.0.0.1:6669
```

For a quick "is this hot?" answer, `cargo bench -p aphrody-backend -- --quick`
finishes in seconds and tells you whether a refactor moved any of the five
benches outside its expected band.

## 10. Performance regressions

Criterion benches run in the extended job of
`.github/workflows/cross-platform.yml` (not in repo).
The job stores the previous baseline under `target/criterion/` (not in repo) and criterion
reports percent change automatically. Open an issue tagged `perf` if you see
a **>20% regression** on any of the five benches versus the baseline — that
threshold catches real algorithmic regressions while tolerating noise from
shared CI runners.

For deeper investigations, cross-reference
the 2026-05-17 mrx aggressive audit (`aphrody-os` git history)
(audit of the aggressive scan mode and its cost model).
