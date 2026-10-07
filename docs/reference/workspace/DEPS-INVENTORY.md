<!-- SPDX-License-Identifier: Apache-2.0 -->
# Dependency inventory

Generated 2026-10-04T03:38:40.421Z by `aphrody-update deps inventory` (crates.io sparse index, npm, PyPI, git ls-remote, OSV). Full data: `target/deps-inventory/inventory.json` (not in repo) (generated or machine-local artifact; presence depends on the build host) (not committed).

## Rust (Cargo.lock)

- resolved: 2351, behind latest: 715 (direct: 104), with advisories: 16, yanked/deprecated: 0

Held advisories (reason in `tools/config/deps/advisory-holds.json`):
- atomic-polyfill 1.0.3: RUSTSEC-2023-0089 (latest 1.0.3) - unmaintained notice, transitive; no newer release.
- bincode 1.3.3: RUSTSEC-2025-0141 (latest 3.0.0) - RUSTSEC-2025-0141 is an unmaintained notice; 3.0.0 is not a drop-in replacement. Transitive (heed-types and others).
- bincode 2.0.1: RUSTSEC-2025-0141 (latest 3.0.0) - RUSTSEC-2025-0141 is an unmaintained notice; 3.0.0 is not a drop-in replacement. Transitive (heed-types and others).
- encoding 0.2.33: RUSTSEC-2021-0153 (latest 0.2.33) - unmaintained notice, transitive; no newer release.
- fxhash 0.2.1: RUSTSEC-2025-0057 (latest 0.2.1) - unmaintained notice, transitive (selectors 0.24).
- glib 0.18.5: GHSA-wrw7-89jp-8q8g, RUSTSEC-2024-0429 (latest 0.22.10) - gtk3-rs 0.18 stack required by tauri/wry on Linux (atk, cairo-rs, gdk); moves with the Tauri toolchain.
- number_prefix 0.4.0: RUSTSEC-2025-0119 (latest 0.4.0) - unmaintained notice, transitive; no newer release.
- paste 1.0.15: RUSTSEC-2024-0436 (latest 1.0.15) - unmaintained notice, transitive (rav1e, specta, safer-bytes); no replacement release.
- proc-macro-error 1.0.4: RUSTSEC-2024-0370 (latest 1.0.4) - unmaintained notice; used by glib-macros and gtk3-macros.
- rand 0.7.3: GHSA-cq8v-f236-94qc, RUSTSEC-2026-0097 (latest 0.10.3) - rand 0.7.3 comes from phf_generator 0.8; moves with its parent.
- rsa 0.9.10: RUSTSEC-2023-0071 (latest 0.9.10) - RUSTSEC-2023-0071 has no patched release; transitive of jsonwebtoken 10.
- rustybuzz 0.20.1: RUSTSEC-2026-0206 (latest 0.20.1) - usvg and athena-text text stack; no newer release.
- serial 0.4.0: RUSTSEC-2017-0008 (latest 0.4.0) - unmaintained notice; portable-pty 0.8 (pinned, 0.9 breaks headless Windows clients).
- ttf-parser 0.20.0: RUSTSEC-2026-0192 (latest 0.25.1) - fontdb 0.16 and the usvg/rustybuzz text stack; no patched release exists for 0.25.1 either.
- ttf-parser 0.25.1: RUSTSEC-2026-0192 (latest 0.25.1) - fontdb 0.16 and the usvg/rustybuzz text stack; no patched release exists for 0.25.1 either.
- yara-x 1.7.0: GHSA-2jx3-ff3v-j7jj (latest 1.21.0) - optional `yara` feature of aphrody-re. The fix for GHSA-2jx3-ff3v-j7jj lands in 1.19.0, but 1.19 to 1.21 need wasmtime ^43 to ^45, which carry RUSTSEC-2026-0222/0269/0316 (fixed only from 46.0.3). 1.7.0 keeps wasmtime 36.0.16 (patched). Rules are not deserialised from untrusted input.

