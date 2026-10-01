<!-- SPDX-License-Identifier: Apache-2.0 -->
# M3 framework and host plan

## Goal and boundary

Build a customizable Material 3 framework whose design contract can be rendered on web,
desktop and mobile. Share roles, interaction expectations and adaptive rules; qualify each
renderer and installed host separately. The Aphrody product currently has one Tauri v2
desktop webview in `packages/app-ui` for Chat, Files, Models and Settings. Its product scope
is defined by [GUI](../../../reference/ui/GUI.md). Browser navigation, shell/PTY/terminal sessions and system
administration stay outside that webview.

The framework is a library, not a second product navigation shell. Generic packages must
not depend on Aphrody AI, Drive, Tauri commands or FSL source. Keep Drive as the Files
feature of the product, with its own runtime and provenance boundary.

## One contract, several renderers

| Layer | Owner | Portable contract |
| --- | --- | --- |
| Design roles | `crates/aphrody-m3-tokens` | Palette/HCT, typography, shape, elevation, motion, state, adaptive classes and accessibility defaults. |
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

| Target | Current state | Next evidence |
| --- | --- | --- |
| Browser/Bun and Next.js | Packages and examples exist | Build and use the same theme in both; verify hydration, keyboard, screen reader and browser CSS support. |
| Tauri desktop | Current product host | Verify installed offline bundle and real Chat/Files/Models/Settings workflows on supported OSes. |
| Mobile browser | Adaptive tokens and web components exist; no qualified mobile app | Add a focused responsive example; verify touch, safe areas, keyboard, viewport changes and accessibility on Android and iOS browsers. |
| Android/iOS installed app | No mobile host or package in this repository | Start with a separate, small Tauri mobile webview pilot using generated M3 assets and allow-listed capabilities. Prove installed builds and platform integrations before expanding product scope. |
| React Native or native Rust mobile | No adapter delivered | Add only for a measured need the webview cannot meet; implement the shared token and interaction contract, then qualify each platform. |
| Standalone Rust desktop GUI | Reusable renderer crates exist; no replacement host qualified | Evaluate mature Rust GUIs for packaging first. A custom winit/wgpu host needs a concrete unmet workflow and installed accessibility, rendering and lifecycle evidence. |

Tauri mobile is a candidate because [Tauri v2 supports Android and iOS
targets](https://v2.tauri.app/start/prerequisites/); the present
`aphrody-app` configuration and sidecars are desktop-specific. The pilot must be a separate
host, with platform-safe capabilities and no assumption that the desktop broker, Drive daemon
or windows can run on mobile. iOS builds require a macOS/Xcode builder. React Native remains
a possible later adapter, not a current framework feature.

## Order of work

1. **Stabilize the contract.** Replace `packages/m3-design/src/hct.ts` HSL palettes with
   canonical output, verify the TypeScript runtime scheme against Rust, specify typed
   theme inputs and export one versioned role/adaptive schema for CSS, TypeScript and Rust.
2. **Complete the web kit.** Document component states and composition; resolve conflicting
   form APIs and stale compatibility names; prove Base UI/Tailwind fork behavior in both web
   engines and keep the Lit mapping accurate.
3. **Qualify responsive web.** Use one small component showcase across compact, medium and
   expanded windows, including mobile browser ergonomics and assistive technology.
4. **Qualify installed hosts.** Validate Tauri desktop offline first; then build the isolated
   Android/iOS pilot from the same generated assets and record platform-specific gaps.
5. **Add native adapters selectively.** Keep tokens and interaction contract portable;
   add a renderer only when its target, consumers and release gates are concrete.

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
