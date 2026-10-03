<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bun fork aggregate native qualification

Verified on Linux x86_64 on 2026-09-30. This records the tested revision and
artifact; it is not a claim about later releases or other platforms.

The fork change is commit
[`0ba45879b04c123a4dbf8307d65b19fbb440cf4b`](https://github.com/aphrody-labs/bun/commit/0ba45879b04c123a4dbf8307d65b19fbb440cf4b),
on `claude/aphrody-unified-ffi`, based on Aphrody main
`a2671046afbfc818fba21a4925f384b75dc8e109`. The later documentation-only commit
`6f101a3f61af5cd2a25a44a04a83d233c41becfe` updates the canonical remote to
`aphrody-labs/bun`; it does not change the native contract. The review artifact is
[draft PR 1](https://github.com/aphrody-labs/bun/pull/1).

## Runtime contract

`bun:aphrody` loads one `aphrody-ffi` artifact through `APHRODY_FFI_LIB`.
Aphrody ABI 1, N2B ABI 2 and Oxc ABI 1 must all be present and compatible.
Each family keeps its existing string-free owner. The old independent
`N2B_NATIVE_LIB` and `APHRODY_OXC_LIB` selectors do not select separate
libraries in the builtin.

The builtin and [`@aphrody/bun`](../../packages/interop/native/src/library.ts)
share `globalThis[Symbol.for("aphrody.ffi.library.v1")]` with an absolute
`path`, the `bun:ffi` `library` binding and its `owner`. The package expands
builtin-first bindings by opening its full symbol set before closing the
smaller binding. Builtin operations consult the current shared binding,
including after package close/reload. A different configured library path
fails while another path remains loaded. Workers have independent globals;
this is not a worker-lifecycle coordination mechanism.

The companion aggregate source and package bindings are committed at monorepo
revision `9fa127cb`. The native artifact tested at
`target/debug/libaphrody_ffi.so` was built using
`cargo build --offline --locked -p aphrody-ffi`. Its recorded SHA-256 is
`d7ae091c4fef2b54370b56ffa114c093a5fdb45bdbac7df298fe7cdf14c8786f`
and its debug size is 1,915,401,880 bytes. This size is not a release size or
memory-use measurement.

## Verified gates

From `~/src/bun`:

| Gate | Result |
| --- | --- |
| `bun bd test test/js/bun/resolve/aphrody.test.ts` | 14 passed, 0 failed; 18 assertions |
| `bun run lint` | 0 errors, 0 warnings |
| `bun x --no-install tsc -p src/js/tsconfig.json --noEmit` | exit 0 |
| `bun x --no-install tsc -p packages/bun-types/tsconfig.json --noEmit` | exit 0 |
| `git diff --check` | exit 0 |
| `USE_SYSTEM_BUN=1 bun test test/js/bun/resolve/aphrody.test.ts` | expected negative: all 14 fail because system Bun lacks `bun:aphrody` |

The retained hermetic fork fixtures check all native entry points, matching
free owners, ABI rejection without publishing a failed handle, retry,
malformed JSON, null pointers and native error envelopes, handle replacement,
close/reload, and conflicting paths. C fixtures require the host compiler;
none were skipped on this host.

The actual aggregate artifact was also run with the compiled fork in both
load orders. Both subprocesses reported:

```json
{"version":"1.0.0","schema":2,"files":1,"findings":2,"sameLibrary":true,"formatMinifyLintParity":true,"capturedCommand":true,"reload":true}
```

Each run asserted exact N2B report equality with the package scanner, source
immutability in check mode, exact Oxc format/minify/lint equality with the
package calls, successful captured `--version`, the expected shared handle
upgrade/reuse, and close/reload without stale bindings. Native contract tests
are retained at `test-native.test.ts`,
with the actual fork lifecycle fixture at
`bun-fork-native.ts`.
The fixture also rejects conflicting overrides from both consumers. Running
the retained tests with the compiled fork and both original reference libraries
passed all 8 tests with 58 assertions and no skips. The
reproducible host command, after both current artifacts are built, is:

```sh
cd ~/src/bun
APHRODY_FFI_LIB=target/debug/libaphrody_ffi.so \
APHRODY_OXC_REFERENCE_LIB=~/src/oxc/target/debug/libaphrody_oxc_bridge.so \
APHRODY_N2B_REFERENCE_LIB=~/src/aphrody-compat/target/debug/libaphrody_n2b_native.so \
APHRODY_BUN_FORK_BIN=~/src/bun/build/debug/bun-debug \
bun bd test packages/bun/aphrody/test-native.test.ts
```

An additional Linux `/proc/self/maps` check after builtin-first loading and
package expansion found exactly one mapped artifact in the Aphrody/N2B/Oxc
native library families: `target/debug/libaphrody_ffi.so`.
This verifies the mapped artifact count, not duplicated code bytes or RSS.

## Remaining qualification

This integrates the builtin consumer with the aggregate native artifact.
It does not prove static linking into Bun, replacement of Bun's parser or
internal minifier, cross-platform release artifacts, distribution/selection
by all applications, production latency/memory behavior, or full upstream
synchronization. Those requirements remain open. After the organization transfer,
[GitHub Actions run 36767941431](https://github.com/aphrody-labs/bun/actions/runs/36767941431)
passed frozen install, JavaScript lint and all configured build/script/builtin/
source TypeScript checks. This is cloud lint/type evidence, not a cloud native
build or release artifact. The earlier pre-transfer failure before any job
started was a billing lock, not a demonstrated code/test failure.
