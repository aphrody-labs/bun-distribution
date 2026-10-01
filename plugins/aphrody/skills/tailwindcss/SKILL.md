---
name: tailwindcss
description: "Tailwind CSS v4 (CSS-first @theme, @utility, @custom-variant): layouts, grid/flex/container queries, animations, mobile-first responsive design, and v3-to-v4 migration. Use when writing or fixing Tailwind classes or theming any Tailwind project."
version: "1.1.0"
---

# Tailwind CSS

## First, detect the major version

Check `tailwindcss` in `package.json` / the lockfile.

- **v4** (4.x; 4.3.3 on 2026-10-01): CSS-first. The stylesheet starts with
  `@import "tailwindcss";`; design tokens live in `@theme { --color-brand: ...; }`; custom
  utilities use `@utility`, variants `@custom-variant`; plugins load with `@plugin`; a JS
  config is optional and only loaded via `@config`. Build integration is `@tailwindcss/vite`,
  `@tailwindcss/postcss` or `@tailwindcss/cli`. Content detection is automatic (add paths
  with `@source`).
- **v3**: `tailwind.config.js` with `theme.extend` and `@tailwind base/components/utilities`.
  Keep v3 syntax in v3 projects; to migrate run `npx @tailwindcss/upgrade` (or `bunx`) on
  a clean branch.

Reference files are written for v4.

## References (read only the one needed)

| Topic | File |
| --- | --- |
| Grid, flexbox, container queries, subgrid, holy-grail, masonry, aspect ratio | `references/advanced-layouts.md` |
| `animate-*`, custom keyframes in `@theme`, transitions, reduced motion, scroll-driven, view transitions | `references/animations.md` |
| Longer animation recipes (fade/slide/scale sets, staggered lists) | `references/animations-animation-patterns.md` |
| Breakpoints, mobile-first ordering, responsive type, safe areas, touch vs hover (summary) | `references/mobile-first.md` |
| Full mobile-first guide (fluid type/spacing, touch targets, navigation, performance) | `references/mobile-first-mobile-first-complete-guide.md` |

## Related skills

- Material 3 layout rules (window size classes, navigation swaps): `responsive-adaptive`,
  `material-3`.
- shadcn/ui components on Tailwind: `shadcn`.
- Exact syntax for a specific minor release: the `docs` skill
  (`https://tailwindcss.com/docs`).
