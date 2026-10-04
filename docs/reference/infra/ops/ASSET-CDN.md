<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shared asset CDN — `cdn.aphrody.com`

> **Retired on vps since 2026-09-25.** `/srv/aphrody-cdn` and the `cdn.aphrody.com` vhost were
> removed with the Aphrody retirement (`config/asset-catalog.json` `status: retired`,
> `yolo/config/host/inventory/vps-source.json`). This page stays the redeploy runbook; the all-in-one bundle does
> not carry the CDN.

`cdn.aphrody.com` is the CDN origin of the monorepo's UI design assets and AI
brand assets, and nothing else. Game assets are not served here: nie publishes decoded assets on its single
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
| `os` | `aphrody/assets/ui` | Material 3 design references and UI captures (scope name kept so `/s/os/` URLs stay stable) |
| `os` | `aphrody/assets/fonts`, mounted at `fonts/` | Google Sans fonts and OFL notices; `/s/os/fonts/` stays stable |
| `aphrody` | `aphrody/assets/ai` | agent brand (Byron), product captures and renders |

## Rules

- One owner per file content. A copy of the same bytes in another catalogued source fails
  `cdn:check`; reference the owner's CDN URL or its path in this monorepo instead
  of copying it. The UI, web and system layers do not publish the AI brand source.
- Only tracked files are served (`git ls-files`), PSD sources excluded.
- Code uses `https://cdn.aphrody.com/h/...` for long-lived references (read the hash from
  `/s/manifest.json`) and `/s/...` for URLs that should follow the latest release.

## Operate

```sh
bun scripts/assets/cdn.ts check                    # sources present, no cross-source duplicate
bun scripts/assets/cdn.ts build                    # var/cdn/release: s/, h/, s/manifest.json, RELEASE_SHA
bun scripts/assets/cdn.ts publish --vps <ssh-host> [--dry-run]
```

`publish` rsyncs the release to `/srv/aphrody-cdn/releases/<RELEASE_SHA>` and switches
`/srv/aphrody-cdn/current` atomically; the previous release stays for rollback (switch the link
back). The vhost is `iecode/config/nie/host/nginx/aphrody-nie-cdn.conf`, installed with
`yolo/config/host/nginx/aphrody/aphrody-cdn-static.inc` in `/etc/nginx/conf.d/`, then
`nginx -t && systemctl reload nginx` (first publish and install: 2026-09-23, release
`122a3f0c217c`, 92 files).

The monorepo catalog check on 2026-10-02 found 90 tracked files and no source
or content ownership errors. The earlier 92-file release was built before the
monorepo import; its content has not been compared file by file to this catalog.
That comparison is required before redeploying the retired CDN.

The vhost keeps its request limits (`nie_assets`: 10 r/s, burst 20) for every path, static
namespaces included.
