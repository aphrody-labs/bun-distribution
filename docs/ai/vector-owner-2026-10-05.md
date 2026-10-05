<!-- SPDX-License-Identifier: Apache-2.0 -->
# Pure vector owner — 2026-10-05

The [vector module](../../packages/core/src/math/vectors.ts) owns Bun normalization,
cosine similarity and Euclidean distance. Redis imports it directly;
[Gemma](../../packages/core/src/gemma4/engine.ts) retains compatible reexports and
its profile-dependent synthetic projection and KV estimates. No arithmetic,
precision, validation, mutation or error contract changed.

The bundle test inspects source maps from a real Bun build of the Redis vector
entrypoint: it includes the pure vector owner and no Gemma source. This qualifies
removal of that dependency edge, not a measured runtime performance improvement.

Validation: 38 tests pass, 452 assertions across vector-owner, gemma4,
gemma4-inference, redis_vector and redis_native; core TypeScript, scoped strict
oxlint and oxfmt pass. The Redis tests include an isolated real Redis server.
Native `yolo verify --only docs,whitespace --json` passes (mdBook and whitespace);
three document links pass the Workspace link checker.

Python shares its native buffer adapter and routes unified inference through its
existing HTTP client; [cross-repository ownership and limits](../../../aphrody-py/docs/architecture/ai/OWNERS.md).
The Bun arithmetic is not replaced by Rust: their error and floating-point
contracts differ and no equivalent interlanguage binding was qualified here.
No Rust, native artefact, model execution or installed runtime is qualified by
this source-only extraction. Concurrent desktop/runtime edits are preserved.
