# Aphrody M3 framework

`aphrody-m3` is the Material 3 stack for Bun: tokens, theme sheets, web components, React, Base UI,
Tailwind v4, build tooling and OS theme installers. Yolo orchestrates build, serve and compile.

## Package map

| Layer | Package | Role |
| --- | --- | --- |
| Tokens | `@aphrody/m3-tokens` | `--md-sys-*` tokens, Material You roles from a seed, window classes (width and height), emphasized type, Expressive springs, directional shapes |
| Theme | `@aphrody/m3-theme` | Fusion sheets: M3 + shadcn + Tailwind aliases, SpaceUI schemes, React/Tauri providers |
| Front | `@aphrody/m3-front` | Framework-agnostic: `<m3-theme>`, lazy `material-web` registration, window-class observer |
| React | `@aphrody/m3-react` | `@lit/react` wrappers for every `md-*` element, adaptive hooks, transitions, form state |
| Base UI | `@aphrody/m3-baseui` | Base UI parts (fork in `forks/base-ui`) styled with M3 tokens |
| Tailwind | `@aphrody/m3-tailwind` | Tailwind v4 CSS-first `@theme` generated from the tokens (`preset.css`) |
| Framework | `@aphrody/m3` | `m3` CLI, Bun plugin, `serveM3`, `buildM3`, `M3App`, `m3.config.ts`, App Router (`@aphrody/m3/app`) |
| Bun application | `@aphrody/m3-bun` | Build, serve, compile, package and deployment configuration for an app's UI and API |
| Shared | `m3-config`, `m3-fonts`, `m3-icons`, `m3-motion`, `m3-primitives`, `m3-forms`, `m3-ai`, `m3-explorer`, `m3-design`, `m3-next`, `m3-next-migrate`, `m3-codemods`, `m3-reader`, `m3-mcp`, `material-design-icons`, `scaffold` | Build presets, assets, behaviour, migrations, MCP |
| OS | `@aphrody/m3-os-themes` | Windows 11, GNOME, COSMIC and Chromium theme generators and installers |

Forks (`forks/`): `tailwindcss`, `base-ui`, `material-web`, `material-color-utilities`, `material-design-icons`.
Shared dependency versions live in the root `workspaces.catalog`; the lockfile pins their resolved versions.
Packages use `catalog:`, `workspace:*` and explicit dependencies where declared.

## Yolo orchestration

Root scripts run [scripts/yolo.ts](../../scripts/yolo.ts), which runs the Bun CLI `bun run $YOLO_ROOT/packages/engine/yolo/src/index.ts` on every platform.
`YOLO_ROOT` defaults to `$HOME/yolo`; inspect this entry point's live help for Yolo commands.
The wrapper sets `YOLO_HOME` to this repository for its Yolo preflight. The former `apps/showcase` was removed; the App Router example app `apps/example` replaces it.

| Script | Runs |
| --- | --- |
| `bun run build` | Yolo preflight, then `scripts/build.ts build`: every package and app, cached |
| `bun run test` | Yolo preflight (`yolo version --json`), the root script suites, then workspace `test` scripts in parallel, followed by export, asset and documentation link checks |
| `bun run lint` | Yolo preflight, then `oxlint` over `packages/m3*`, apps and scripts |
| `bun run typecheck` | Yolo preflight, then `scripts/build.ts typecheck` with its default scope and cache |
| `bun run bench` / `bun run bench:check` | Benchmark harness / performance budgets; see the limitations below |
| `bun run install:theme -- <args>` | the `m3-os-themes` CLI (dry-run unless `--apply`) |

The pipeline's default scope is package names matching `@*/m3*` and workspace members under `apps/`.
Package builds with a `build.config.ts` use the shared `Bun.build` preset, followed by declaration emission
when `tsconfig.build.json` exists. Members without a build config are reported as skipped; direct package
scripts may use a different build path. App builds run their declared `build` script after packages.
The root build's `--no-apps` prevents this final app stage.

Typechecking opts in through each member's `typecheck` script, but the pipeline currently executes
`tsc -p tsconfig.json --noEmit` rather than that script. Alternate configs or multi-command scripts are
therefore not included by this gate. Non-M3 members such as `scaffold`, `canvas`, assets, identity,
AG-UI and material-design-icons are outside the default pipeline and `packages/m3*` lint scope.
Use their declared scripts for their additional checks. To run an uncached pipeline check or select
a member explicitly, call `bun scripts/build.ts typecheck --no-cache --only <name>` directly;
the root task wrapper currently forwards extra arguments only for benchmarks and theme installation.

Workspace tests run the `test` script of every `packages/*` member (path filter `./packages/*`); the
enclosing Aphrody manifest declares `m3/packages/*` only, so there is no `apps/*` or `packages/m3-next/examples/*`
workspace member. The independent `packages/nie-ui` repository is excluded and keeps its own installation and gates. `app-ui` builds Rust and belongs to the integrator using the enclosing
Aphrody repository's `scripts/build/rust/cargo-serial.sh`.

## App Router (`@aphrody/m3/app`)

A project with an `app/` (or `src/app/`) directory, or `app` in `m3.config.ts`, runs the App Router:
`m3 dev`, `m3 build [--no-prerender]` and `m3 start`. No Node and no Vite: `Bun.build` produces three layers
(`rsc` with the `react-server` condition, `ssr`, `client`) and `Bun.serve` hosts them. React Server Components
use `react-server-dom-parcel` (public React 19 builds).

