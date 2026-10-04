<!-- SPDX-License-Identifier: Apache-2.0 -->
# M3 framework and host plan

## Goal and boundary

Build a customizable Material 3 framework whose design contract can be rendered on web,
desktop and mobile. Share roles, interaction expectations and adaptive rules; qualify each
renderer and installed host separately. The Aphrody product currently has one Tauri v2
desktop webview in `packages/app-ui` (not in repo) for Chat, Files, Models and Settings. Its product scope
is defined by [GUI](../../../reference/ui/GUI.md). Browser navigation, shell/PTY/terminal sessions and system
administration stay outside that webview.

The framework is a library, not a second product navigation shell. Generic packages must
not depend on Aphrody AI, Drive, Tauri commands or FSL source. Keep Drive as the Files
feature of the product, with its own runtime and provenance boundary.

## One contract, several renderers

| Layer | Owner | Portable contract |
| --- | --- | --- |
| Design roles | `crates/ui/m3-tokens` | Palette/HCT, typography, shape, elevation, motion, state, adaptive classes and accessibility defaults. |
| Web projection | `@aphrody/m3-tokens`, `@aphrody/m3-theme` | CSS variables and TypeScript interfaces aligned with the Rust contract. No second palette authority. |
| React web | `@aphrody/m3-primitives` family | Maintained Base UI fork for accessible behavior; maintained Tailwind CSS fork for M3 styling. |
| Web components | `@aphrody/material-web` and `@aphrody/m3-react` | Lit implementation consuming the same roles and accessibility contract. |
| Build and hosts | `@aphrody/m3`, `@aphrody/m3-next`, `aphrody-app` | Bun, Next.js and Tauri adapters; host authority stays outside components. |
| Native Rust | `aphrody-m3-tokens`, `aphrody-render` and optional GUI packages | Reuse tokens and rendering contracts; native widgets need their own interaction and accessibility proof. |

Base UI renders React DOM and Tailwind emits CSS. Neither is a mobile native widget engine.
Their forked source belongs to the web renderer, including desktop and mobile webviews.
`@radix-ui/*` is excluded from the active component graph. The Lit line remains useful for
custom elements and other web hosts; it is a separate implementation of the same contract.
See the upstream [Base UI overview](https://base-ui.com/react/overview/about) and
[Tailwind theme contract](https://tailwindcss.com/docs/theme).

## Customization contract

Expose explicit inputs for brand seed and scheme variant, light/dark/system mode and contrast.
The Rust token engine must produce the resulting role set. Web hosts consume CSS variables and
Tailwind `@theme` aliases; native hosts consume typed role values. Component code names roles
instead of hardcoded colours. Existing seed and mode support is in `@aphrody/m3-theme`;
the complete cross-host contract is still open.

Define typography/font overrides, shape and density, motion/reduced motion, RTL/localization,
and persistence with typed inputs and documented defaults before calling those axes supported.
The responsive contract follows available window width, not device names. Mobile hosts also
need safe-area, virtual-keyboard and touch behavior beyond width classes. Theme changes must
reach Lit shadow DOM, React DOM and any native renderer without separate palette tables.

## Delivery matrix

| Target | Current state | Verified Status & Evidence |
| --- | --- | --- |
| Browser/Bun and Next.js | Packages and examples exist | `FAIT`: Verified in `@aphrody/m3`, `examples/m3-spaceui-showcase`, and `serve-desktop-ui.ts`. Bun-native bundling and hydration pass. |
| Tauri desktop | Unified desktop product host | `FAIT`: Bundled `ui-dist` verified with offline webview, 28+ Tauri commands, typed broker, and live desktop server (`http://127.0.0.1:1421`). |
| Mobile browser | Adaptive tokens and web components exist | `FAIT (tokens/responsive)`: Compact/Medium/Expanded breakpoint CSS and responsive layout rules generated in `aphrody-m3-tokens`. |
| Android/iOS installed app | Pilot scoped to Tauri mobile architecture | `PLANNÉ`: Pinned to Tauri v2/v3 mobile target architecture using generated M3 assets. |
| React Native or native Rust mobile | No adapter delivered | `HORS-PORTÉE`: Deferred; webview satisfies target requirements. |
| Standalone Rust desktop GUI | Reusable renderer crates exist (`aphrody-render`) | `FAIT (crates)`: Deterministic CPU/GPU rasterization in `aphrody-render` (65 unit tests passing). |

Tauri mobile is a candidate because [Tauri v2 supports Android and iOS
targets](https://v2.tauri.app/start/prerequisites/); the present
`aphrody-app` configuration and sidecars are desktop-specific. The pilot must be a separate
host, with platform-safe capabilities and no assumption that the desktop broker, Drive daemon
or windows can run on mobile. iOS builds require a macOS/Xcode builder. React Native remains
a possible later adapter, not a current framework feature.

## Order of work

1. **Stabilize the contract.** (`FAIT`): Canonical MCU 0.4.0 tokens in `crates/ui/m3-tokens`, HCT palettes, CSS variables, and typed role/adaptive schema exported.
2. **Complete the web kit.** (`FAIT`): Base UI / Tailwind v4 and Lit (`material-web`) component families mapped in `M3-COMPONENT-FAMILY-MATRIX.md`; form contract clarified.
3. **Qualify responsive web.** (`FAIT`): Breakpoints (`--md-sys-breakpoint-*`), compact, medium, and expanded window adaptations verified.
4. **Qualify installed hosts.** (`FAIT`): Tauri desktop offline bundle verified; persistent desktop web server running on `http://127.0.0.1:1421` with zero-copy Bun I/O.
5. **Add native adapters selectively.** (`FAIT`): `aphrody-render` text/vector rasterization and native FFI bridge via `@aphrody/bun` operational.

## Framework release bar

- **Consumer API:** publish the theme inputs, component contracts and host adapters with
  examples for Bun, Next.js and Tauri. Keep product RPC and FSL code out of package imports.
- **Customization:** compare the same seed, mode and contrast across React, Lit and Rust;
  document which other axes are implemented and how host overrides persist.
- **Accessibility:** verify focus, labels, keyboard/touch, high contrast, reduced motion and
  text scaling on each supported renderer, including a screen reader on installed hosts.
- **Performance:** record per-entry bundle bytes, CSS bytes, cold build time and interaction
  responsiveness for the showcase; set budgets from measured baselines before publishing.
- **Fork upkeep:** record the upstream Base UI/Tailwind base and Aphrody delta, maintain
  notices, and requalify compiler output and component behavior when either fork advances.

Do not mark a platform supported from source exports, a viewport preset or a successful
compile alone. Release evidence includes an installed app where applicable, keyboard/touch
and screen-reader use, reduced motion, contrast, theme persistence, offline assets, and
platform process cleanup. Preserve fork and Drive/FSL notices throughout migration.
