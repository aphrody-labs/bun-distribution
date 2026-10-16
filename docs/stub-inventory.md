# Stub inventory

Scan of crates, packages and apps outside the paths owned by concurrent agents
(RE merge, ruzu/nie, iecode absorption, bun-engine absorption).

| Path | Kind | Donor | Status |
| --- | --- | --- | --- |
| `packages/scaffold` | package without `src` (manifest and README only) | `iecode/design/aphrody-m3/packages/scaffold/src` | Completed: sources ported |
| `crates/grok_consumer_client` (bytes upload, generated image and video media URLs) | `unimplemented!()` | none; implemented from the crate's recorded request flows | Completed |
| `crates/openai_sora_client` `unimplemented_sora_job_status` | `unimplemented!()` | none | Completed: returns the notification JSON |
| `crates/aphrody-infra/src/drive.rs` `GitRepo` blob read | "not yet implemented" error | none; `gix` already a dependency | Completed |
| `packages/m3-next-example`, `packages/m3-next-tauri-example` | README-only members | owners: `packages/m3-next/examples/app`, `apps/m3-example-tauri` | Removed (no consumers) |
| `packages/storyteller-{soundboard,tauri-api,tauri-utils}/src/server.ts` | `export {}` shells | n/a | Removed (unreferenced) |
| `crates/aphrody-dust-*` `unimplemented!()` / `todo!()` | upstream emulator invariants (unpredictable hardware states) | upstream behavior | Kept: not stubs |
| `crates/aphrody-dust-core` `io.rs` (3 copies) `todo!()` on uncommon IO errors | error mapping gap | none | Completed: unmapped kinds propagate as `FileError::Io` (also `aphrody-dust-cli` copy) |
| `crates/aphrody-dust-soft-2d-base` capture display-FIFO source | `todo!()` | none | Remaining: core does not model the main-memory display FIFO (`0x4000068`, DMA timing 4, display mode 3); needs core state plus soft-2d and wgpu renderer plumbing |
| `crates/aphrody-dust-wgpu/2d` `framebuffer()` | `unimplemented!()` (GPU renderer has no CPU framebuffer) | n/a | Kept |
| `crates/aphrody-command` `train promote` | documented unsupported workflow | `aphrody-train` `evaluate_candidate`, `register_promoted_model`, `Registry::record_verdict` | Completed: `--eval` A/B report gates, installs in `ModelStore`, records verdict with `--artifact-id` |
| Thin facades (`aphrody`, `aphrody-ocr`, `aphrody-yolo`, `shell-web`, `aphrody-llama-sys`) | intentional re-export of the canonical owner | n/a | Kept |
