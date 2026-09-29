<!-- SPDX-License-Identifier: Apache-2.0 -->
# Koharu agent rules

Follow [workspace rules](../workspace/AGENTS.md) and the user's global policy.
**NHITL:** complete authorized work without approval prompts or interactive questions.

## Ownership and changes

- Own the reusable Rust engine, host-neutral Bun transport and canvas. UI owns the
  extracted editor presentation; desktop adapters consume the library contracts.
- Keep public safe APIs separate from FFI, dynamic loading and build integration.
- When a contract changes, migrate every in-repository consumer and remove the
  replaced form. Do not add compatibility aliases or dead forwarding abstractions.
- Edit authoritative inputs and regenerate derived files. Keep credentials, weights,
  datasets and machine-local outputs out of Git.
- Package every required source, binding, WASM/runtime artifact explicitly; sibling
  imports do not establish an installable library. See [README](../../products/koharu/README.md).
- Run releases through `bun run release`, which delegates versioning, changelog, commit
  and tag creation to `aphrody-ops koharu-release` in `aphrody-infra`.

## ML and performance

- Preserve pinned upstream structure, parameter names/layouts, execution order and
  postprocessing; document divergences. Investigate weight mismatches before changing loaders.
- Separate weight/network ownership from preprocessing and result types. Convert the
  device once at the model boundary, reuse runtimes and disable inference gradients.
- Compare identical representative inputs and structured outputs. Remove redundant
  transfers, synchronization and allocation before adding concurrency or caches.
- Warm models outside timed regions; report device, input, baseline, result and
  correctness differences, accounting for asynchronous accelerator execution.

## Validation and desktop

- Default to one focused debug check. Full suites, release profiles and end-to-end
  runs require explicit task scope; do not repeatedly run unchanged checks.
- Documentation-only changes need links/anchors and `git diff --check`.
- Validate Mint documentation with `bun run docs:check`; it delegates route-aware
  link checks to `aphrody-ops docs-links`.
- For an authorized desktop investigation, prefer CEF remote debugging on the configured
  local endpoint (`http://127.0.0.1:4000`) and semantic targets; use CDP fallback only
  when needed. Observe final native output when devtools cannot see WebGPU pixels.
- The existing canvas uses WASM/WebGPU in the webview. Keep durable scene/export work
  native and transient interactions in the browser; validate the actual desktop window.
