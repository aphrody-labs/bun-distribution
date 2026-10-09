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

## Public R2 assets

`tools/config/public-assets.json` declares the temporary public R2 base and owned object paths.
Use the opt-in build flag to connect the public artifact:

```sh
bun m3/packages/app-ui/build.ts --public-assets --out <artifact-directory>
```

The public build maps WOFF2 faces to `m3/fonts/<name>.woff2`, emits `fonts.css` from the existing
font owner, and uses `pet/spritesheet.webp` for the public homepage. It exports a small
`public-assets.json` artifact manifest. The read-only server accepts only the declared exact R2
origin and emits `aphrody-assets-base` metadata; its image, font and connect CSP directives
admit that origin without a wildcard. The native build remains local by default.

The identity owner provides validated public atlas, `pet/symbols/<relative>` and Material
Symbols index URL helpers. `<aphrody-pet>` can resolve the public atlas from page metadata when
no explicit `src` is supplied; an explicit source retains precedence.

Native HTTPS HEAD probes on 2026-10-09 returned 200 for the atlas, one pet SVG, one WOFF2 face
and the Material Symbols index. With request Origin `https://aphrody.com`, each response carried
`Access-Control-Allow-Origin: https://aphrody.com`. These are live HTTP header observations,
not browser CORS/rendering qualification or proof of every object. No object publication,
credential transfer or Cloudflare custom-domain activation is performed by this build.

The complete consumer check extracted 32 distinct absolute WOFF2 URLs from the final public
`app.css` and `fonts.css`. Bounded concurrency four HEAD requests verified all 32 returned 200,
`font/woff2` and the expected Aphrody CORS origin. The optional outlined/rounded/sharp glyph-font
objects returned 404 on R2, so the public build declares the used outlined glyph font as a
same-origin fallback and does not publish references to the missing optional variants.
The Material Symbols index describes 3,860 glyph names and hexadecimal codepoints, not SVG
URLs; four glyph entries passed schema checks. Four existing pet SVGs returned 200.

Public-only packaging removes a copied WOFF2 only when every emitted reference to that
filename is qualified remote and none remains local. The measured artifact removed 25 copied
files, 6,278,496 bytes, while retaining its local outlined glyph font, image assets and metadata.
`--public-assets` requires an isolated `--out`; native/default builds are unchanged. Publishing
the missing glyph-font objects and removing their fallback requires a fresh measured owner batch.

## Durable release helper

`bun scripts/release/publish-app-ui.ts` prints the catalog-derived host plan and performs no
build, transfer or host mutation. To produce a private isolated artifact and checksum manifest:

```sh
bun scripts/release/publish-app-ui.ts --build --revision <exact-40-character-HEAD>
```

Use `--out <absolute-directory-outside-checkout>` to retain a chosen build location. Publication
accepts either `--build --apply` or an existing `--artifact <directory> --apply` with its exact
`release-manifest.json`. Both require a clean source batch and current HEAD; the manifest binds
the revision to every regular artifact file and rejects symlinks and incomplete builds.

Add `--public-assets` to build the qualified public R2 asset variant. The flag is forwarded
to the canonical app-ui build, requires its exported `public-assets.json`, and is recorded in
the release manifest. Pass the same flag when publishing an existing artifact; mismatched
build modes, revision or file checksums fail before upload. Source guards include the entire
M3 tree (font and identity transforms), the public asset catalog and this release helper.
Fresh checkouts also run the identity owner's explicit `sprite` command before bundling:
it derives the ignored `m3/packages/identity/dist/spritesheet.webp` from the tracked
`crates/ui/identity/assets/aphrody/sprites/spritesheet.webp`. No installation lifecycle or
machine setup hooks are required. Source guards include that Rust identity owner input.
The helper also builds exactly the imported Tauri JavaScript packages (`@aphrody/api` and
`@aphrody/plugin-dialog`) with their manifest `build` commands. It synchronizes fonts through
`m3/scripts/fonts-sync.ts` and runs its check-only pass: the existing font lock pins Google
font commits and file SHA256/size, and Material Symbols tarball SHA512 plus extracted file
SHA256/size. Missing generated package outputs are recreated from their tracked sources;
no output from another checkout is copied. Tauri source and builder inputs are guarded too.

```sh
bun scripts/release/publish-app-ui.ts --build --public-assets --revision <exact-HEAD> --out <isolated-directory>
bun scripts/release/publish-app-ui.ts --apply --public-assets --artifact <isolated-directory> --revision <exact-HEAD> --expected-server-sha <reviewed-sha256> --scp-fallback
```

Inspect the remote server checksum through `aphrody infra ssh exec` before applying, then pass
`--expected-server-sha <reviewed-64-character-sha256>`. The helper refuses source drift, uploads
through native SFTP, verifies the archive and all artifact files remotely, and verifies the
backed-up server before replacing it. It retains immutable releases and previous pointer,
declaration and server below `app-ui/backups/<release-id>`; it atomically replaces `current`
and `deployment.json`, then recreates only the existing downloads compose service. Failures
during activation trigger restoration and recreation; the successful receipt prints a rollback
command for subsequent verification failures. Existing release IDs are never overwritten.

Before clearing the rollback trap, publication performs a bounded loopback health check and
fetches `/` and `/os` using the declared public host. Both pages must advertise the explicit
unavailable native RPC marker. Declaration backups retain a checksum checked immediately
after copying and again before rollback; cookies are absent from these probes.

Native SFTP currently times out for some large archives. `--scp-fallback` explicitly allows
installed native OpenSSH for that demonstrated coverage gap, only after SFTP fails; the helper
validates the declared host alias and passes the resolved SSH executable to SCP with `-S`.
Small source transfers still use native SFTP. No keys or authentication are copied.

After activation, verify `/`, `/os`, `/_app-ui/app.js`, preserved Bun docs and downloads, and
confirm `/rpc` remains unavailable. Source tests do not qualify a production rendering rate:
60 fps, physical desktop rendering and browser WASM execution require separate live evidence.

Public reloads serve the canonical shell only for explicit routes declared by
`router.tsx`, plus named Material pages from `material/pages/index.ts`. Existing
static documents and other static pages take precedence. Unknown routes and
unknown parameterized resource IDs remain 404; GET/HEAD are the only accepted
public methods. Public homepage and `/os` titles stay stable after hydration.
