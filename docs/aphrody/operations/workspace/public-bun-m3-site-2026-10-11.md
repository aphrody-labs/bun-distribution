<!-- SPDX-License-Identifier: Apache-2.0 -->
# Public Bun M3 site migration

The authorized migration keeps the canonical Aphrody M3 app-ui, its public documentation,
templates and assets. Bun owns HTTP through the fork's `@aphrody/bun-m3` adapter and public
site composition. `@aphrody/bun-google/search` delegates bounded anonymous search to the
existing native Google capability owner. This does not embed Chromium or replace Google's
private backend.

## Observed production route

On 2026-10-11, VPS nginx terminates TLS for `aphrody.com` and forwards to
`10.200.77.3:18803`. That address belongs to DBFR. The existing
`aphrody-aphrody-site-1` container serves port 3000 through that private binding.
The older VPS native site on 8083 is not the current public origin.

The catalog is `tools/config/host/apps/dbfr/aphrody-site/compose.yaml`. The migration
retains its pinned Ubuntu image, non-root user, read-only filesystem, dropped capabilities,
resource limits and private ingress. It mounts only public artifacts and the existing
native executable. No operator home, browser profile, cookies, keys or Docker socket enters
the public container.

## Build and qualification

From `C:\bun`, run the owner build-then-execute gate:

```powershell
bun bd -j2 test ./packages/bun-m3/test/site.test.ts ./packages/bun-m3/test/catalog.test.ts ./packages/bun-m3/test/native-renderer.test.ts ./scripts/aphrody/site/aphrody.test.ts
$env:APHRODY_SITE_CONSUMER_ROOT = 'C:\aphrody'
$env:APHRODY_SITE_UI_ARTIFACT = 'C:\aphrody\var\site-build\bun-main-20261011'
$env:APHRODY_SITE_OUTPUT = 'C:\bun\build\site-aphrody-main'
$env:APHRODY_SITE_CHROME_ARTIFACT = 'C:\bun\build\chrome-app'
bun bd -j2 scripts/aphrody/site/build-aphrody.ts
```

The build bundles the existing Workspace download/site owner into `catalog.mjs` and the
fork's entry into `server.mjs`; it does not copy or fork the M3 framework source. Package
the explicitly qualified canonical public app-ui artifact as `app-ui` next to those files
and the scoped `google-public-theme.css`. Record hashes and source revisions before transfer.

The theme keeps Aphrody branding and applies a white search surface, familiar search field,
accessible focus states and system link color. It uses existing M3 type/shape tokens and
the already shipped Material Symbols font; it is not an official Google product/theme.

## Plan, stage and activate

1. Resolve the live Infra catalogs and authenticated target. The installed Windows deployment
   command currently reports a missing legacy `C:\Users\aphro\aphrody` manifest even with
   `--root C:\aphrody`; that failed command applies nothing.
2. Use native Infra SSH/sync to inspect DBFR and transfer the public, hash-bound release.
   Render the catalog with existing Docker Compose before applying it.
3. Start an isolated candidate using the same image, mounts and security policy, with its
   ingress bound only to `127.0.0.1:18804`. Verify health, routes, font MIME, theme, real
   anonymous search and desktop/mobile browser behavior.
4. Back up the exact active service configuration and its checksum. Activate only the site
   service through its existing Compose project; preserve unrelated services.
5. Verify the public TLS URL, health, real search response, frontend behavior and runtime
   provenance. On any mandatory gate failure, restore the saved configuration and recreate
   only this service. Keep the previous release.

Never treat the candidate as deployed or an injected fixture as a working Google backend.
Only report activation after collecting the public checks.

## External search boundary

Live anonymous Google searches failed on both servers: VPS fetch returned a blocked/empty
response, and DBFR HTTP returned a Google anti-bot interstitial. The current public search
therefore returns a real upstream-unavailable response. The adapter preserves bounded
queries, SafeSearch, cancellation, capacity limits and honest failures.

