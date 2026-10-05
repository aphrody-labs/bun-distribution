<!-- SPDX-License-Identifier: Apache-2.0 -->
# External UI forks

Upstream-derived frameworks are maintained in separate Git repositories. The Base UI and
Tailwind CSS forks are checked out as Git submodules in `third_party/`; Tauri and its plugins
are pinned Git dependencies in the root Cargo manifest and lockfile. Preserve upstream
notices and pin revisions for reproducible builds.

| Fork | Integration role | Initial revision |
| --- | --- | --- |
| [`aphrody-code/iced`](https://github.com/aphrody-code/iced) (`aphrody/m3-webgpu-30`) | Native retained widget/runtime integration and WebGPU-oriented renderer work | `1ea93cd92a0e6df1f22df8c8eafaec559016d05e` |
| [`aphrody-code/cryoglyph`](https://github.com/aphrody-code/cryoglyph) | Text rasterization dependency of the Iced fork | `e80ce58cd9d1f0003b9673a999681683c98e6013` |
| [`aphrody-code/base-ui`](https://github.com/aphrody-code/base-ui) | React DOM behavior primitives, `third_party/base-ui` | `7c6e2b0add13db9f41ca9c27426b4a9d17a7be1f` |
| [`aphrody-code/tailwindcss`](https://github.com/aphrody-code/tailwindcss) | M3 CSS utility compiler, `third_party/tailwindcss` | `377bb69fcdc905ac7e3a2b4805e9b6571c166220` |
| [`aphrody-code/tauri`](https://github.com/aphrody-code/tauri) | Current webview desktop host | `89499afc6c19068746a850e7bee71f7e4ed36ecf` |
| [`aphrody-code/plugins-workspace`](https://github.com/aphrody-code/plugins-workspace) | Current Tauri host plugins | `5baf71a47292d8490f0ba3d53f15224e55c48327` |

`aphrody-m3-tokens` remains the canonical Material 3 token source, and
`aphrody-render` remains the Aphrody rendering contract. Iced supplies widget state,
layout and interaction; a future integration must prove that UI and scene rendering use one
compatible GPU device and presentation surface before it could replace the current host.
Web and mobile support are separate validation targets, not implied by an Iced dependency.
Tauri-specific commands, capabilities and packaging stay in the host adapter and must not
leak into the framework core.

When updating a fork revision, record the upstream base and Aphrody-only delta in the
fork repository, update the root manifest and lockfile together, then run the local
Cargo, Bun and target-specific rendering gates. A source checkout or successful
dependency resolution alone is not proof of a working native or web interface.
