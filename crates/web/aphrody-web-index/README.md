<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-web-index

The BXC HNSW vector index is imported as a Rust library from clean Aphrody Web
commit `bbeb5ef4c497f7d27f546ad2cc15a250dcc93c83`. The source crate name,
version, API, FFI handle layer, mmap persistence format, benchmarks and tests
are preserved. Source hashes and target adaptations are recorded in
`docs/migration/aphrody-web-index-import.json`.

The target Cargo manifest enables `serde` and `serde_json` standard-library
features required by the source derives because the unified root disables
those defaults. The index passed its API, persistence, corruption, concurrency
and recall tests offline. The source BXC FFI still needs to consume this local
crate before the source checkout can be retired.

`aphrody-memory::HnswBackend` currently stores records as JSONL and performs
exact cosine ranking. Adopting this ANN index there requires a format migration
and a ranking contract decision; the two backends are not interchangeable by
name alone.
