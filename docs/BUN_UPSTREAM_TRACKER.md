# Bun Upstream Optimization & Intelligence Tracker

> **Source**: [oven-sh/bun](https://github.com/oven-sh/bun)  
> **Target Fork**: [aphrody-labs/bun](https://github.com/aphrody-labs/bun) (Branch: `main`)  
> **Updated**: 2026-10-03T05:28:10.621Z  
> **Engine**: `scripts/tools/vendor/bun_upstream_tracker.ts`

## 1. Executive Summary & Optimization Strategy

This intelligence dashboard monitors upstream Bun pull requests and performance issues to optimize **Aphrody Bun Fork** for high-throughput AI agent execution, memory efficiency, and native FFI bridging.

- **Critical Stability / Crash Fixes Identified**: 14
- **High-Impact Performance & FFI Optimizations**: 32
- **Total Tracked Items**: 53

## 2. Priority Cherry-Pick & Backport Candidates

| PR / Issue | Title | Category | Impact | State | Actionable Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [#44414](https://github.com/oven-sh/bun/pull/44414) | install: deliver a manifest task's waiters on every pass of run_tasks | Stability & Crash Fix | **CRITICAL** | `MERGED` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44502](https://github.com/oven-sh/bun/pull/44502) | bundler: fix a segfault in `bun build --sourcemap` when the link step fails | Stability & Crash Fix | **CRITICAL** | `MERGED` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#43379](https://github.com/oven-sh/bun/pull/43379) | HTMLRewriter: hold onEndTag callbacks in a visited slot, and stop using the streams of a collected rewrite | Stability & Crash Fix | **CRITICAL** | `MERGED` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44473](https://github.com/oven-sh/bun/pull/44473) | Resolve a module specifier once: fix a segfault in require() of an ES module, and require() with a plugin's namespace | Stability & Crash Fix | **CRITICAL** | `MERGED` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44447](https://github.com/oven-sh/bun/pull/44447) | node:http: a thrown dispatch reads the role of its response from the role bit | Stability & Crash Fix | **CRITICAL** | `MERGED` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44348](https://github.com/oven-sh/bun/pull/44348) | bun test: fix a segfault when an asymmetric matcher meets an array element that is not there | Stability & Crash Fix | **CRITICAL** | `MERGED` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44353](https://github.com/oven-sh/bun/pull/44353) | bun test: fix a silent stack overflow when printing a deeply nested value | Stability & Crash Fix | **CRITICAL** | `MERGED` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44352](https://github.com/oven-sh/bun/pull/44352) | Fix a segfault when Module.runMain is not a function, and report what an override throws | Stability & Crash Fix | **CRITICAL** | `MERGED` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#37966](https://github.com/oven-sh/bun/pull/37966) | structured clone: re-check the transfer list after serializing so a failed transfer detaches nothing | Stability & Crash Fix | **CRITICAL** | `MERGED` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#39711](https://github.com/oven-sh/bun/pull/39711) | Module loader: a failed load of a replaced module must not leave its error on the replacement (tests for oven-sh/WebKit#754) | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44344](https://github.com/oven-sh/bun/pull/44344) | Windows: fix a watcher panic and lost events in a burst of file changes, and a --hot that stops watching a deleted file | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44493](https://github.com/oven-sh/bun/pull/44493) | Real lifetimes for Source, import records and resolver results | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44518](https://github.com/oven-sh/bun/pull/44518) | Bump WebKit to the preview of oven-sh/WebKit#762: a native accessor read by an inlined node:vm function gets the realm that holds it | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#44465](https://github.com/oven-sh/bun/pull/44465) | bun test: report the run and decide the exit code when a test file calls process.exit() | Stability & Crash Fix | **CRITICAL** | `OPEN` | Proactively adopt or cherry-pick to prevent runtime agent thread crash. |
| [#42350](https://github.com/oven-sh/bun/pull/42350) | tls: end the wrapped Duplex on end(), also before the handshake completes | Memory & Garbage Collection | *HIGH* | `MERGED` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44492](https://github.com/oven-sh/bun/pull/44492) | Do not auto-install a bare name that is a runtime plugin's own | Network & Streams | *HIGH* | `MERGED` | Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#44494](https://github.com/oven-sh/bun/pull/44494) | Remove four lifetime erasures that nothing needs | Network & Streams | *HIGH* | `MERGED` | Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#43957](https://github.com/oven-sh/bun/pull/43957) | tls: drop the handshake records that are sealed after our own FIN | Memory & Garbage Collection | *HIGH* | `MERGED` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44285](https://github.com/oven-sh/bun/pull/44285) | timers: store [util.promisify.custom] as a per-function accessor | Memory & Garbage Collection | *HIGH* | `MERGED` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#37664](https://github.com/oven-sh/bun/pull/37664) | node:tls: make client-side new TLSSocket(socket) upgrade the socket it wraps | Network & Streams | *HIGH* | `MERGED` | Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#44290](https://github.com/oven-sh/bun/pull/44290) | node:tls: check the server's name for a handshake that completes after end() | Network & Streams | *HIGH* | `MERGED` | Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#38685](https://github.com/oven-sh/bun/pull/38685) | Blob: return only the slice when consuming a slice's stream after the Blobs were collected | FFI & Native Interop | *HIGH* | `MERGED` | High synergy with Aphrody Rust engine and Obscura headless browser bridges. |
| [#41985](https://github.com/oven-sh/bun/pull/41985) | glob: validate continuation bytes when stepping over directory entry names | Network & Streams | *HIGH* | `MERGED` | Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#43962](https://github.com/oven-sh/bun/pull/43962) | node:tls: send a client's FIN after the first step of its handshake | Network & Streams | *HIGH* | `OPEN` | Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#44515](https://github.com/oven-sh/bun/pull/44515) | build: compile a local WebKit checkout in bun's own build graph instead of a nested cmake build | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44412](https://github.com/oven-sh/bun/pull/44412) | install: do not redirect the root package's own dependency to another manifest's npm: alias | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44516](https://github.com/oven-sh/bun/pull/44516) | tls: report a first handshake that the peer ends with close_notify (Duplex, named pipe, proxy tunnel) | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44501](https://github.com/oven-sh/bun/pull/44501) | install: derive the bun.lockb meta hash in the writer | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#41724](https://github.com/oven-sh/bun/pull/41724) | install: name tarball cache folders and bare git clones by a sha256 prefix of the URL | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44422](https://github.com/oven-sh/bun/pull/44422) | node:tls: a handshake that did not complete is never an established session | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#34901](https://github.com/oven-sh/bun/pull/34901) | shell: require a separator between commands, and keep words after a redirection in the same command | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44498](https://github.com/oven-sh/bun/pull/44498) | sql(postgres): honour PGSSLMODE=verify-ca/verify-full next to a TLS_* connection URL | Memory & Garbage Collection | *HIGH* | `OPEN` | Integrate to optimize long-running 24/7 background agent memory footprint. |
| [#44506](https://github.com/oven-sh/bun/pull/44506) | MessagePort: delete the port checks that the transfer list re-check made unreachable | Network & Streams | *HIGH* | `OPEN` | Optimizes CDP WebSocket streaming and LLM API response throughput. |
| [#44461](https://github.com/oven-sh/bun/pull/44461) | udp: take every queued ICMP report before the first error handler runs | Network & Streams | *HIGH* | `OPEN` | Optimizes CDP WebSocket streaming and LLM API response throughput. |
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
| [#44508](https://github.com/oven-sh/bun/pull/44508) | bundler: print a file where it is imported, not where its bindings are used | Bundler & Transpiler | `MERGED` | Fast cold-start and bundle speedups for dynamically evaluated agent code. |
| [#44469](https://github.com/oven-sh/bun/pull/44469) | bun test: --coverage-reporter implies --coverage | General Enhancement | `MERGED` | Evaluate during standard upstream auto-sync cycles. |
| [#44500](https://github.com/oven-sh/bun/pull/44500) | Bump WebKit to 1600131e46b5 | General Enhancement | `MERGED` | Evaluate during standard upstream auto-sync cycles. |
| [#44474](https://github.com/oven-sh/bun/pull/44474) | Ask a runtime plugin's onResolve once: fix require() of a path a plugin moves into a namespace | Bundler & Transpiler | `MERGED` | Fast cold-start and bundle speedups for dynamically evaluated agent code. |
| [#44305](https://github.com/oven-sh/bun/issues/44305) | Object.freeze on many small arrays is ~10× slower than Node, and reads from frozen number arrays ~9× slower | General Enhancement | `OPEN` | Track upstream regression or bottleneck: Evaluate during standard upstream auto-sync cycles. |
| [#44084](https://github.com/oven-sh/bun/issues/44084) | node:sqlite StatementSync.get() ~1.5x slower than Node when returning table columns | Bundler & Transpiler | `OPEN` | Track upstream regression or bottleneck: Fast cold-start and bundle speedups for dynamically evaluated agent code. |
| [#42857](https://github.com/oven-sh/bun/issues/42857) | url.domainToUnicode takes quadratic time in the number of xn-- labels | General Enhancement | `OPEN` | Track upstream regression or bottleneck: Evaluate during standard upstream auto-sync cycles. |

## 4. How to Cherry-Pick to Aphrody Fork

To cherry-pick a specific upstream optimization commit into the Aphrody fork:

```bash
# 1. Fetch latest upstream
git -C vendor/bun fetch upstream

# 2. Switch to aphrody branch
git -C vendor/bun checkout aphrody

# 3. Cherry pick the commit (example for PR #33711)
git -C vendor/bun cherry-pick <commit-sha>

# 4. Verify test suite and push
bun test vendor/bun/packages/aphrody-bun-runtime/test/runtime.test.ts
git -C vendor/bun push origin aphrody
```