[Google's current Custom Search API documentation](https://developers.google.com/custom-search/v1/overview)
requires an existing eligible account, API key and configured engine. It is closed to new
customers and lists a January 1, 2027 transition deadline. A complete Google web-search
service requires a qualified provider contract; deploying a UI does not create one.
Drive, Docs, Gemini and other privileged services require explicit credentials and per-user
authorization. They are not anonymously exposed by this migration.

## Delivery evidence

Source, changed-binary tests, rendered candidate and production activation have separate
gates. Append the actual release hashes, runtime revisions and browser observations here
after those gates complete. Chromium compilation, profile imports and Omar's SSH recovery
retain their own receipts and qualification boundaries.

### Qualified source and private candidate, 2026-10-11

The canonical Windows UI build completed with 640 public files, 30,589,587 bytes.
Its documentation came from the source-bound Bun transfer receipt, and its template
catalog came from the actual native `aphrody site catalog templates` command. Known
template slugs and `/terminal` now serve the real client router shell; unknown template
IDs remain 404. The M3 CSS endpoint delegates to a fixed internal Rust renderer using
the existing qualified artifact, not a duplicated palette implementation. This renderer
is a retained legacy native dependency; current-main FFI parity is not established.

The changed Windows Bun gate passed 14 tests and 110 assertions across the four files
above. The public source batch is Bun commit `0e41df6a0d09e530eefa62f6e3284f62799c9714`.
The candidate remains the separate `aphrody-bun-m3-qualification` Compose project,
bound to DBFR loopback port 18804. Its final `server.mjs` SHA256 is
`35f161a3f48c8cd85e31d56a780738708d043da2b4d930f7ac3bbceb92879d26`.
The candidate and production service use the independently qualified Linux Bun 1.4.4
artifact, SHA256 `890af6a675e1dc58b15a15777c53de3b2e82668690c9be5f6e87ec690246ac0e`.
It is installed as a separate protected executable; the earlier runtime remains intact.

The actual installed Chrome 154 browser qualified twenty page navigations across
desktop and mobile, all HTTP 200 and without uncaught exceptions. Four additional
records verify real Roboto Flex platform fonts, HTTPS service-worker registration,
the browser manifest and actual decoded 192/512-pixel icons. These are frontend/PWA
gates, not proof of desktop-only RPC, model inference or Google authorization.
Candidate receipt SHA256: `7af0dfc573a6fce5ac3c3dda63fe44b391ce29e1c135327d4dc7d2347fb0f14a`.
The disposable TLS certificate and resolver rule only reproduce the canonical origin
inside a synthetic browser. Windows hosts, trust stores and R2 CORS were preserved.

Chrome's default search URL `/?q=...` now delegates to the actual public search API,
escapes projected results and displays the real 502 failure when Google blocks the
anonymous native owner. The PWA never caches account, API or search responses.
The existing Google Cloud web-client credentials were staged only in protected
owner storage. Google's actual authorization response rejects the new callback
`https://aphrody.com/auth/google/callback` with `redirect_uri_mismatch`; no successful
sign-in, Gmail grant or mailbox migration is claimed. Public authentication stays
unconfigured until that external client contract is corrected.

DBFR's protected Chromium archive import has a separate disk-reserve gate. Public
site/runtime deployment must preserve its remaining capacity and the rollback release.
Production activation completed through the existing `aphrody` Compose project after
candidate qualification and configuration checksum checks. Only `aphrody-site` and
the internal `m3-renderer` were selected. The original configuration and release are
retained for rollback. Active configuration SHA256:
`89bebfdf9f9cc28e26470f6ae670b3495c24d4fdd3e5338771b89ef3168a5d23`.
The actual running container reports Bun 1.4.4 and healthy status; `/health` returns 204.
Public pages, manifest and service worker return 200 over normal verified TLS.
An independent Chrome 154 run against the public URL qualified all twenty desktop/mobile
page navigations and four font/PWA observations, with no uncaught exceptions. This
public run used normal DNS and certificate validation, without a resolver or TLS override.
Public browser receipt SHA256:
`99a80451b487e3926d105b2ea13e403d1184c057d6316797d05b7a752f566a76`.
Google login and callback still return the explicit unconfigured 503 response. No Google
grant, complete mailbox migration or anonymous privileged backend is claimed.
DBFR retained 10,588,807,168 bytes free after the separate private Chromium import.
