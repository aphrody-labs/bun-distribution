# Stream client source provenance

`src/stream` (the `stream` feature, `bun-engine stream`) absorbs code and protocol knowledge from
the projects below. Code was ported into this crate rather than pinned as submodules; every
upstream license text is kept in `licenses/`.

| Upstream | Revision | License | Absorbed into |
| --- | --- | --- | --- |
| [lumina-video/lumina-video](https://github.com/lumina-video/lumina-video), Copyright (c) 2024-2026 alltheseas | `cb0d54356e1c2a4c7e1f72e304879610ad670aa8` | Apache-2.0 OR MIT (`licenses/lumina-video-LICENSE-APACHE`, `licenses/lumina-video-LICENSE-MIT`) | `src/stream/decode.rs`: Media Foundation + D3D11 hardware decode, NT shared-handle import of D3D11 textures into the wgpu D3D12 device (`windows_video.rs`, `zero_copy::windows`). Extended to NV12 plane views, a shared D3D11/D3D12 fence waited on by the GPU queue, and a pinned texture ring. |
| [nchapman/tether](https://github.com/nchapman/tether), Copyright (c) 2026 Nick Chapman | `25415d8cb631ff7a2d19ef0443e6493428f34681` | MIT (`licenses/tether-LICENSE-MIT`) | `src/stream/pacing.rs` (frame-age drop policy, present-mode preference from `tether-render/src/present_policy.rs`); the latest-frame mailbox (`LatestFrame`) in `decode.rs`; relative-mouse capture flow in `session.rs`. |
| [hgaiser/moonshine](https://github.com/hgaiser/moonshine), Copyright (c) 2024, Hans Gaiser | `d67303c407274a1bb005cb1d8b2a83a981596240` | BSD-2-Clause (`licenses/moonshine-LICENSE-BSD-2-Clause`) | `src/stream/video.rs` (video packetizer: RTP/NV headers, FEC blocks, AES-GCM shard encryption), `control.rs` (control message types and encrypted framing), `rtsp.rs` (RTSP/SDP fields), `http.rs` (pairing steps and crypto), `input.rs` (input packet layouts). Moonshine is a server; these modules are its client-side counterparts. |
| [hgaiser/fec-rs](https://github.com/hgaiser/fec-rs), Copyright (c) 2026, Hans Gaiser | `402f41f970bb8c3ef7c88639821032e3b6460f63` | BSD-2-Clause (`licenses/fec-rs-LICENSE-BSD-2-Clause`) | `src/stream/fec/` (Moonlight-compatible GF(2^8) Reed-Solomon with SIMD), used by Moonshine's packetizer. Tables are computed by `const fn` instead of `build.rs`; the rayon path was dropped. |
| [GPUOpen-Effects/FidelityFX-FSR](https://github.com/GPUOpen-Effects/FidelityFX-FSR) `ffx_fsr1.h`, Copyright (c) 2021 Advanced Micro Devices, Inc. | FSR 1.0 | MIT (notice in `src/runtime/fsr1.wgsl`) | `src/runtime/fsr1.wgsl`: EASU and RCAS ported to WGSL, EASU fused with NV12 to RGB conversion (or reading an sRGB RGB texture), shared by the stream client and the `Fsr1Plugin` post-process. |

Protocol behavior (RTSP request order, SDP attribute set, control-channel numbers, input magic
values) was cross-checked against moonlight-common-c without copying its code.

The combined work is distributed under this crate's GPL-3.0-or-later; the permissive notices above
remain with the absorbed files.
