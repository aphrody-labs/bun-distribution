<!-- SPDX-License-Identifier: Apache-2.0 -->
# Canonical public app-ui artifact

The existing downloads/site server accepts an optional `APP_UI_ROOT` pointing to a separately
published complete canonical frontend artifact. With no setting, the static Bun-fork site keeps
its existing behavior. An incomplete configured artifact fails startup instead of silently
publishing a partial UI.

Build from the selected Aphrody checkout with an explicit isolated output directory:

```sh
bun m3/packages/app-ui/build.ts --out <artifact-directory>
```

The artifact contains `index.html`, `public-home.html`, `app.js`, `app.css` and `fonts/`.
It also exports `public-docs.json` byte-for-byte from the product-owned documentation catalogue
and five semantic HTML articles under `public-docs/`, rendered by native `Bun.markdown.html`.
On configured site hosts, `/api/docs` is read-only and returns that exact five-article shape.
The five stable `/docs/<id>` product URLs are served only when no existing static site page
matches. Existing Bun pages always take precedence; unknown article paths remain 404.
Product article pages contain headings, descriptions, canonical URLs and source links without
requiring client JavaScript or redirecting to an unrelated SPA route.
`public-home.html` prerenders the real canonical homepage component, including resource links,
a description and canonical URL, so public content is readable without JavaScript. Client
initialization mounts the same shared application rather than a separate homepage implementation.

On declared site hosts, the server serves the homepage at `/` and the actual shared browser OS
route at `/os`, with frontend assets isolated under `/_app-ui/`. A rewritten base URL resolves
relative fonts, Material Symbols, images and the pet atlas against this namespace. Absolute
navigation links retain their normal public destinations. All other existing static routes,
including Bun documentation, runtime pages, installers and downloads, retain their source tree.

This read-only server exposes no native RPC. The artifact receives an explicit unavailable
backend marker; the public homepage explains that native search requires the installed
application and reports that limitation if submitted. `/os` opens the shared UI, not a claim of
local hardware access, WASM execution, native activation or performance. Native capabilities
still require the qualified authenticated app-server/desktop boundary.

Host application remains a separate Infra plan/apply step: publish a checksum-verified artifact,
retain the previous artifact for rollback, set `APP_UI_ROOT` through the declared deployment
configuration, and verify `/`, `/os`, namespaced assets, preserved docs/downloads and RPC refusal.

## Additive deployment declaration

The deployment catalog in `tools/config/downloads.json` can publish an explicit declaration at
`<dirname DOWNLOADS_ROOT>/app-ui/deployment.json`, without changing the existing compose or
ingress configuration:

```json
{"schemaVersion":1,"root":"current"}
```

The only accepted root pointer is `current` inside that app-ui directory. It may resolve to a
retained release below the same directory. Unknown properties, authentication/proxy settings,
invalid JSON, oversized declarations and symlinks escaping the declared directory fail closed.
The directory itself must remain inside the downloads deployment base. No declaration means
no activation; a discovered build directory alone does not opt in. `APP_UI_ROOT` remains the
explicit environment override and takes precedence over the declaration.

Publish and checksum-verify `<base>/app-ui/releases/<id>`, point `current` to that release, then
publish the declaration and restart the existing declared downloads service through Infra.
Retain the previous release and declaration for rollback. Neither mechanism exposes an RPC
proxy or changes provider authentication.
