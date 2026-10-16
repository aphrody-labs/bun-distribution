<!-- SPDX-License-Identifier: Apache-2.0 -->
# PLAN — aphrody-native

## 2026-09-28 — scope decision

This repository now owns only Rust host probes. The former C wrappers and
unlinked Llama/Whisper bridges had no application consumer. Llama inference is
owned by `aphrody-llama-server`; Whisper transcription is owned by
`aphrody-voice`. The platform's full C runtime remains the C library for host
programs; see [C library choice](../../reference/native/libc.md).

`NativeLibc` remains as a compatibility alias for `NativePlatform` until its
remaining consumers migrate. The prior crates.io dry run predates this scope
change and must be repeated before publication.

## 2026-09-26 — crates.io release set (prepared, not published)

`aphrody-native` is prepared for publication at rung 0 of the
[publish ladder](../../reference/ai/cargo/PUBLISH-LADDER.md). The recorded dry run
passed; upload is not established. Scope: Rust facade only, excluding CMake C ABI.

For a publication task, revalidate manifest/lock/packaging and execute the ladder
under [NHITL rules](../../reference/native/AGENTS.md), recording the actual registry result. There is
no additional maintainer-confirmation step. The AI CLI ships via GitHub Releases.
