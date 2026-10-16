<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native Python runtime handoff — 2026-10-04

Owned files: `packages/aphrody/src/aphrody/yolo_runtime.py`,
`packages/aphrody/tests/test_yolo_runtime.py`, this documentation directory.
No producer, Rust, UI, manifests, locks or other sessions' changes were edited.
No Cargo, deployment, model, credentials or protected data operation occurred.

Evidence: 22 tests pass against installed Linux x64 ABI 1.4 plus synthetic
pre-load rejection fixtures. Installed producer full revision is
`0ade1c71ccb52bcc9d255188a252c28c5b789b48`; loaded embedded revision is
`0ade1c71ccb5`; shared library SHA-256 is
`ae14394bcfb291b9da4a4aa79acdcac2193f30966ae5672f02adf9f6b3ec695e`.
Payload/header hashes and clean provenance are checked before every load.
Ruff check/format and scoped Mypy pass.

Tests cover actual stats/bench capabilities, local HTTP 204, UTF-8 env/cwd,
complete binary stdout/stderr, peek/drain, persistent output overflow,
TIMEOUT->cancel and slot BUSY/recovery, async stop, owned-child teardown,
threaded stats, idempotent release/close and refusal after close; manifest
bad hash/size/target/ABI/minor/dirty/revision/panic/path/symlink and embedded
provenance mismatch are rejected. No fixture calls live external services.

Parent integration completed: 695 workspace tests pass, 22 skip; full Ruff,
formatting, Mypy (147 sources) and offline lock checks pass. Direct/sdist wheels
are byte-identical with two isolated native/import smokes; the installed direct
wheel passes these same 22 ABI tests outside the checkout under Python -I in
0.62 s. See [wheel receipt](wheel-qualification.json); input mode is explicitly
worktree-snapshot with all input hashes, not the earlier HEAD alone.
Do not assert all Yolo capabilities or all OSes are proven: current ABI
advertises only four families, producer later milestones remain open. Native
future additive ABI minors are negotiated; unsupported capabilities are explicit.
The new module is directly importable as `aphrody.yolo_runtime`; no facade or
root manifest change is required. User-facing stability statements must retain
the producer revision and execution target limits above.
