---
name: base-ui
description: Base UI (@base-ui/react) usage in the Shenron site — unstyled accessible primitives wrapped by shadcn "base-nova" components in apps/site/src/components/ui. Use when adding, editing or debugging a component that imports @base-ui/react, when touching apps/site/src/components/ui/*, or when running `shadcn add` in apps/site.
---

# Base UI in Shenron

## Scope (read first)

- `apps/site/src/components/ui/*` wraps `@base-ui/react` with `cva` + shadcn tokens
  (`bg-primary`, `ring`, `destructive`). It serves **only the admin article editor**
  (`app/admin/posts/`). It is not the site design system — see the header of
  `components/ui/button.tsx`.
- Public pages use `components/kit/` and the `.dbz-*` classes / `--color-dbz-*` tokens in
  `src/app/globals.css` (see the `tailwind-v4` skill). Do not spread `<Button>` to public pages.

## Rules

1. Import primitives by subpath: `import { Dialog } from "@base-ui/react/dialog"`.
2. Base UI uses a `render` prop for composition, not Radix `asChild`. Replace any `asChild`
   pattern with `render={<Link href=… />}`.
3. Style via `className` (string or `(state) => string`) and data attributes
   (`data-[open]`, `data-[disabled]`, `data-[highlighted]`, `data-[starting-style]`,
   `data-[ending-style]`) — Base UI exposes state as attributes, not `data-state="open"`.
4. Portal-based parts (Popover, Select, Menu, Dialog, Tooltip) need `*.Portal` + `*.Positioner`
   (or `Backdrop`/`Popup` for dialogs); keep them in client components (`"use client"`).
5. New shadcn components: `cd apps/site && bunx shadcn@latest add <name>` (config
   `components.json`, style `base-nova`). Never npm/pnpm/npx.
6. Design-system rule from `CLAUDE.md` still applies to anything user-facing: 1 px border,
   12 px radius, gold hover, no drop shadow, no hard-coded emoji.

## Current API reference

Fetch before using an unfamiliar part or prop (training data may lag the installed 1.x):

- Index for agents: https://base-ui.com/llms.txt
- Per-component docs: `https://base-ui.com/react/components/<name>` (append `.md` for markdown when available)

Installed version: see `@base-ui/react` in `apps/site/package.json`.
