<!-- SPDX-License-Identifier: Apache-2.0 -->
# Dependency inventory

Generated 2026-10-02T02:02:35.435Z by `aphrody-update deps inventory` (crates.io sparse index, npm, PyPI, git ls-remote, OSV). Full data: `target/deps-inventory/inventory.json` (not committed).

## Rust (Cargo.lock)

- resolved: 2370, behind latest: 914 (direct: 138), with advisories: 19, yanked/deprecated: 0

Held advisories (reason in `config/deps/advisory-holds.json`):
- atomic-polyfill 1.0.3: RUSTSEC-2023-0089 (latest 1.0.3) - unmaintained notice, transitive; no newer release.
- bincode 1.3.3: RUSTSEC-2025-0141 (latest 3.0.0) - RUSTSEC-2025-0141 is an unmaintained notice; 3.0.0 is not a drop-in replacement. Transitive (heed-types and others).
- bincode 2.0.1: RUSTSEC-2025-0141 (latest 3.0.0) - RUSTSEC-2025-0141 is an unmaintained notice; 3.0.0 is not a drop-in replacement. Transitive (heed-types and others).
- encoding 0.2.33: RUSTSEC-2021-0153 (latest 0.2.33) - unmaintained notice, transitive; no newer release.
- fxhash 0.2.1: RUSTSEC-2025-0057 (latest 0.2.1) - unmaintained notice, transitive (selectors 0.24).
- glib 0.18.5: GHSA-wrw7-89jp-8q8g, RUSTSEC-2024-0429 (latest 0.22.10) - gtk3-rs 0.18 stack required by tauri/wry on Linux (atk, cairo-rs, gdk); moves with the Tauri toolchain.
- number_prefix 0.4.0: RUSTSEC-2025-0119 (latest 0.4.0) - unmaintained notice, transitive; no newer release.
- paste 1.0.15: RUSTSEC-2024-0436 (latest 1.0.15) - unmaintained notice, transitive (rav1e, specta, safer-bytes); no replacement release.
- proc-macro-error 1.0.4: RUSTSEC-2024-0370 (latest 1.0.4) - unmaintained notice; used by glib-macros and gtk3-macros.
- proc-macro-error2 2.0.1: RUSTSEC-2026-0173 (latest 2.0.1) - unmaintained notice; used by nu-derive-value.
- quick-xml 0.31.0: RUSTSEC-2026-0194, RUSTSEC-2026-0195 (latest 0.42.0) - 0.38.4 comes from plist 1.7.4; 0.31.0 from an older transitive parent. Moves with its parent.
- quick-xml 0.38.4: RUSTSEC-2026-0194, RUSTSEC-2026-0195 (latest 0.42.0) - 0.38.4 comes from plist 1.7.4; 0.31.0 from an older transitive parent. Moves with its parent.
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
- argon2 0.5.3 -> 0.6.0
- arrow-array 58.4.0 -> 60.0.0
- arrow-schema 58.4.0 -> 60.0.0
- assert_cmd 2.0.13 -> 2.2.2
- base64 0.13.1 -> 0.23.1
- base64 0.21.7 -> 0.23.1
- base64 0.22.1 -> 0.23.1
- bindgen 0.69.5 -> 0.73.2
- bindgen 0.70.1 -> 0.73.2
- bindgen 0.72.1 -> 0.73.2
- clap_complete 4.4.10 -> 4.6.11
- console 0.15.11 -> 0.16.6
- crossterm 0.25.0 -> 0.29.0
- dirs 4.0.0 -> 7.0.0
- dirs 5.0.1 -> 7.0.0
- dirs 6.0.0 -> 7.0.0
- fastembed 5.17.3 -> 7.1.0
- getrandom 0.1.16 -> 0.4.3
- getrandom 0.2.17 -> 0.4.3
- getrandom 0.3.4 -> 0.4.3
- gix 0.83.0 -> 0.88.0
- glam 0.30.10 -> 0.33.12
- glam 0.31.1 -> 0.33.12
- glam 0.32.1 -> 0.33.12
- globset 0.4.19 -> 0.4.20
- googletest 0.14.2 -> 0.14.3
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
- icu_normalizer 1.5.0 -> 2.3.0
- icu_properties 1.5.1 -> 2.3.0
- ignore 0.4.30 -> 0.4.33
- indicatif 0.17.11 -> 0.18.6
- indicatif 0.18.4 -> 0.18.6
- jieba-rs 0.9.0 -> 0.11.0
- jieba-rs 0.10.4 -> 0.11.0
- json5 0.4.1 -> 1.3.1
- jsonschema 0.35.0 -> 0.58.4
- lancedb 0.29.0 -> 0.39.0
- libloading 0.8.9 -> 0.9.0
- md-5 0.10.6 -> 0.11.0
- miette 5.10.0 -> 7.6.0
- ndarray 0.16.1 -> 0.17.2
- notify-debouncer-full 0.6.0 -> 0.7.0
- nu-cmd-extra 0.115.1 -> 0.116.0
- nu-cmd-lang 0.115.1 -> 0.116.0
- nu-command 0.115.1 -> 0.116.0
- nu-engine 0.115.1 -> 0.116.0
- nu-parser 0.115.1 -> 0.116.0
- nu-protocol 0.115.1 -> 0.116.0

