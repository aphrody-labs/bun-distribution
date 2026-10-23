<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-tailwind

Tailwind v4 CSS-first preset for Material 3: one `@import`, no JS plugin, no config file.

```sh
bun add @aphrody/m3-tailwind @aphrody/m3-tokens tailwindcss
```

```css
@import "tailwindcss";
@import "@aphrody/m3-tokens/m3-tokens.css";
@import "@aphrody/m3-tokens/expressive.css";
@import "@aphrody/m3-tailwind/preset.css";
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

`preset.css` is generated from `@aphrody/m3-tokens` (roles, corner scale, type, breakpoints, springs and directional
shapes from the TypeScript tables; durations, easings, elevation and state layers from `m3-tokens.css`).

Colour values are set at runtime (`applyDynamicColor`, `<m3-theme>`, `M3Html` in `@aphrody/m3-next`).

With Bun, `@aphrody/bun-plugin-tailwind` adds these imports and a seeded colour scheme on its own: `tailwind({ theme: "m3" })`
(or `{ theme: { seed: "#0b57d0" } }`), and the same option on its PostCSS plugin.

## What it adds

| Family                | Theme keys (`@theme inline`)                                                         | Utilities and variants                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Colour (all 49 roles) | `--color-*`                                                                          | `bg-primary`, `text-on-surface`, `border-outline-variant`, `hover:bg-on-surface/8`                                                         |
| Shape                 | `--radius-*`, `--shape-*`                                                            | `rounded-large`, `shape-extra-large-top`, `shape-large-start` (RTL-aware)                                                                  |
| Type                  | `--text-*` (15 base + 15 emphasized, with line height, tracking, weight), `--font-*` | `text-body-large`, `text-title-small-emphasized`, `typescale-label-large` (also sets the family), `font-brand`                             |
| Elevation             | `--shadow-elevation-0..5`                                                            | `shadow-elevation-2`                                                                                                                       |
| Motion                | `--ease-*`, `--transition-duration-*`, spring `linear()` easings and settle times    | `ease-emphasized`, `duration-medium2`, `ease-spring-expressive-fast-spatial`, `motion-default-effects` (easing and duration in one class)  |
| State                 |                                                                                      | `state-layer`, `state-layer-primary` (hover, focus, pressed, dragged; honours Base UI `data-highlighted`, `data-pressed`, `data-disabled`) |
| Adaptive              | `--breakpoint-*`                                                                     | `compact:`, `medium:`, `expanded:`, `large:`, `extra-large:`, `h-compact:`, `h-medium:`, `h-expanded:`                                     |
| Scheme                |                                                                                      | `dark:` follows `.dark`, or the OS unless `.light` forces light                                                                            |
| Base UI state         |                                                                                      | `m3-open:`, `m3-on:`, `m3-highlighted:`, `m3-disabled:`, `m3-invalid:`, `m3-enter:`, `m3-exit:`, `m3-vertical:`, `m3-horizontal:`          |

`@theme inline` means a variable is emitted only when a utility uses it, so the preset costs bytes in proportion to what an
app writes (see `docs/reports/M3-NEXT-BUNDLE.md`). `themeCss({ keepUnused: true })` emits `@theme static`.

Springs: CSS has no spring easing and a cubic-bezier cannot overshoot, so each spring token (damping ratio, stiffness) is
sampled into a 33-stop `linear()` with its settle time (`src/spring.ts`); the Expressive spatial springs keep their bounce.

`bun run generate` rewrites `preset.css`; the tests check it is up to date, that every token the preset reads exists in
the token sheets, and compile one utility per family with `@tailwindcss/node` from the root catalog. Pinned upstream sources live in `vendor/tailwindcss`; local leaf, Cargo/NAPI and artifact integration remains unqualified. The consumer currently uses installed catalog packages, not that source tree.

`bun test test/`, `bun run typecheck`.
