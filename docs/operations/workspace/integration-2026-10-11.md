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
- Native Aphrody browser snapshots rendered the public homepage and documentation.
  Home, docs, templates, Material 3 and `app.js` return HTTP 200.
- The frontend's live `/rpc` calls for initialization and Google search return
  HTTP 404. Full application functionality remains unqualified. The native
  product site intentionally serves read-only routes; host RPC must not be
  exposed through an implicit public proxy. The existing Bun WebOS owner
  (`m3/packages/app-ui/webos.ts`, `packages/bun-webos` in the configured fork)
  must be qualified and deployed with its declared origin and permissions.

Gateway and domain deployment remain separate from a successful Bun runtime
upgrade. DBFR's gateway currently declares Shenron vhosts. Its Aphrody TLS
certificate covers `aphrody.com`, `www.aphrody.com` and `mcp.aphrody.com`,
not `bun.aphrody.com`.
