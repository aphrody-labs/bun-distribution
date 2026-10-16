# M3 / Material 3 Expressive web research (2026-10-04)

Dated web research. Claims are labelled from search snippets and need
re-verification before being treated as contract.

## Material 3 Expressive

- Announced at Google I/O May 2025 (Android 16, Wear OS). Built on colour, shape,
  size, motion and containment. Physics-based motion tokens, expanded
  typography with emphasized styles, morphing shape system.
- New first-wave components: button groups, split buttons, FAB menu, floating
  toolbars, loading indicator, vertical carousel, refreshed progress indicators.
- Compose Material 3 is the reference implementation; the View-based
  material-components-android library is reported to be in maintenance.
- Links: [m3.material.io](https://m3.material.io/),
  [Google Design: expressive research](https://design.google/library/expressive-material-design-google-research),
  [Supercharge: M3 Expressive](https://supercharge.design/blog/material-3-expressive),
  [Material Expressive 2026 overview](https://www.sabaoon.dev/blog/material-expressive).

## Material Web (@material/web)

- Placed in maintenance mode in June 2024 pending new maintainers; no large
  updates planned. Hence the private fork `vendor/material-web` and the
  `@aphrody/m3*` packages owning the maintained surface.
- Community continuation: [material3-returns](https://github.com/ganeshnallasivam-cell/material3-returns),
  [m3-expressive-web](https://github.com/lobsterbs/m3-expressive-web).
- Links: [m3.material.io/develop/web](https://m3.material.io/develop/web),
  [material-web repo](https://github.com/material-components/material-web),
  [maintenance discussion #5642](https://github.com/material-components/material-web/discussions/5642),
  [Telerik: what is going on with Material](https://www.telerik.com/blogs/whats-going-material).

## Material Symbols / icons

- 2,500+ icons, one variable font with four axes (fill, weight, grade, optical
  size), SVG and PNG exports, Apache-2.0.
- Source of SVGs: [google/material-design-icons](https://github.com/google/material-design-icons)
  (fork: `vendor/material-design-icons`).
- Links: [Material Symbols guide](https://developers.google.com/fonts/docs/material_symbols),
  [fonts.google.com/icons](https://fonts.google.com/icons),
  [Introducing Material Symbols](https://m3.material.io/blog/introducing-symbols/),
  [npm material-symbols](https://www.npmjs.com/package/material-symbols).

## Tailwind CSS v4 tokens

- CSS-first config: tokens live in `@theme`, all exposed as CSS variables;
  `@theme inline` maps semantic variables to utilities. Three layers are the
  common pattern: base, semantic, component.
- Links: [Tailwind v4 announcement](https://tailwindcss.com/blog/tailwindcss-v4),
  [semantic tokens with @theme inline](https://kuray.dev/blog/ui-ux-design/design-system-tailwind-v4-semantic-tokens-072025),
  [designtoken.md Tailwind](https://designtoken.md/frameworks/tailwind).
- Fork: `packages/tailwindcss`. Headless primitives: `packages/base-ui`
  ([base-ui.com](https://base-ui.com/)).

## Tauri icons

- `tauri icon <svg|png> [-o dir]` generates `icon.ico`, `icon.icns` and PNG sizes
  from a square source. Used by `packages/material-design-icons/scripts/svg-to-ico.ts`.
- Links: [App Icons](https://v2.tauri.app/develop/icons/),
  [Tauri CLI reference](https://v2.tauri.app/reference/cli/).

## Colour

- `vendor/material-color-utilities` is the HCT / dynamic colour source
  (`@material/material-color-utilities`, consumed by `@aphrody/m3-theme`).
