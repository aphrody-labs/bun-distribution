<!-- SPDX-License-Identifier: Apache-2.0 -->

# Frequently Asked Questions

> Path reconciliation (2026-10-07): `plugins/aphrody/skills/yolo` (not in repo) → `plugins/yolo/skills/yolo`. Original dated observations below retain their historical scope.

Pre-answers to the questions most likely to surface in a Show HN thread, an
issue tracker, or a `#general` Slack ping. Cross-links go to authoritative
docs; if an answer here disagrees with the linked source, the linked source
wins.

### Why another CLI? Don't `just` and `taskfile` already do this?

aphrody is not a task runner that wandered into agent territory. It is an
A2A (agent-to-agent) coordination spine that happens to bundle task running
because every dev tool eventually needs one. The defining surface is the
embedded AGNTCY `a2a/v0.4` manifest, the file-based mailbox protocol, and
the parallel YOLO grind loop. See [`COMPARISON.md`](./COMPARISON.md) for a
row-by-row honest take against `just`, `taskfile`, `gh`, `devcontainer`,
and `asdf`.

### What is AGNTCY `a2a/v0.4` and why should I care?

AGNTCY (Agent Network Connectivity) is a consortium spec for agent-to-agent
message exchange and capability discovery. aphrody implements A2A through the
typed **gRPC transport** crates (`a2a-pb` / `a2a` / `a2a-client` /
`a2a-server`), so peer agents can negotiate capabilities and exchange
envelopes over a strongly-typed wire contract. (The earlier file-based
`ai.json` manifest / JSONL-mailbox transport was removed in 2026; only the
winclean compatibility mirror under `C:\winclean\.coord\` remains.)

### How does cross-agent coordination work today?

Over gRPC. Envelopes are encoded by `a2a-pb` (Protocol Buffers, committed
`src/gen/`), surfaced by `a2a`, and exchanged via `a2a-client` /
`a2a-server`. There is no broker to operate; the transport is part of the
binary.

### Does it work on Windows?

Yes. Windows 11 is a first-class build target and runs the
full test suite (`cargo test --workspace` or `just test`). Linux Ubuntu 26.04 is priority #1 and
gates merges; Windows is priority #2; `wasm32-unknown-unknown` is priority
#3. macOS is best-effort and never blocks a merge.

### Why nightly Rust? What about stability?

Edition 2024 plus the `#[cfg(target_os)]` plumbing we use for cross-platform
gating need nightly features that are not slated to stabilise before 2027.
The toolchain is pinned in `rust-toolchain.toml`, so every contributor and
CI run uses the exact same nightly. We re-pin on a known-good cadence
rather than chasing the latest channel build.

### Why is the repo currently private?

Pre-launch hardening. Flipping to public is on the punch list for the Show
HN milestone (D+15). The decision to launch public is gated on supply-chain
green (`cargo deny check`, `cargo vet`) and a clean SECURITY policy review.

### How do I report a security issue?

Do not open a public GitHub issue. Follow the disclosure procedure in
[`SECURITY.md`](../../research/ai/SECURITY.md) — GitHub private advisories preferred,
encrypted email as fallback.

### Can I use aphrody in production?

Not yet. The current line is `v1.0.0-canary` and is explicitly dev-grade:
APIs may shift, error messages may improve, telemetry hooks are off by
design. The `v1.0.0` stable target is Q3 2026. See
[`ROADMAP.md`](../../plans/ai/ROADMAP.md) for the quarterly outlook.

### Does it phone home? Any telemetry?

Zero telemetry by design. aphrody makes no outbound network call unless you
explicitly invoke one (DNS resolution, web scrape, A2A peer dispatch). No
crash uploads, no anonymous usage stats, no opt-out flag because there is
nothing to opt out of.

### How fast is `aphrody doctor`?

No recorded measurement is committed in this repository. The targets
(`aphrody doctor` cold start under 100 ms on a warm filesystem) and the
recipes to measure them are in [`PERFORMANCE.md`](./PERFORMANCE.md) and [`PERFORMANCE-HISTORY.md`](./PERFORMANCE-HISTORY.md).

### What is the parallel YOLO grind loop?

An autonomous agent orchestration mode. Each tick drives
open items toward verified completion. The mode is implemented as the
`yolo` skill under `plugins/yolo/skills/yolo`.

### How do I contribute?

Read [`CONTRIBUTING.md`](../../guides/ai/CONTRIBUTING.md). Short version: open an issue
before a non-trivial PR, run `just ci` (or `cargo test --workspace && cargo deny check`)
before pushing, follow Conventional Commits, and never introduce mock or fake
data. Linux is the gating target — if it does not build on Linux, it does
not merge.
