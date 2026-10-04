<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-ui documentation

Layout, crates and commands: root [`README.md`](./README.md.8c1fe132fe5c). Agent rules:
[`AGENTS.md`](../../../reference/ui/AGENTS.md). Package and crate docs sit next to the code. Material 3 guidance
comes from m3.material.io (or Context7), not from copies in this repository.

## Product and desktop

- [`BUN.md`](../../../reference/ui/BUN.md): root workspace, install isolation, catalogs, lifecycle trust and package commands.
- [`NATIVE-DESKTOP.md`](../../../reference/ui/NATIVE-DESKTOP.md): Tauri remains the current desktop host; standalone Rust GUIs are evaluated for packaging before considering a custom host.
- `INTEGRATION-2026-09-27.md` (historical, removed in commit 54745147e during docs pruning): short integration archive; not a feature status source.
- [`GUI.md`](../../../reference/ui/GUI.md): public webview scope, ownership boundaries and release evidence. Delivery order: [AI plan](../../../plans/ai/PLAN.md); owners: [AI architecture](../../../architecture/ai/ARCHITECTURE.md).
- [`AI-UI-INTEGRATION.md`](../../../reference/ui/AI-UI-INTEGRATION.md): AI ownership and desktop UI boundary.
- [`integrations/KOHARU.md`](../../../reference/ui/integrations/KOHARU.md): source-backed map of Koharu's UI, scene, pipeline and canvas capabilities against existing Aphrody UI surfaces; distinguishes shared primitives from an actual integration.
- [`UI-DESIGN.md`](../../../architecture/ui/UI-DESIGN.md): visual rules for the public Chat, Files, Models and Settings webview.
- [`UX-DESIGN.md`](../../../architecture/ui/UX-DESIGN.md): public webview flows, keyboard, focus and recovery behavior.
- [`UI-RULES.md`](../../../reference/ui/UI-RULES.md): binding product rules (no placeholders, no debug text, short copy).
- [`DESKTOP-INTEGRATION.md`](../../../reference/ui/DESKTOP-INTEGRATION.md): tray, deep links, installers, updater, runtime pitfalls.
- [`tauri/aphrody-integration.md`](../../../reference/ui/tauri/aphrody-integration.md): process boundaries, frontend build, runtime layout.
- [`tauri/plugins.md`](../../../reference/ui/tauri/plugins.md): plugin selection and capability rules.
- [`ACCESSIBILITY.md`](../../../reference/ui/ACCESSIBILITY.md): low-vision profile defaults.

Design and method maps describe the intended product. `GUI.md` separates implemented surfaces
from proposed adapters, source findings from operator-reported validation, and runtime release
evidence. The frontend is consolidated in `packages/app-ui` (not in repo); FSL-derived Drive source remains
a provenance/release gate.

## Material 3 layer

- [`design/APHRODY-M3-CANONICAL-CONTRACT.md`](../../../architecture/ui/design/APHRODY-M3-CANONICAL-CONTRACT.md): token ownership and integration rules.
- [`design/M3-PLAN.md`](../../../plans/ui/design/M3-PLAN.md): decisions D1-D10 and open items.
- [`design/M3-MULTI-HOST-PLAN.md`](../../../plans/ui/design/M3-MULTI-HOST-PLAN.md): framework layers, customization contract, web/desktop/mobile delivery matrix and host qualification.
- [`design/UI-DEDUPLICATION-PLAN.md`](../../../plans/ui/design/UI-DEDUPLICATION-PLAN.md): measured UI/package overlaps, canonical owners, migration order and removal gates.
- [`design/M3-FRAMEWORK.md`](../../../architecture/ui/design/M3-FRAMEWORK.md): `@aphrody/m3` packages, plugin, build and pitfalls.
- [`design/FUSION-PLAN.md`](../../../plans/ui/design/FUSION-PLAN.md): M3 tokens to Tailwind v4 and shadcn aliases.
- [`design/SPACEUI-M3-FUSION.md`](../../../architecture/ui/design/SPACEUI-M3-FUSION.md): SpaceUI rebuild, component rules, Base UI.
- [`design/aphrody-m3-tokens.md`](../../../architecture/ui/design/aphrody-m3-tokens.md): brand colour seeds ([`aphrody-m3-theme.json`](../../../architecture/ui/design/aphrody-m3-theme.json)).
- [`design/TYPOGRAPHY.md`](../../../architecture/ui/design/TYPOGRAPHY.md): type owners and font axes.
- [`design/FONTS-AND-ICONS.md`](../../../architecture/ui/design/FONTS-AND-ICONS.md): font subsets, fallbacks, Tauri delivery, app icons.
- [`design/M3-ICONS.md`](../../../architecture/ui/design/M3-ICONS.md): Material Symbols as SVG.
- [`SVG.md`](../../../reference/ui/SVG.md): `aphrody-svg`, the single SVG owner.
- [`PUBLISHING.md`](../../../reference/ui/PUBLISHING.md): npm publication of the `@aphrody/*` packages.

## Rendering

- [`design/M3-RENDER.md`](../../../architecture/ui/design/M3-RENDER.md): `aphrody-render` 2D/3D scene model, backends, FFI.
- [`design/M3-REPRODUCE.md`](../../../architecture/ui/design/M3-REPRODUCE.md): screenshot or crawl to an M3 theme.
- [`WASM/wgpu-webgpu.md`](../../../reference/ui/WASM/wgpu-webgpu.md): wgpu and wasm-bindgen pins, 26 -> 29 migration.
- [`CANVAS-UPSTREAM.md`](../../../reference/ui/CANVAS-UPSTREAM.md): `@aphrody/canvas` and its upstream.

## Drive

- [`design/SPACEUI-SPACEDRIVE-MIGRATION.md`](../../../architecture/ui/design/SPACEUI-SPACEDRIVE-MIGRATION.md): Drive ownership, known gaps, gates.
- [`DRIVE-UPSTREAM-DIFF.md`](../../../reference/ui/DRIVE-UPSTREAM-DIFF.md): `drive/` versus upstream Spacedrive.