Direct dependencies behind latest:
- aes 0.8.4 -> 0.9.3
- aes-gcm 0.10.3 -> 0.11.1
- arrow-array 58.4.0 -> 60.0.0
- arrow-schema 58.4.0 -> 60.0.0
- auto_impl 1.3.0 -> 1.4.0
- base64 0.13.1 -> 0.23.1
- base64 0.21.7 -> 0.23.1
- base64 0.22.1 -> 0.23.1
- bindgen 0.69.5 -> 0.73.2
- bindgen 0.70.1 -> 0.73.2
- bindgen 0.72.1 -> 0.73.2
- console 0.15.11 -> 0.16.6
- dirs 4.0.0 -> 7.0.0
- dirs 5.0.1 -> 7.0.0
- dirs 6.0.0 -> 7.0.0
- fastembed 5.17.3 -> 7.1.0
- getrandom 0.1.16 -> 0.4.3
- getrandom 0.2.17 -> 0.4.3
- getrandom 0.3.4 -> 0.4.3
- glam 0.30.10 -> 0.33.12
- glam 0.31.1 -> 0.33.12
- glam 0.32.1 -> 0.33.12
- harfrust 0.12.0 -> 0.14.0
- harfrust 0.13.3 -> 0.14.0
- hashbrown 0.12.3 -> 0.17.1
- hashbrown 0.14.5 -> 0.17.1
- hashbrown 0.15.5 -> 0.17.1
- hashbrown 0.16.1 -> 0.17.1
- hf-hub 0.4.3 -> 1.0.0
- hf-hub 0.5.0 -> 1.0.0
- html5ever 0.29.1 -> 0.40.1
- html5ever 0.36.1 -> 0.40.1
- html5ever 0.38.0 -> 0.40.1
- html5ever 0.39.0 -> 0.40.1
- http 0.2.12 -> 1.5.0
- indicatif 0.17.11 -> 0.18.6
- jieba-rs 0.9.0 -> 0.11.0
- jsonschema 0.58.4 -> 0.58.5
- lancedb 0.29.0 -> 0.39.0
- libc 0.2.189 -> 0.2.190
- libloading 0.8.9 -> 0.9.0
- md-5 0.10.6 -> 0.11.0
- miette 5.10.0 -> 7.6.0
- ndarray 0.16.1 -> 0.17.2
- png 0.17.16 -> 0.18.1
- pollster 0.4.0 -> 1.0.1
- portable-pty 0.8.1 -> 0.9.0
- prettyplease 0.2.37 -> 0.3.0
- rand 0.7.3 -> 0.10.3
- rand 0.8.8 -> 0.10.3
- rand 0.9.5 -> 0.10.3
- rars 0.9.4 -> 0.10.0
- read-fonts 0.39.2 -> 0.45.0
- read-fonts 0.41.0 -> 0.45.0
- read-fonts 0.43.3 -> 0.45.0
- read-fonts 0.44.0 -> 0.45.0
- reqwest 0.12.28 -> 0.13.5
- rfd 0.16.0 -> 0.17.2
- roxmltree 0.20.0 -> 0.21.1
- rustc-hash 1.1.0 -> 2.1.3

## Bun (bun.lock)

- resolved: 2229, behind latest: 798 (direct: 60), with advisories: 8, yanked/deprecated: 37

Open advisories with a newer release (bump or replace the consumer):
- http-cache-semantics 4.2.0: GHSA-ch52-4w7c-c8xp (latest 4.3.0)
- react-router 6.30.6: GHSA-337j-9hxr-rhxg, GHSA-wrjc-x8rr-h8h6 (latest 8.4.0)

Open advisories with no newer release:
- braces 3.0.3: GHSA-vfj7-8cjw-p6xm (latest 3.0.3)

