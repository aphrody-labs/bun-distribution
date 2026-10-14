# Unified Bun dependency install

The product root owns `bun.lock`, hoisted installation and shared `node_modules`.
ArtCraft's 61 tracked frontend manifests are registered by root workspace patterns.
Its tracked historical `frontend/bun.lock` still exists; root commands use the root
lockfile. Do not infer a physically complete install from lock resolution or a dry run.

```sh
bun scripts/node-modules.ts --plan
```

This command is read-only and reports exact declared member directories, nested
install qualification and blockers. Member glob patterns are expanded through their
`package.json` files, deduplicated and sorted. Recursive wildcard/protected-store
patterns are refused. Symbolic links and Windows reparse points are refused in
member paths and inspected install trees; scans do not follow them. Installed package
name/version and every regular local file must match the shared root owner, including
derived `.bin` contents. Unknown store metadata, links, missing files or differing
bytes block removal. A blocked plan means cleanup has not qualified.

Without `--plan`, the same owner revalidates each qualified tree immediately before
its existing native PowerShell `Remove-Item -LiteralPath` operation on Windows.
Targets must resolve within the product root and must never be root `node_modules`.
The script does not install packages. Review its plan before authorizing removal;
the current corrective batch ran no deletion.

Read-only audit of 2026-10-14: all direct ArtCraft frontend dependency manifests were
present in root `node_modules`. The corrected plan expands 71 actual workspace
members. Desktop's nested install qualifies against the root (one package, 1,284
files). During concurrent installation, two ArtCraft nested installs appeared:
`libraries/artcraft/frontend/node_modules` is blocked by a reparse/symbolic link;
the app's nested install is blocked by a different `@preact/signals-react` identity.
The observed plan reports `ready: false` and `changed: false`. No cleanup was run.
Qualification has a 30 second budget; timeout blocks it. This observation does not
prove frontend execution or build success.

`bun pm untrusted` reports blocked ArtCraft `prepare: husky` plus SWC, core-js,
unrs-resolver and Parcel watcher lifecycle hooks. No hook was enabled by this audit.
Husky can configure Git hooks when executed from a checkout; the current app
directory has no `.git`. Root has no explicit trusted-dependency override.

The owner subsequently compiled the frontend: 33 artifacts under
`build/frontend/artcraft`. Browser execution remains unqualified. The canonical
`bun run frontend:build` now delegates to the existing ArtCraft compiler through
the root's bounded process owner, with a fresh output below `build/frontend`.
It refuses existing outputs, escapes and reparse paths. Upstream's direct command
still defaults to its historical `frontend/apps/artcraft/dist`; product commands
use the root wrapper. No source compiler was copied or replaced.
Protected `external/`, `secrets/` and provider configuration must remain untouched.
