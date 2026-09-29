<!-- SPDX-License-Identifier: Apache-2.0 -->
# @aphrody/m3-next-migrate

High-performance migration engine, AST codemod and runtime shims to migrate **Next.js 16** UI and React components to **Tauri v2** desktop applications or **Bun / Vite** web SPAs.

## Why Migrate from Next.js 16 to Tauri v2 or Vite?

Next.js 16 introduces React 19, Server Actions, Async Request APIs (`await params`, `await cookies()`), and deep coupling to Vercel/Node edge runtimes. Migrating UI components to a desktop application (Tauri v2) or client SPA (Bun/Vite) traditionally requires manually rewriting dozens of Next.js imports and routing mechanisms.

`@aphrody/m3-next-migrate` automates this transition end-to-end:

1. **AST & Import Codemod**:
   - Strips `"use client"` and adapts `"use server"` boundaries.
   - Rewrites `next/navigation` hooks (`useRouter`, `usePathname`, `useSearchParams`, `useParams`, `redirect`, `notFound`).
   - Rewrites `next/link` with automatic desktop shell delegation (external links open in OS browser via `@tauri-apps/plugin-shell`, internal links route via client router).
   - Rewrites `next/image` with responsive `<img>` and `fill` mode support.
   - Rewrites `next/font/google` and `next/font/local` to standard CSS variables and fonts.
   - Rewrites `next/dynamic` to `React.lazy` + `Suspense`.
   - Normalizes Next 16 async page props (`await params` -> `params`).
   - Rewrites `process.env.NEXT_PUBLIC_*` to `import.meta.env.*`.

2. **Production-Ready Runtime Shims**:
   - `@aphrody/m3-next-migrate/shims/navigation`
   - `@aphrody/m3-next-migrate/shims/link`
   - `@aphrody/m3-next-migrate/shims/image`
   - `@aphrody/m3-next-migrate/shims/font`
   - `@aphrody/m3-next-migrate/shims/dynamic`
   - `@aphrody/m3-next-migrate/shims/headers`
   - `@aphrody/m3-next-migrate/shims/form`
   - `@aphrody/m3-next-migrate/shims/tauri-ipc`
   - `@aphrody/m3-next-migrate/shims/provider` (`<NextMigrateProvider>`)

3. **Complete Scaffolding**:
   - Generates `tauri.conf.json`, `Cargo.toml`, `vite.config.ts`, `index.html`, and `main.tsx`.

---

## CLI Usage

```bash
# Scan a Next.js 16 codebase and audit used features
bun run next-migrate ./my-next-app --scan-only

# Migrate an entire Next.js 16 project to Tauri v2
bun run next-migrate ./my-next-app ./desktop-app --target tauri

# Migrate to a Bun / Vite web SPA
bun run next-migrate ./my-next-app ./web-app --target vite

# Migrate a single component file
bun run next-migrate ./components/Hero.tsx ./dist/Hero.tsx
```

---

## Programmatic API

```typescript
import {
  transformComponent,
  scanNextDirectory,
  migrateProject,
} from "@aphrody/m3-next-migrate";

// Transform component code
const result = transformComponent(nextSourceCode, {
  target: "tauri",
  rewriteEnv: true,
  stripDirectives: true,
});

// Full project migration
const report = await migrateProject({
  sourceDir: "./next-site",
  targetDir: "./tauri-desktop",
  target: "tauri",
  projectName: "my-desktop-app",
  scaffold: true,
});
```

---

## Testing & Verification

```bash
bun test packages/m3-next-migrate
bun run --filter @aphrody/m3-next-migrate typecheck
bun run --filter @aphrody/m3-next-migrate build
```