Held advisories (reason in `tools/config/deps/advisory-holds.json`):
- adm-zip 0.6.0: GHSA-7q85-xj36-vmfc, GHSA-8238-w5pm-2374, GHSA-c6fg-446q-cg94 (latest 0.6.1) - 0.6.0 is pinned exactly by @mintlify/cli and @mintlify/previewing (dev docs tool `mint`, @aphrody/koharu-docs only); 0.6.1 is already used by onnxruntime-node. Moves with the next mint release.
- esbuild 0.27.7: GHSA-g7r4-m6w7-qqqr (latest 0.28.2) - 0.27/0.21/0.18 are pinned by vite and tool ranges that exclude 0.28; the advisories concern the esbuild dev server only.
- js-yaml 4.3.1: GHSA-2883-xcg3-v3hh (latest 5.4.2) - 4.3.1 is pinned exactly by @mintlify/* (dev docs tool `mint`); every other consumer already resolves 4.3.2, 3.15.2 or 5.x. Moves with the next mint release.
- esbuild 0.18.20: GHSA-67mh-4wv8-2f99 (latest 0.28.2) - 0.27/0.21/0.18 are pinned by vite and tool ranges that exclude 0.28; the advisories concern the esbuild dev server only.
- sharp 0.33.5: GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c (latest 0.35.5) - 0.33.5 is pinned by @mintlify/prebuild (dev docs tool `mint`); the catalog, next, miniflare and favicons resolve 0.35.x. Moves with the next mint release; the 0.35.5 copy is not affected.

Yanked or deprecated:
- @esbuild-kit/core-utils 3.3.2: Merged into tsx: https://tsx.hirok.io
- @esbuild-kit/esm-loader 2.6.5: Merged into tsx: https://tsx.hirok.io
- @yuku-codegen/binding-android-arm64 0.10.2: yuku-codegen is pure JavaScript since 0.14
- @yuku-codegen/binding-darwin-arm64 0.10.2: yuku-codegen is pure JavaScript since 0.14
- @yuku-codegen/binding-darwin-x64 0.10.2: yuku-codegen is pure JavaScript since 0.14
- @yuku-codegen/binding-freebsd-x64 0.10.2: yuku-codegen is pure JavaScript since 0.14
- @yuku-codegen/binding-linux-arm-gnu 0.10.2: yuku-codegen is pure JavaScript since 0.14
- @yuku-codegen/binding-linux-arm-musl 0.10.2: yuku-codegen is pure JavaScript since 0.14
- @yuku-codegen/binding-linux-arm64-gnu 0.10.2: yuku-codegen is pure JavaScript since 0.14
- @yuku-codegen/binding-linux-arm64-musl 0.10.2: yuku-codegen is pure JavaScript since 0.14
- @yuku-codegen/binding-linux-x64-gnu 0.10.2: yuku-codegen is pure JavaScript since 0.14
- @yuku-codegen/binding-linux-x64-musl 0.10.2: yuku-codegen is pure JavaScript since 0.14
- @yuku-codegen/binding-win32-arm64 0.10.2: yuku-codegen is pure JavaScript since 0.14
- @yuku-codegen/binding-win32-x64 0.10.2: yuku-codegen is pure JavaScript since 0.14
- @yuku-parser/binding-android-arm64 0.10.2: yuku-parser runs on yuku-core since 0.14
- @yuku-parser/binding-darwin-arm64 0.10.2: yuku-parser runs on yuku-core since 0.14
- @yuku-parser/binding-darwin-x64 0.10.2: yuku-parser runs on yuku-core since 0.14
- @yuku-parser/binding-freebsd-x64 0.10.2: yuku-parser runs on yuku-core since 0.14
- @yuku-parser/binding-linux-arm-gnu 0.10.2: yuku-parser runs on yuku-core since 0.14
- @yuku-parser/binding-linux-arm-musl 0.10.2: yuku-parser runs on yuku-core since 0.14
- @yuku-parser/binding-linux-arm64-gnu 0.10.2: yuku-parser runs on yuku-core since 0.14
- @yuku-parser/binding-linux-arm64-musl 0.10.2: yuku-parser runs on yuku-core since 0.14
- @yuku-parser/binding-linux-x64-gnu 0.10.2: yuku-parser runs on yuku-core since 0.14
- @yuku-parser/binding-linux-x64-musl 0.10.2: yuku-parser runs on yuku-core since 0.14
- @yuku-parser/binding-win32-arm64 0.10.2: yuku-parser runs on yuku-core since 0.14

Direct dependencies behind latest:
- @ai-sdk/provider 4.0.19 -> 4.0.21
- @napi-rs/canvas 1.0.9 -> 1.0.10
- @napi-rs/canvas-android-arm64 1.0.9 -> 1.0.10
- @napi-rs/canvas-darwin-arm64 1.0.9 -> 1.0.10
- @napi-rs/canvas-darwin-x64 1.0.9 -> 1.0.10
- @napi-rs/canvas-linux-arm-gnueabihf 1.0.9 -> 1.0.10
- @napi-rs/canvas-linux-arm64-gnu 1.0.9 -> 1.0.10
- @napi-rs/canvas-linux-arm64-musl 1.0.9 -> 1.0.10
- @napi-rs/canvas-linux-riscv64-gnu 1.0.9 -> 1.0.10
- @napi-rs/canvas-linux-x64-gnu 1.0.9 -> 1.0.10
- @napi-rs/canvas-linux-x64-musl 1.0.9 -> 1.0.10
- @napi-rs/canvas-win32-arm64-msvc 1.0.9 -> 1.0.10
- @napi-rs/canvas-win32-x64-msvc 1.0.9 -> 1.0.10
- @neon/env 1.4.8 -> 1.5.0
- @react-three/drei 9.122.0 -> 10.7.9
- @tanstack/react-query 5.104.0 -> 5.104.1
- @types/node 26.6.3 -> 26.6.4
- typescript 6.0.3 -> 7.0.2
- ai 7.0.126 -> 7.0.127
- better-auth 1.7.6 -> 1.7.7
- dotenv 17.4.2 -> 18.0.5
- fuse.js 7.1.0 -> 7.5.0
- googleapis 182.0.0 -> 183.0.0
- graphql 16.14.2 -> 17.0.2
- graphql-scalars 1.26.0 -> 2.0.0
- lucide-react 1.48.0 -> 1.51.0
- maplibre-gl 6.11.2 -> 6.12.0
- mint 4.2.948 -> 4.2.984
- motion 13.4.4 -> 14.0.0
- next-intl 4.14.7 -> 4.14.9
- pino 10.3.1 -> 10.4.0
- pixi.js 8.21.0 -> 8.22.0
- react-resizable-panels 4.14.1 -> 4.14.2
- react-router-dom 6.30.6 -> 7.18.4
- schema-dts 2.0.0 -> 2.1.0
- shadcn 4.21.0 -> 4.21.1
- tailwindcss 3.4.17 -> 4.3.3
- turbo 2.11.5 -> 2.11.7
- type-fest 4.41.0 -> 5.10.0
- undici-types 8.9.0 -> 8.11.2
- uuid 11.1.1 -> 14.0.2
- zod 3.25.76 -> 4.6.5
- google-auth-library 10.9.1 -> 11.1.0
- node-fetch 2.6.7 -> 3.3.2
- lru-cache 5.1.1 -> 11.5.3
- react 19.2.3 -> 19.3.0
- zod 4.3.6 -> 4.6.5
- postcss 8.5.23 -> 8.5.28
- remark-gfm 4.0.0 -> 4.0.1
- sharp 0.33.5 -> 0.35.5
- express 4.22.0 -> 5.2.1
- graphql 16.11.0 -> 17.0.2
- zod 3.24.0 -> 4.6.5
- node-fetch 2.7.0 -> 3.3.2
- lru-cache 10.4.3 -> 11.5.3
- type-fest 0.20.2 -> 5.10.0
- ts-morph 26.0.0 -> 28.0.0
- three 0.170.0 -> 0.186.1
- zustand 4.5.7 -> 5.0.15
- type-fest 0.21.3 -> 5.10.0

## Python (requirements, uv.lock)

- resolved: 383, behind latest: 152 (direct: 0), with advisories: 21, yanked/deprecated: 0

Open advisories with a newer release (bump or replace the consumer):
- accelerate 1.13.0: GHSA-4j2p-28q2-5m79, PYSEC-2026-3804 (latest 1.15.0)
- aiohttp 3.13.5: GHSA-2fqr-mr3j-6wp8, GHSA-4fvr-rgm6-gqmc, GHSA-4m7w-qmgq-4wj5 (latest 3.14.3)
- anyio 4.13.0: GHSA-5p39-cfhj-2xmp, GHSA-82r6-8w77-94w6, PYSEC-2026-4024 (latest 4.15.1)
- click 8.3.2: PYSEC-2026-2132 (latest 8.5.0)
- cryptography 46.0.6: GHSA-537c-gmf6-5ccf, GHSA-g6cj-pr64-35w5, GHSA-jwv3-5hgf-82ww (latest 50.0.2)
- datasets 4.8.4: GHSA-379c-qx7v-6h59, PYSEC-2026-3716 (latest 5.0.1)
- flask 2.3.3: GHSA-68rp-wp8r-4726, PYSEC-2026-2151 (latest 3.1.3)
- idna 3.11: GHSA-65pc-fj4g-8rjx, PYSEC-2026-215 (latest 3.20)
- msgpack 1.1.2: GHSA-6v7p-g79w-8964, PYSEC-2026-3625 (latest 1.2.3)
- pillow 12.2.0: GHSA-45hq-cxwh-f6vc, GHSA-4x4j-2g7c-83w6, GHSA-5x94-69rx-g8h2 (latest 12.3.0)
- pyasn1 0.6.3: GHSA-8ppf-4f7h-5ppj, GHSA-hm4w-wwcw-mr6r, GHSA-m4p7-r5rc-7g4j (latest 0.6.4)
- pytest 8.4.2: GHSA-6w46-j5rx-g56g, PYSEC-2026-1845 (latest 9.1.1)
- python-engineio 4.13.1: GHSA-cgwc-pv48-fhj5, GHSA-m9gh-vj53-gvh9, PYSEC-2026-3032 (latest 4.14.0)
- python-socketio 5.16.1: GHSA-5w7q-77mv-v69f, PYSEC-2026-3042 (latest 5.17.0)
- setuptools 81.0.0: GHSA-h35f-9h28-mq5c, PYSEC-2026-3447 (latest 84.0.0)
- urllib3 2.6.3: GHSA-8988-9cw3-xx77, GHSA-gh4c-6fx4-qh6g, GHSA-mf9v-mfxr-j63j (latest 2.8.0)

Held advisories (reason in `tools/config/deps/advisory-holds.json`):
- torch 2.8.0: GHSA-qfhq-4f3w-5fph, GHSA-rrmf-rvhw-rf47, GHSA-vgrw-7cvw-pwgx (latest 2.14.1) - pinned ==2.8.0 in aphrody-train: the 2.14.0 Windows wheel failed to import torch.amp in the CPU smoke test.
- torch 2.8.0+cu129: GHSA-qfhq-4f3w-5fph, GHSA-rrmf-rvhw-rf47, GHSA-vgrw-7cvw-pwgx (latest 2.14.1) - pinned ==2.8.0 in aphrody-train: the 2.14.0 Windows wheel failed to import torch.amp in the CPU smoke test.
- transformers 4.57.6: GHSA-29pf-2h5f-8g72, GHSA-69w3-r845-3855, GHSA-fgcw-684q-jj6r (latest 5.18.0) - kept below 4.58 by aphrody-train (sentence-transformers 5.x line); 5.x needs sentence-transformers 6.
- torch 2.11.0: GHSA-rrmf-rvhw-rf47 (latest 2.14.1) - pinned ==2.8.0 in aphrody-train: the 2.14.0 Windows wheel failed to import torch.amp in the CPU smoke test.
- transformers 5.5.0: GHSA-x9r9-c232-4q39, GHSA-xrqw-3rrv-vx5w, PYSEC-2026-3929 (latest 5.18.0) - kept below 4.58 by aphrody-train (sentence-transformers 5.x line); 5.x needs sentence-transformers 6.

## Git sources

- https://github.com/huggingface/candle: pinned 66a8cf184a5a; remote HEAD c68b24997319 - **HEAD moved**
- https://github.com/huggingface/hf-hub: pinned 473de9430b0f; remote HEAD 473de9430b0f
- https://github.com/EricLBuehler/mistral.rs: pinned 3f2515e9b5ad; remote HEAD 3f2515e9b5ad
- https://github.com/oxc-project/oxc: pinned 8c5a04ea0d5c; remote HEAD 4dce2c2a5577 - **HEAD moved**
- ssh://git@github-dev/aphrody-labs/taffy: pinned ed38f5bb36af; remote HEAD ed38f5bb36af
- https://github.com/koharu-rs/tauri-specta: pinned 77e14e0a342b; remote HEAD ebe38d6e0343 - **HEAD moved**

## First-party crates

- 217 crates (18 AI/MCP/model related by name)
- version drift from the workspace version (prerelease suffixes ignored; imported crates keep their upstream versions): 83
  - aphrody-a2a 0.3.0 (workspace 1.0.0)
  - aphrody-n2b-types 0.6.2 (workspace 1.0.0)
  - aphrody-n2b-registry 0.6.2 (workspace 1.0.0)
  - aphrody-n2b 0.6.2 (workspace 1.0.0)
  - aphrody-oxc-bridge 0.1.0 (workspace 1.0.0)
  - aphrody-n2b-core 0.6.2 (workspace 1.0.0)
  - aphrody-n2b-native 0.2.0 (workspace 1.0.0)
  - serde-saphyr 0.0.16 (workspace 1.0.0)
  - aphrody-a2a-pb 0.1.8 (workspace 1.0.0)
  - aphrody-a2a-grpc 0.2.2 (workspace 1.0.0)
  - aphrody-a2a-server 0.3.0 (workspace 1.0.0)
  - aphrody-a2a-client 0.1.16 (workspace 1.0.0)
  - whisper-rs-sys 0.14.1 (workspace 1.0.0)
  - ffmpeg-sys-next 7.1.3 (workspace 1.0.0)
  - xtask 0.1.0 (workspace 1.0.0)
  - sd-core 2.0.0-alpha.2 (workspace 1.0.0)
  - sd-bench 0.1.0 (workspace 1.0.0)
  - log-analyzer 0.1.0 (workspace 1.0.0)
  - sd-ffmpeg 0.1.0 (workspace 1.0.0)
  - sd-archive 0.1.0 (workspace 1.0.0)
- names already on crates.io (vendored upstream crates such as taffy or whisper-rs-sys are expected; first-party names there are a publish-time collision): 19
  - ffmpeg-sys-next
  - koharu
  - koharu-bindgen
  - koharu-diffusion
  - koharu-diffusion-sys
  - koharu-llama
  - koharu-llama-sys
  - koharu-renderer
  - koharu-runtime
  - koharu-torch
  - koharu-torch-sys
  - log-analyzer
  - obscura
  - serde-saphyr
  - simdutf
  - tauri-plugin-dialog
  - tauri-plugin-mcp-bridge
  - whisper-rs-sys
  - xtask