## Bun (bun.lock)

- resolved: 2843, behind latest: 1178 (direct: 122), with advisories: 8, yanked/deprecated: 11

Held advisories (reason in `config/deps/advisory-holds.json`):
- basic-ftp 5.3.1: GHSA-c475-qrg2-pj4r (latest 6.2.1) - transitive major (5 to 6); moves with its consumer.
- esbuild 0.27.7: GHSA-g7r4-m6w7-qqqr (latest 0.28.2) - 0.27/0.21/0.18 are pinned by vite and tool ranges that exclude 0.28; the advisories concern the esbuild dev server only.
- extract-zip 2.0.1: GHSA-7pqw-9j4j-h8q3, GHSA-jmr9-qjv8-65gv (latest 2.0.1) - no newer release (2.0.1 is latest).
- quill 2.0.3: GHSA-v3m3-f69x-jf25 (latest 2.0.3) - no newer release (2.0.3 is latest).
- uuid 9.0.1: GHSA-w5hq-g745-h8pq (latest 14.0.2) - uuid 9 is a transitive major; only v3/v5/v6 with a caller-supplied buffer is affected.
- esbuild 0.18.20: GHSA-67mh-4wv8-2f99 (latest 0.28.2) - 0.27/0.21/0.18 are pinned by vite and tool ranges that exclude 0.28; the advisories concern the esbuild dev server only.
- vite 5.4.21: GHSA-4w7w-66w2-5vf9, GHSA-fx2h-pf6j-xcff, GHSA-v6wh-96g9-6wx3 (latest 8.3.2) - vite 5.4 is a transitive dependency of tooling that has not moved to vite 7+; dev server only.
- esbuild 0.21.5: GHSA-67mh-4wv8-2f99 (latest 0.28.2) - 0.27/0.21/0.18 are pinned by vite and tool ranges that exclude 0.28; the advisories concern the esbuild dev server only.

Yanked or deprecated:
- @esbuild-kit/core-utils 3.3.2: Merged into tsx: https://tsx.hirok.io
- @esbuild-kit/esm-loader 2.6.5: Merged into tsx: https://tsx.hirok.io
- lodash.get 4.4.2: This package is deprecated. Use the optional chaining (?.) operator instead.
- lodash.isequal 4.5.0: This package is deprecated. Use require('node:util').isDeepStrictEqual instead.
- mimic-fn 3.1.0: Renamed to mimic-function
- mp4-muxer 5.2.2: This library is superseded by Mediabunny. Please migrate to it.
- node-domexception 1.0.0: Use your platform's native DOMException instead
- pkg-up 3.1.0: Renamed to package-up
- prebuild-install 7.1.3: No longer maintained. Please contact the author of the relevant native addon; alternatives are avail
- whatwg-encoding 3.1.1: Use @exodus/bytes instead for a more spec-conformant and faster implementation
- mimic-fn 2.1.0: Renamed to mimic-function

Direct dependencies behind latest:
- @ai-sdk/google-vertex 5.0.98 -> 5.0.101
- @ai-sdk/openai-compatible 3.0.59 -> 3.0.62
- @ai-sdk/provider 4.0.18 -> 4.0.21
- @asteasolutions/zod-to-openapi 8.5.0 -> 9.1.0
- @better-auth/agent-auth 0.5.1 -> 0.6.2
- @better-auth/api-key 1.7.6 -> 1.7.7
- @better-auth/oauth-provider 1.7.6 -> 1.7.7
- @better-auth/passkey 1.7.6 -> 1.7.7
- @cloudflare/workers-types 5.20260929.1 -> 5.20261002.1
- @colyseus/core 0.18.17 -> 0.18.18
- @colyseus/schema 5.0.34 -> 5.0.35
- @colyseus/sdk 0.17.43 -> 0.18.4
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
- @neon/config 1.8.2 -> 1.8.3
- @neon/env 1.4.7 -> 1.4.8
- @next/bundle-analyzer 16.3.5 -> 16.3.8
- @next/third-parties 16.3.6 -> 16.3.8
- @sentry/nextjs 11.0.0 -> 11.2.0
- @stripe/stripe-js 9.17.0 -> 10.0.0
- @supabase/ssr 0.10.3 -> 0.12.7
- @testing-library/jest-dom 6.10.0 -> 7.0.1
- @tiptap/core 3.31.3 -> 3.31.4
- @tiptap/extension-drag-handle 3.31.3 -> 3.31.4
- @tiptap/extension-drag-handle-react 3.31.3 -> 3.31.4
- @tiptap/extension-file-handler 3.31.3 -> 3.31.4
- @tiptap/extension-highlight 3.31.3 -> 3.31.4
- @tiptap/extension-image 3.31.3 -> 3.31.4
- @tiptap/extension-placeholder 3.31.3 -> 3.31.4
- @tiptap/extension-subscript 3.31.3 -> 3.31.4
- @tiptap/extension-superscript 3.31.3 -> 3.31.4
- @tiptap/extension-table 3.31.3 -> 3.31.4
- @tiptap/extension-text-align 3.31.3 -> 3.31.4
- @tiptap/extension-text-style 3.31.3 -> 3.31.4
- @tiptap/extension-youtube 3.31.3 -> 3.31.4
- @tiptap/extensions 3.31.3 -> 3.31.4
- @tiptap/html 3.31.3 -> 3.31.4
- @tiptap/pm 3.31.3 -> 3.31.4
- @tiptap/react 3.31.3 -> 3.31.4
- @tiptap/starter-kit 3.31.3 -> 3.31.4
- @tiptap/static-renderer 3.31.3 -> 3.31.4
- @tiptap/suggestion 3.31.3 -> 3.31.4
- @types/node 26.6.3 -> 26.6.4
- typescript 6.0.3 -> 7.0.2
- @vitest/ui 5.0.2 -> 5.0.3
- @vueuse/core 14.4.0 -> 15.0.0
- ai 7.0.122 -> 7.0.127
- better-auth 1.7.6 -> 1.7.7
- commander 14.0.3 -> 15.0.0
- dotenv 17.4.2 -> 18.0.5

