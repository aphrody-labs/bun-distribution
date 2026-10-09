<!-- SPDX-License-Identifier: Apache-2.0 -->

# creator.aphrody.com: creator-kit download and auto-update

Owner order of 2026-10-06: a minimal Material 3 page with one download button and automatic updates for
`packages/infra/product`. Static site, no application origin: nginx serves the `current` release tree.

| Path                           | Content                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                            | page (Aphrody M3 tokens, Google Sans Flex, MAKIT logo and favicons), built by `packages/infra/product/resources/creator/site/build.ts`                             |
| `/download/windows`            | current Windows pack (`.zip`, stable name, never cached)                                                                              |
| `/latest.json`                 | manifest read by the page and by `creator-kit self-update`: `version`, `artifacts[]` (`kind` pack or update, `url`, `sha256`, `size`) |
| `/SHA256SUMS`, `/files/<file>` | checksums and immutable versioned archives                                                                                            |

Public and unauthenticated by design (published, checksummed release files only; GET and HEAD only).

## Publish

```sh
bun run creator:publish plan
bun run creator:publish stage      # build locally, upload nothing
bun run creator:publish release    # build, scan, upload, sha256sum -c on the host, flip `current`
bun run creator:publish verify     # public download and SHA-256 of every artifact
bun run creator:publish host-apply --apply   # release root, certificate, vhost (first install or repair)
```

Bump `version` in `packages/infra/product/package.json` before a release: the updater installs a release only
when its version is newer. The exe is compiled with `bun build --compile --target=bun-windows-x64`; its icon and
version resources are set with the pinned rcedit (SHA-256 in the script) under Wine because `--windows-icon` only
works when compiling on Windows. `release` refuses a pack that holds a denied file name or a token-shaped string.

## Auto-update

The compiled exe checks `latest.json` at most every 12 h at start (4 s timeout, never blocking) and, when a newer
version exists, a detached `self-update --quiet` downloads the flat `update` archive, verifies SHA-256 and size,
extracts it next to the exe and swaps it in (the running exe is renamed to `.old`, removed at the next start). It
takes effect at the next launch. `CREATOR_KIT_NO_UPDATE=1` disables it; `creator-kit self-update [--check]` runs it by
hand. A `bun` source run never replaces itself.

## Host

- DNS: `creator` CNAME `aphrody.com` (`aphrody ovh dns add`).
- Certificate `creator.aphrody.com` (HTTP-01) by `scripts/tools/infra/issue-creator-certificate.sh`.
- vhost `tools/config/host/nginx/aphrody/creator.aphrody.com.conf`; catalog service `aphrody-creator` (`nginx-static`),
  route in `tools/config/host/nginx/routes.json`. Releases in `/home/ubuntu/apps/creator/releases/<id>`, last five kept.
- Rollback: repoint the `current` symlink to an older release, or remove the vhost and reload nginx.
