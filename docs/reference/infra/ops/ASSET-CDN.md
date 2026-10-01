<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shared asset CDN — `cdn.aphrody.com`

> **Retired on vps since 2026-09-25.** `/srv/aphrody-cdn` and the `cdn.aphrody.com` vhost were
> removed with the Aphrody retirement (`config/asset-catalog.json` `status: retired`,
> `inventory/vps-source.json`). This page stays the redeploy runbook; the all-in-one bundle does
> not carry the CDN.

`cdn.aphrody.com` is the CDN origin of the Aphrody category repository assets (`aphrody-ui`
design assets, `aphrody-ai` brand assets), and nothing else. Game assets are not served here: nie publishes decoded assets on its single
host, `nie.aphrody.com/cdn/` (2026-09-23). The former `aphrody-assets.inc`, which aliased the
raw game install publicly, is removed.

| Path | Content | Cache |
| --- | --- | --- |
| `/s/<scope>/<path>` | stable URL of a repository asset | 1 h, stale-while-revalidate 1 d |
| `/h/<sha16>.<ext>` | content-addressed copy | immutable, 1 year |
| `/s/manifest.json` | every file: sha256, size, type, hashed URL | 60 s |

Scopes come from [`config/asset-catalog.json`](../../../../config/asset-catalog.json):

| Scope | Source | Owns |
| --- | --- | --- |
| `os` | `aphrody-ui/assets` | Material 3 design system: fonts, Google design references, UI captures (scope name kept from the former `aphrody-os/assets` so `/s/os/` URLs stay stable) |
| `aphrody` | `aphrody-ai/assets` | agent brand (Byron), product captures and renders |

## Rules

- One owner per file content. A copy of the same bytes in another catalogued source fails
  `cdn:check`; reference the owner's CDN URL, or its path through the `../<repo>` sibling
  checkout, instead of copying. `aphrody-ai` may read `aphrody-ui` files; the UI, web and system
  layers never read `aphrody-ai`. `aphrody-web/assets` still carries a byte-identical copy of
  the `os` scope from the category split; it is not a CDN source and should be replaced by
  references to `aphrody-ui`.
- Only tracked files are served (`git ls-files`), PSD sources excluded.
- Code uses `https://cdn.aphrody.com/h/...` for long-lived references (read the hash from
  `/s/manifest.json`) and `/s/...` for URLs that should follow the latest release.

## Operate

```sh
bun run cdn:check                                  # sources present, no cross-repo duplicate
bun run cdn:build                                  # var/cdn/release: s/, h/, s/manifest.json, RELEASE_SHA
bun scripts/assets/cdn.ts publish --vps <ssh-host> [--dry-run]
```

`publish` rsyncs the release to `/srv/aphrody-cdn/releases/<RELEASE_SHA>` and switches
`/srv/aphrody-cdn/current` atomically; the previous release stays for rollback (switch the link
back). The vhost is `nginx/aphrody/aphrody-nie-cdn.conf`, installed with
`nginx/aphrody/aphrody-cdn-static.inc` in `/etc/nginx/conf.d/`, then
`nginx -t && systemctl reload nginx` (first publish and install: 2026-09-23, release
`122a3f0c217c`, 92 files).

The vhost keeps its request limits (`nie_assets`: 10 r/s, burst 20) for every path, static
namespaces included.
