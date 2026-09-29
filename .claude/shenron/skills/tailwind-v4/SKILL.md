---
name: tailwind-v4
description: Tailwind CSS v4 conventions for the Shenron site (CSS-first config in apps/site/src/app/globals.css, @theme inline tokens, --color-dbz-* runtime theming, kit design rules). Use when writing or reviewing className utilities, editing globals.css, adding design tokens, or styling components in apps/site.
---

# Tailwind CSS v4 in Shenron

## Configuration model

- Tailwind v4, **CSS-first**: there is no `tailwind.config.*`. The single entry is
  `apps/site/src/app/globals.css` (`@import "tailwindcss"`, `@custom-variant dark`,
  two `@theme inline` blocks). `components.json` has `"config": ""` on purpose.
- Tokens: `@theme inline` maps utilities to CSS variables such as `var(--dbz-*, <default>)`.
  `/admin/design` overrides those variables at runtime, so **always use token utilities**
  (`bg-dbz-orange`, `text-dbz-yellow`, `border-dbz-*`) instead of raw hex/arbitrary colors.
- `@theme inline` does not emit variables on `:root`; where a raw variable is needed at
  runtime, it is re-declared further down in `globals.css` — follow that existing pattern.

## Design rules (from CLAUDE.md, non-negotiable)

- Components in `components/kit/`: surface + 1 px border, 12 px radius (`rounded-xl`),
  gold hover, **no drop shadow**, no hard-coded emoji.
- Reuse existing classes (`.dbz-button`, `.dbz-panel`, `.btn`, `.input`) before inventing
  utilities chains; the admin-only `components/ui/*` (Base UI) style is not the site style.

## v4 pitfalls

- Utilities renamed in v4: `shadow-sm`→`shadow-xs`, `shadow`→`shadow-sm`, `rounded-sm`→`rounded-xs`,
  `rounded`→`rounded-sm`, `outline-none`→`outline-hidden`, `ring`→`ring-3` (default width now 1 px).
- Opacity via slash (`bg-black/60`), not `bg-opacity-*`.
- Variants stack left-to-right (`hover:focus:`), `!` goes at the end (`bg-red-500!`).
- Custom utilities: `@utility name { … }`, not `@layer utilities`.
- Container queries are built in (`@container`, `@md:`).

## Validation

`cd apps/site && bun x tsc --noEmit`, `bun run lint`, and check the page in the dev server
(`bun run dev`). For deeper Tailwind recipes use the `aphrody:tailwindcss*` skills; for
current API facts query the Tailwind docs (Context7 `/tailwindlabs/tailwindcss.com`).
