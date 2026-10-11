<!-- SPDX-License-Identifier: Apache-2.0 -->
# Branch integration and runtime qualification — 2026-10-11

Main incorporates the current remote main, `bun-1.4.4-docs`,
`codex/discord-all-channels`, and the identical Omar container branches
`omar/main-sync` and `omar/container-a2a-20261009`.

The Discord deployment conflict preserves the explicit removal of the retired
Omar monitor in `c7a21753a1`; its deleted deployment test is not restored.
The independent `b3c09f32f7` qualification snapshot has no common history.
Its differing source paths are superseded by main's authenticated gateway,
CUDA 13.4 and Windows D3D12 qualification. Its ancestry is recorded while
retaining main's source. No remote feature branch remains outside main.

All nine local worktrees remain intact. Detached components, Claude integration,
downloads, release, WASM and native qualification histories already belong to
main. Uncommitted downloads/setup changes already match main. Concurrent SQL
qualification changes and the IECODE producer's deleted design directory and
symlink change remain in their original worktrees; neither is a qualified
replacement for main. No worktree, database, credential store or ignored output
was deleted or staged.

## Runtime

The root `packageManager` already requires `bun@1.4.3-aphrody.4`.
The published source version `1.4.4` is not substituted for a released runtime.
The Linux archive for `aphrody-v1.4.3-aphrody.4` matches its release checksum:

```text
0661b5b6dfbd4535c2bdda639c4c1ee1f063c6eee3cbce65c42c1e99b244a9a6  bun-linux-x64.zip
```

VPS and DBFR independently verified this archive and executed its binary.
DBFR's qualified executable resides at
`/home/ubuntu/.local/share/aphrody-runtime-20261011/bun-linux-x64/bun`.
It is mounted read-only over `/usr/local/bin/bun` in the existing service images.
The container libraries and old images remain available for rollback. The
container base still identifies `1.4.3-aphrody.3`; the executed binary reports
`1.4.3-aphrody.4+41211b568`. No image tagged `.4` is claimed published.

The cataloged Compose includes persist these executable mounts for downloads,
Discord, fonts, timeline, the Bun probe, MCP, compute, embeddings and jobs.
`host-apps.ts` installs the two override files alongside the root project.
All nine containers execute the same `.4` revision and report healthy.
The Rust-only `aphrody:runtime` image is excluded: its older glibc cannot load
the new Bun executable. No engines were built on DBFR.

Before applying, the candidate Compose model passed `config --quiet` and an
isolated read-only, network-disabled container executed the staged fork.
Application retained all existing bind mounts and protected environment files.
The previous root Compose is retained in the runtime staging directory.
Rollback removes the runtime override includes, restores that previous file,
and recreates only the affected services with `--no-build --no-deps`.

## Gates and live behavior

- Native Windows scoped Bun workspace contract: nine passing tests.
- Native Linux VPS host-plan gate: 17 passing tests and 106 assertions.
  The socket fixture requires a real POSIX shell; its Windows run cannot execute
  `sh`. The Linux gate validates the actual shell commands rather than skipping
  their assertions.
- Scoped `host-apps.ts` TypeScript, oxlint, oxfmt and whitespace gates passed.
- The broader Windows Workspace suite exposed existing failures: 266 passed,
  44 skipped, 22 failed and 18 loader errors, including missing `@aphrody/paths`.
  This is not a green full-workspace qualification.
- Native Aphrody browser renders the deployed public homepage with 26 interactive
  elements. The documentation snapshot captures its initial loading state;
  the documentation and template APIs return their real catalogs with HTTP 200.
  Home, docs, templates, Material 3 and `app.js` return HTTP 200.
- The browser search adapter now uses the read-only `/api/search` endpoint.
  Desktop search retains its native RPC contract. The HTTP endpoint reuses
  `aphrody-google`, forces anonymous requests, restricts accepted fields,
  bounds query/pagination, and limits concurrent searches to four with a
  20-second deadline. `/rpc` remains unavailable on the public product site.
- The site passed serialized native Linux Cargo check, 23 tests with no ignored
  tests, strict Clippy for all targets and a release build. A separate probe
  using the exact native Google owner on DBFR received an upstream Google
  anti-bot interstitial, not usable results. Search returns HTTP 502 honestly;
  the UI provides an encoded Google search link when this occurs.
- The deployed fork passed seven search/homepage tests with 34 assertions.
  The DOM test enters a query, sends the actual browser adapter request, displays
  an upstream 502, verifies the encoded Google destination and rejects false
  result presentation. Only the unrelated decorative pet animation is frozen.
- The isolated DBFR Docker site serves the rebuilt canonical M3 UI, docs and
  templates. It runs without account cookies, provider/home mounts or host RPC,
  with a read-only filesystem, one GiB memory limit and a private WireGuard port.
  Its health runner executes the verified `.4` fork. The container base is an
  existing local image ID with `pull_policy: never`, not a registry digest.
- Native Bun checks passed for 85 reviewed package commands after building
  their actual owner packages. The three remaining package commands hit the
  published fork's collision with scripts named `check`; the same projects
  pass from the root with explicit configs (583, 11 and 20 files). The template
  was qualified by the existing owner generator: its real 21-file base/web
  project installed five packages and passed native checking without installing
  TypeScript. Package command activation still requires the dispatcher fix.
  Declaration producers execute the locked repository TypeScript 7 emitter
  through Bun, without a PATH compiler fallback; native `bun check`
  qualification does not establish native declaration emission.

Gateway and domain deployment remain separate from a successful Bun runtime
upgrade. The Bun release gateway/cache are delivered independently. Aphrody's
public TLS edge now routes the read-only site to DBFR without changing the apex
DNS or exposing authenticated provider and host capabilities. The prior edge
configuration remains in a protected host backup; `nginx -t` and reload passed.

The DBFR default Bun executable was upgraded atomically to the qualified .4
release after verifying its SHA-256. Its existing bunx symlink resolves to the
same executable; both report .4. The previous executable is retained in a
protected host backup. The root Compose catalog now includes the isolated site;
configuration validation passed before and after installation, and a selective
no-build start retained the healthy service. No runtime cache was removed.
