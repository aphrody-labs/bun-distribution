<!-- SPDX-License-Identifier: Apache-2.0 -->
# Koharu capability map: Aphrody Web

This note compares Aphrody Web with Koharu at source revision
[`c697b31e`](https://github.com/koharu-rs/koharu/commit/c697b31eb1de016d9272743a2973f0e6a67eae6c).
It records potential Web reuse points only. It does not describe a direct
Aphrody Web integration, data transfer, or deployment.

## Working-tree update (2026-09-28)

Koharu's new headless [`koharu-library`](../../../products/koharu/crates/koharu-library/README.md)
is consumed by the optional `aphrody-manga` feature in Aphrody AI; its focused
Cargo check passed. The image, ZIP/CBZ, RAR, and PDF importer moved from the
Tauri command module into [`koharu-library/src/import/`](../../../aphrody-koharu/crates/koharu-library/src/import/),
which Koharu's desktop now also uses. Aphrody Web has no direct Koharu
dependency, provider adapter, crawler, or import service. The comparison and
commit-pinned source links below describe the 2026-09-27 snapshot.

## Capabilities that could be reused

| Koharu area | Koharu source | Aphrody Web counterpart | Boundary |
| --- | --- | --- | --- |
| Remote text translation providers | `crates/koharu-translator/src/provider.rs`, `src/remote/` | `docs/web/GOOGLE-TRANSLATE.md`; BXC Google helpers in `apps/bxc/src/google/` | Koharu owns a provider-configured manga translation interface, including Google Cloud Translation and several LLM and MT providers. Aphrody Web's Google Translate implementation exposes its own Google-like REST/MCP surface. It is a possible transport/service option only after a deliberate adapter maps Koharu's request, response, authentication, and error contracts; it is not currently Koharu's provider implementation. |
| Model/runtime asset downloads | Koharu's `crates/koharu-runtime/src/source/` | `crates/aphrody-web-ffi/src/native_http.rs` (`bxc_obscura_fetch`), `apps/bxc/src/api/browser.ts`, Obscura network crates | Koharu's source loaders obtain runtime/model assets; Aphrody Web exposes generic URL and page transports. Those transports do not form a Koharu model loader and no manga source downloader or Koharu archive importer is provided here. |
| Browser driven web views and UI smoke checks | Koharu's Tauri and web UI under `packages/koharu/` | `apps/bxc/src/api/browser.ts`, `packages/bxc-test/` | BXC can automate supported web content and `@aphrody/bxc-test` provides a Playwright-shaped Bun test surface. This does not establish a Koharu Tauri integration, validate its native GPU output, or replace the Koharu canvas/WebGPU path. |

## Koharu responsibilities that remain Koharu-owned

- Manga page ingestion in the current [`koharu-library/src/import/`](../../../aphrody-koharu/crates/koharu-library/src/import/)
  handles raster files, ZIP/CBZ, RAR, and PDF. The 2026-09-27 snapshot placed
  this parser in `crates/koharu-app/src/commands/import/`. It reads local paths
  and decodes image pages; it is not an Aphrody Web crawl/import API.
- Image understanding and translation orchestration remain in Koharu's own
  `koharu-ml`, `koharu-pipeline`, and `koharu-translator` crates. Aphrody Web's
  text extraction, browser automation, Google Translate service, and generic HTTP
  transport do not implement manga detection, OCR, inpainting, typesetting, or
  Koharu's structured page results.
- The Koharu browser canvas in `crates/koharu-canvas/src/web.rs` prepares and
  presents Koharu's page manifest/resources through WebGPU. Aphrody Web's Obscura
  is a headless web engine, not Koharu's desktop renderer.

## Practical reading

For a future integration, treat the Koharu provider contract or an explicit
HTTP/service boundary as the seam. Reuse a Web transport only for its bounded
network/browser responsibility; keep Koharu image, model, project, and editorial
state in Koharu. The source comparison above is not evidence that either product
currently calls the other.

## Sources

- Koharu historical snapshot at `c697b31e`: [`crates/koharu-translator/src/provider.rs`](https://github.com/koharu-rs/koharu/blob/c697b31eb1de016d9272743a2973f0e6a67eae6c/crates/koharu-translator/src/provider.rs), [`crates/koharu-translator/src/remote/`](https://github.com/koharu-rs/koharu/tree/c697b31eb1de016d9272743a2973f0e6a67eae6c/crates/koharu-translator/src/remote), [`crates/koharu-app/src/commands/import/`](https://github.com/koharu-rs/koharu/tree/c697b31eb1de016d9272743a2973f0e6a67eae6c/crates/koharu-app/src/commands/import), [`crates/koharu-canvas/src/web.rs`](https://github.com/koharu-rs/koharu/blob/c697b31eb1de016d9272743a2973f0e6a67eae6c/crates/koharu-canvas/src/web.rs). Current importer: [`crates/koharu-library/src/import/`](../../../aphrody-koharu/crates/koharu-library/src/import/).
- Aphrody Web, [`GOOGLE-TRANSLATE.md`](./GOOGLE-TRANSLATE.md), [`native_http.rs`](../../crates/aphrody-web-ffi/src/native_http.rs), [`browser.ts`](../../apps/bxc/src/api/browser.ts), [`@aphrody/bxc-test`](../../../products/web/packages/bxc-test/README.md).
