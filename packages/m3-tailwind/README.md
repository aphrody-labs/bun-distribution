<!-- SPDX-License-Identifier: Apache-2.0 -->

# `@aphrody/m3-tailwind`

Tailwind v4 CSS-first preset for Material 3. `preset.css` holds a `@theme inline` block generated from
`@aphrody/m3-tokens` (colour roles, corner scale, 15 base and 15 emphasized type styles, easings, elevation).

```css
@import "tailwindcss";
@import "@aphrody/m3-tokens/m3-tokens.css";
@import "@aphrody/m3-tokens/expressive.css";
@import "@aphrody/m3-tailwind/preset.css";
@plugin "@aphrody/m3-tailwind/plugin"; /* optional: .state-layer */
```

Utilities: `bg-primary`, `text-on-surface`, `rounded-large`, `text-body-large`, `text-label-large-emphasized`,
`ease-emphasized`, `shadow-elevation-2`. Colour values are set at runtime (`applyDynamicColor`, `<m3-theme>`).
`themeCss({ keepUnused: true })` emits `@theme static`. `bun run generate` rewrites `preset.css`; a test
compiles utilities with `@tailwindcss/node`. The Tailwind fork in `forks/tailwindcss` is the source of the
`tailwindcss` catalog version.

`bun test test/`, `bun run typecheck`.