## Python (requirements, uv.lock)

- resolved: 267, behind latest: 48 (direct: 0), with advisories: 3, yanked/deprecated: 0

Held advisories (reason in `config/deps/advisory-holds.json`):
- torch 2.8.0+cu129: GHSA-qfhq-4f3w-5fph, GHSA-rrmf-rvhw-rf47, GHSA-vgrw-7cvw-pwgx (latest 2.14.1) - pinned ==2.8.0 in aphrody-train: the 2.14.0 Windows wheel failed to import torch.amp in the CPU smoke test.
- transformers 4.57.6: GHSA-29pf-2h5f-8g72, GHSA-69w3-r845-3855, GHSA-fgcw-684q-jj6r (latest 5.18.0) - kept below 4.58 by aphrody-train (sentence-transformers 5.x line); 5.x needs sentence-transformers 6.
- torch 2.8.0: GHSA-qfhq-4f3w-5fph, GHSA-rrmf-rvhw-rf47, GHSA-vgrw-7cvw-pwgx (latest 2.14.1) - pinned ==2.8.0 in aphrody-train: the 2.14.0 Windows wheel failed to import torch.amp in the CPU smoke test.

## Git sources

- https://github.com/huggingface/candle: pinned 66a8cf184a5a; remote HEAD 5ba5d5b468b5 - **HEAD moved**
- https://github.com/huggingface/hf-hub: pinned 473de9430b0f; remote HEAD 473de9430b0f
- https://github.com/EricLBuehler/mistral.rs: pinned 3f2515e9b5ad; remote HEAD 3f2515e9b5ad
- https://github.com/aphrody-code/oxc: pinned 31d5266e150f; remote HEAD 31d5266e150f
- https://github.com/koharu-rs/tauri-specta: pinned 77e14e0a342b; remote HEAD ebe38d6e0343 - **HEAD moved**

## First-party crates

- 213 crates (17 AI/MCP/model related by name)
- version drift from the workspace version (prerelease suffixes ignored; imported crates keep their upstream versions): 87
  - aphrody-a2a-pb 0.1.8 (workspace 1.0.0)
  - aphrody-a2a 0.3.0 (workspace 1.0.0)
  - aphrody-n2b-scanners 0.6.2 (workspace 1.0.0)
  - aphrody-n2b-github 0.6.2 (workspace 1.0.0)
  - aphrody-n2b-report 0.6.2 (workspace 1.0.0)
  - aphrody-n2b-types 0.6.2 (workspace 1.0.0)
  - aphrody-n2b-rules 0.6.2 (workspace 1.0.0)
  - aphrody-n2b-registry 0.6.2 (workspace 1.0.0)
  - aphrody-n2b 0.6.2 (workspace 1.0.0)
  - aphrody-oxc-bridge 0.1.0 (workspace 1.0.0)
  - aphrody-n2b-util 0.6.2 (workspace 1.0.0)
  - aphrody-n2b-core 0.6.2 (workspace 1.0.0)
  - aphrody-n2b-native 0.2.0 (workspace 1.0.0)
  - aphrody-n2b-ai 0.6.2 (workspace 1.0.0)
  - aphrody-a2a-grpc 0.2.2 (workspace 1.0.0)
  - aphrody-a2a-server 0.3.0 (workspace 1.0.0)
  - aphrody-a2a-client 0.1.16 (workspace 1.0.0)
  - whisper-rs-sys 0.14.1 (workspace 1.0.0)
  - ffmpeg-sys-next 7.1.3 (workspace 1.0.0)
  - xtask 0.1.0 (workspace 1.0.0)
- names already on crates.io (vendored upstream crates such as taffy or whisper-rs-sys are expected; first-party names there are a publish-time collision): 16
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
  - taffy
  - whisper-rs-sys
  - xtask
