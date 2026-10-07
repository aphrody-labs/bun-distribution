# Bun Upstream Optimization & Intelligence Tracker

> **Source**: [oven-sh/bun](https://github.com/oven-sh/bun)  
> **Target Fork**: [aphrody-labs/bun](https://github.com/aphrody-labs/bun) (Branch: `main`)  
> **Updated**: 2026-10-07T16:16:25.772Z
> **Engine**: `scripts/tools/vendor/bun_upstream_tracker.ts`

## 1. Executive Summary & Optimization Strategy

This intelligence dashboard monitors upstream Bun pull requests and performance issues to optimize **Aphrody Bun Fork** for high-throughput AI agent execution, memory efficiency, and native FFI bridging.

- **Critical Stability / Crash Fixes Identified**: 11
- **High-Impact Performance & FFI Optimizations**: 22
- **Total Tracked Items**: 36

## 2. Priority Cherry-Pick & Backport Candidates

| PR / Issue | Title | Category | Impact | State | Actionable Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [#44665](https://github.com/oven-sh/bun/pull/44665) | `bun check`: fix differences from `tsc` | Stability & Crash Fix | **CRITICAL** | `MERGED` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44361](https://github.com/oven-sh/bun/pull/44361) | `bun check` - a TypeScript type checker builtin to Bun | Stability & Crash Fix | **CRITICAL** | `MERGED` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44615](https://github.com/oven-sh/bun/pull/44615) | Upgrade WebKit to dbdca7545d | Stability & Crash Fix | **CRITICAL** | `MERGED` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#38003](https://github.com/oven-sh/bun/pull/38003) | ByteStream: report a stored producer error and keep the taken prefix with the buffer | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#43662](https://github.com/oven-sh/bun/pull/43662) | Write UTF-16 to the Windows console and restore only a codepage bun changed | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#37690](https://github.com/oven-sh/bun/pull/37690) | Report an unresolvable listen hostname as a getaddrinfo error | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44705](https://github.com/oven-sh/bun/pull/44705) | Throw a RangeError when the RegExp engine abandons a search | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44648](https://github.com/oven-sh/bun/pull/44648) | css: parse filter and backdrop-filter, and lower colors inside drop-shadow() | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44703](https://github.com/oven-sh/bun/pull/44703) | dns: read the system resolver config again after a server stops answering | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44426](https://github.com/oven-sh/bun/pull/44426) | build: compile c-ares without CARES_THREADS | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#35053](https://github.com/oven-sh/bun/pull/35053) | bundler: honor onResolve `{ external: true }` with no path, and clear a stale source_index on external answers | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#40260](https://github.com/oven-sh/bun/pull/40260) | napi: take the Node-API lifecycle code to safe Rust | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#41990](https://github.com/oven-sh/bun/pull/41990) | css: keep font/transition sub-properties on the side of the shorthand they were written on | Network & Streams | *HIGH* | `OPEN` | Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#44651](https://github.com/oven-sh/bun/pull/44651) | Return the error of a failed listen from usockets to Bun.serve and Bun.listen | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44535](https://github.com/oven-sh/bun/pull/44535) | ws: take the frame type of send() from options.binary and frame the payload natively | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44699](https://github.com/oven-sh/bun/pull/44699) | Bun.password.verify: compare the named algorithm with the hash, throw on a mismatch | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44702](https://github.com/oven-sh/bun/pull/44702) | bundler: embed files referenced via new URL(..., import.meta.url) in --compile | Network & Streams | *HIGH* | `OPEN` | Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#44406](https://github.com/oven-sh/bun/pull/44406) | install: remove nested copies bun.lock no longer places, with the hoisted linker | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44484](https://github.com/oven-sh/bun/pull/44484) | install: stop `bun prune` and `bun update` removing packages behind a symlinked workspace node_modules | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44694](https://github.com/oven-sh/bun/pull/44694) | shell mv: refuse to copy a directory into itself on the cross-device fallback | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44647](https://github.com/oven-sh/bun/pull/44647) | css: keep searching for the most saturated chroma under the JND in gamut mapping | Network & Streams | *HIGH* | `OPEN` | Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#44208](https://github.com/oven-sh/bun/issues/44208) | node:http: every request copies the bytes behind its head into a head Buffer that only 'connect' and 'upgrade' read | Memory & Garbage Collection | *HIGH* | `OPEN` | Track upstream regression or bottleneck: Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44187](https://github.com/oven-sh/bun/issues/44187) | node:sqlite / bun:sqlite: built without SQLITE_DEFAULT_MEMSTATUS=0, so reads from several workers contend on a global mutex | Memory & Garbage Collection | *HIGH* | `OPEN` | Track upstream regression or bottleneck: Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44186](https://github.com/oven-sh/bun/issues/44186) | worker_threads: allocating workers block on each other's GC marking; BUN_JSC_numberOfGCMarkers=1 halves 8-worker wall time | Memory & Garbage Collection | *HIGH* | `OPEN` | Track upstream regression or bottleneck: Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44177](https://github.com/oven-sh/bun/issues/44177) | Bun.serve routes: building the table is quadratic and lookup is linear in the number of sibling routes | Network & Streams | *HIGH* | `OPEN` | Track upstream regression or bottleneck: Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#43279](https://github.com/oven-sh/bun/issues/43279) | Cached CommonJS `require()` accumulates duplicate native child references, causing unbounded GC cost | FFI & Native Interop | *HIGH* | `OPEN` | Track upstream regression or bottleneck: High synergy with Aphrody Rust engine and Obscura headless browser bridges. |
| [#43260](https://github.com/oven-sh/bun/issues/43260) | react-compiler: codegen uses memory quadratic in the number of blocks of a component | Network & Streams | *HIGH* | `OPEN` | Track upstream regression or bottleneck: Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#42603](https://github.com/oven-sh/bun/issues/42603) | URLPattern: pattern shapes that take super-linear time to match | FFI & Native Interop | *HIGH* | `OPEN` | Track upstream regression or bottleneck: High synergy with Aphrody Rust engine and Obscura headless browser bridges. |
| [#42284](https://github.com/oven-sh/bun/issues/42284) | Performance difference for character-concatenated strings in irregular arrays | Network & Streams | *HIGH* | `OPEN` | Track upstream regression or bottleneck: Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#42200](https://github.com/oven-sh/bun/issues/42200) | `v8.getHeapStatistics()` is O(heap) on Bun and costs ~2x a full GC | Memory & Garbage Collection | *HIGH* | `OPEN` | Track upstream regression or bottleneck: Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#41740](https://github.com/oven-sh/bun/issues/41740) | Bun.sql: checkUnsafeTransaction uppercases the whole query to test a 17-char prefix (O(query length) per query) | Memory & Garbage Collection | *HIGH* | `OPEN` | Track upstream regression or bottleneck: Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#41399](https://github.com/oven-sh/bun/issues/41399) | [performance] WinZip-style aes-js AES is 22% slower under amd64 emulation but 24% faster on native arm64 | Memory & Garbage Collection | *HIGH* | `OPEN` | Track upstream regression or bottleneck: Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#41211](https://github.com/oven-sh/bun/issues/41211) | bunx --bun shadcn@latest add with multiple components is very slow on Windows but fast on macOS | Network & Streams | *HIGH* | `OPEN` | Track upstream regression or bottleneck: Optimizes CDP WebSocket streaming and LLM API response throughput. |

## 3. General Optimizations & Transpiler Improvements

| PR / Issue | Title | Category | State | Actionable Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| [#44305](https://github.com/oven-sh/bun/issues/44305) | Object.freeze on many small arrays is ~10× slower than Node, and reads from frozen number arrays ~9× slower | General Enhancement | `OPEN` | Track upstream regression or bottleneck: Evaluate during standard upstream auto-sync cycles. |
| [#44084](https://github.com/oven-sh/bun/issues/44084) | node:sqlite StatementSync.get() ~1.5x slower than Node when returning table columns | Bundler & Transpiler | `OPEN` | Track upstream regression or bottleneck: Fast cold-start and bundle speedups for dynamically evaluated agent code. |
| [#42857](https://github.com/oven-sh/bun/issues/42857) | url.domainToUnicode takes quadratic time in the number of xn-- labels | General Enhancement | `OPEN` | Track upstream regression or bottleneck: Evaluate during standard upstream auto-sync cycles. |

## 4. How to Cherry-Pick to Aphrody Fork

To cherry-pick a specific upstream optimization commit into the Aphrody fork:

```bash
# 1. Fetch latest upstream
git -C vendor/bun fetch upstream

# 2. Switch to the fork main branch
git -C vendor/bun checkout main

# 3. Cherry pick the commit (example for PR #33711)
git -C vendor/bun cherry-pick <commit-sha>

# 4. Verify test suite and push
bun x tsc --noEmit -p vendor/bun/packages/bun-types
git -C vendor/bun push origin main
```