| Next.js convention | m3 |
| --- | --- |
| `page`, `layout`, `template`, `loading`, `error`, `not-found`, route groups, `[param]`, `[...all]`, `[[...opt]]` | supported |
| `route.ts` handlers (GET/POST/…, HEAD from GET, OPTIONS, 405) | supported |
| `proxy.ts` / `middleware.ts` with `config.matcher`, `NextResponse.next/rewrite/redirect` | supported |
| Server Components, `"use client"`, `"use server"` actions (fetch and progressive `<form>`), `useActionState` | supported |
| `metadata` / `generateMetadata` / `viewport`, `robots`, `sitemap`, `manifest`, static icons | supported |
| `generateStaticParams`, static generation at build, dynamic detection (`headers()`, `cookies()`, `searchParams`) | supported |
| `next/link`, `next/navigation`, `next/headers`, `next/server`, `next/cache`, `next/image` | aliased to `@aphrody/m3/app/*` |
| ISR, `next/font`, image optimisation, parallel/intercepting routes, PPR | not yet |

`packages/m3/test/app/{scan,plugin,router}.test.ts` exercise, on `test/fixtures/app-router`: the build manifest and
the three layers, prerendering (`generateStaticParams`, dynamic detection), SSR HTML with metadata and the inline RSC
payload, RSC requests, `notFound()`, `headers()`/`cookies()`, route handlers and 405, middleware redirect and
matcher, trailing-slash redirect, server actions called with an encoded reply (return value, `redirect()`), robots,
public files, hashed assets, HEAD and the `rewriter` option of `loadApp`. The fixture has no `template`, `error`,
route group, `sitemap`, `manifest` or icon file; progressive `<form>` posts, `useActionState` and the
incremental flushing of streamed SSR behind `loading` boundaries are implemented but not asserted by these tests.

Development rebuilds into `.m3/dev/<n>` on change and refreshes the RSC payload over `/_m3/hmr` (state kept for
client components). The Bake dev server of the Bun fork is not used yet: its `"use server"` support and production
output (SSG only) are core gaps tracked in the Bun fork plan, section S.

### Routing choice

| Application | Router | Data |
| --- | --- | --- |
| Server-rendered web (SEO, RSC, actions) | m3 App Router (`app/`) | Server Components; TanStack Query for client caches |
| SPA, Tauri desktop/mobile, offline | TanStack Router (file or code routes, `Bun.build`) | TanStack Query |
| Tables and long lists | M3 `DataTable` / `VirtualList` on TanStack Table / Virtual | — |

TanStack Start is not used: its build requires Vite. Forms keep `m3-forms` unless a measurement shows TanStack
Form is smaller or faster for the same API.

## Benchmark qualification limits

The [performance report](../reports/PERF.md) records dated measurements; rerun a corrected harness
before making current performance claims. As observed on 2026-10-04, `scripts/bench/run.ts` started Yolo with `bun $YOLO_ROOT/bin/yolo`, a Bash
script, which failed with a syntax error. It now runs the Bun entry (`YOLO_CLI` of `scripts/yolo.ts`).
The harness records timings without rejecting these nonzero exits, so a budget comparison alone
does not qualify the Yolo measurements. Its stored test/lint/typecheck exit strings and snapshot
errors also do not necessarily cause the ordinary benchmark command to fail. Performance budgets
are separate from the technical gates listed above.

## Theme install per OS

```sh
bun packages/m3-os-themes/src/cli.ts generate --target all --seed '#6750a4' --out out   # files only
bun packages/m3-os-themes/src/cli.ts install  --target gnome --seed '#6750a4' --mode dark           # plan only
bun packages/m3-os-themes/src/cli.ts install  --target gnome --seed '#6750a4' --mode dark --apply   # applies
bun packages/m3-os-themes/src/cli.ts uninstall --target gnome --apply                                # restores
```

- **Windows 11**: `install-windows.ps1` writes `Themes\Personalize` (`AppsUseLightTheme`, `SystemUsesLightTheme`,
  `ColorPrevalence`), DWM (`AccentColor`, `ColorizationColor`) and `Explorer\Accent`, generates a wallpaper and loads
  the `.theme`. The first run snapshots the previous values (`%LOCALAPPDATA%\m3-os-themes`); `-Uninstall` restores them.
- **GNOME Shell**: `~/.local/share/themes/M3-<name>/{gnome-shell,gtk-3.0,gtk-4.0}`, `~/.config/gtk-4.0/gtk.css` for
  libadwaita, gsettings (`gtk-theme`, `color-scheme`, `accent-color`, User Themes `name`). Snapshot and `--uninstall`.
- **COSMIC**: cosmic-theme ThemeBuilder RON keys under `~/.config/cosmic/com.system76.CosmicTheme.{Dark,Light}.Builder/v1/`
  and an importable `M3-<name>-<mode>.ron`. Snapshot and `--uninstall`.
- **Chromium browsers**: a Manifest V3 theme per mode (load unpacked) and the `BrowserThemeColor` managed policy for Chrome,
  Chromium, Brave and Edge (Linux `/etc/*/policies/managed`, Windows `.reg`). `install-chromium.md` has the steps.

`--mode auto` leaves the OS light/dark preference alone and ships both variants. Tests generate in memory or in a
temporary directory; nothing in the repository applies a theme to the machine that runs it.
