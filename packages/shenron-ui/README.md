# Portable Dragon Ball interface package

`@shenron/ui` contains the visual layer used by the Shenron site. Its runtime
source imports neither Shenron application code nor Next.js. React is a peer;
`@base-ui/react`, React Query, and the small styling helpers are ordinary
dependencies. A host supplies routes, authorization, content, translations,
data fetching, and optimized image rendering.

## Entry points

- `@shenron/ui/server`: server-safe SVG, page layout, navigation frames,
  skeletons, and read-only admin presentation.
- `@shenron/ui/client`: interactive controls and the optional React Query
  provider. It includes the full Base UI wrapper set, public filters, the mega
  menu, and the admin sidebar view. Import this entry only from a client boundary.
- `@shenron/ui/public` and `@shenron/ui/admin`: public and admin presentation.
- `@shenron/ui/toriyama`, `@shenron/ui/svg`, `@shenron/ui/cinematic`: themed
  components and the pure SVG geometry helpers.
- `@shenron/ui/styles.css`, `@shenron/ui/site.css`, and
  `@shenron/ui/toriyama.css`: Tailwind v4 tokens, the site visual layer, and
  Toriyama effects. `styles.css` registers the package sources with Tailwind
  when installed under `node_modules`.
- `@shenron/ui/barre-nav.css`, `@shenron/ui/editor.css`, and
  `@shenron/ui/editorial.css`: optional navigation and editorial surfaces.
- `@shenron/ui/assets`: paths to the 24 bundled interface SVG, PNG, and ICO
  assets. Content images and fonts belong to the host.
- `@shenron/ui/reader`: manga, collection, and databook readers. The reader
  styles are `@shenron/ui/reader-styles.css` and
  `@shenron/ui/reader-dragon-ball.css`.

The package provides ordinary `<a>` and `<img>` defaults. A framework host can
pass its own link component to `TabNav`, `NavMega`, `AdminSidebarView`, `Chip`,
`EmptyState`, and `StatTiles`, and an image renderer to `PageHero`. The Shenron site does this through small
adapters in `apps/shenron/site/src/components`.

`JsonLd`, `Markdown`, and `VideoSourceSummary` are server-safe presentation
helpers. `ApiAccess` is client-side because it uses the browser clipboard; it
receives paths and labels as props and makes no API request itself.

To copy the assets to a host public directory, run:

```sh
bun node_modules/@shenron/ui/scripts/sync-assets.ts --to ./public
```

Use `--check` to verify an existing copy. The script never removes other files.

The host can load the visual layer from one package:

```css
@import "tailwindcss";
@import "@shenron/ui/styles.css";
@import "@shenron/ui/site.css";
@import "@shenron/ui/toriyama.css";
```

Import `barre-nav.css`, `editor.css`, or `editorial.css` only for the surfaces
that use them. The package scans its own source for Tailwind classes.

Tailwind v4 excludes `node_modules` during automatic source detection, so
`styles.css` deliberately declares `@source "."`; do not replace it with a
global safelist. Build class names as complete strings. CSS modules can use
`@reference "@shenron/ui/styles.css"` when they need tokens without emitting a
second copy of the stylesheet. See the [Tailwind source-detection guide](https://tailwindcss.com/docs/detecting-classes-in-source-files).

The Base UI wrappers use its v1 data attributes and provide visible keyboard
focus styles. When composing them, forward both the `ref` and props and use
Base UI's `render` API. See [Base UI accessibility](https://base-ui.com/react/overview/accessibility).

## Application boundary

| In this package                                                                                                 | Supplied by the host                                                    |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Base UI controls, Toriyama vectors, geometry, layouts, content cards, pagers, navigation and admin presentation | Route matching, launch catalogue, translations, auth and editorial data |
| Reader components, scoped stylesheets and 24 generated or vector interface assets                               | Fonts and content media                                                 |
| Default HTML links and images                                                                                   | Optional router links and optimized image renderer                      |

`apps/shenron/site` keeps the thin Next adapters and its domain screens. The server
entry renders React views; it does not provide an HTTP server or Shenron APIs.

## Checks

From the Aphrody workspace root:

```sh
bun --filter @shenron/ui type-check
bun --filter @shenron/ui test
bun --filter @shenron/ui portability:check
bun m3/packages/shenron-ui/scripts/sync-assets.ts --to apps/shenron/site/public --check
bun m3/packages/shenron-ui/scripts/check-css-equivalence.ts
bun run --cwd m3 check
```

The tarball has also been installed in a separate Bun project and checked with
server rendering, client imports, asset reads, and Tailwind compilation. This is
a source package for Bun and Tailwind v4 consumers. No registry release
or deployment is implied by the repository checks. The host supplies fonts and content media.

Readers and their styles have one owner: `@aphrody/m3-reader`. The existing
`@shenron/ui/reader`, `reader-styles.css` and `reader-dragon-ball.css` exports
delegate to that package. The Dragon Ball skin retains the live `--dbz-*`
variables; route adapters, transcription fetching and editorial rules stay
in the site. `@shenron/ui/use-focus-trap` shares the M3 modal lifecycle.
The reader stylesheet registers its own Tailwind sources, including isolated installs.

## Production build check

```sh
bun --filter @shenron/ui build:check
```

This builds the five public TypeScript entry points in memory with Bun's browser
target, ESM output, dependency externals, tree-shaking, full minification, a
closed dynamic-import policy, and environment injection disabled. It also
compiles all nine stylesheets through the Tailwind v4 PostCSS plugin with
minification, then reports byte counts. No `dist` is written: this package ships
source so each host can tree-shake exactly the entry points it consumes. Bun's
bundler options are documented at [bun.com/docs/bundler](https://bun.com/docs/bundler).
