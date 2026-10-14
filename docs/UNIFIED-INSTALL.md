# Unified Bun dependency install

The product root owns `bun.lock`, hoisted installation and shared `node_modules`.
ArtCraft's source manifest and 61 descendant manifests are registered by root
workspace patterns. The owner retired the historical frontend lockfile and unused
PostCSS configuration; root commands use the root lockfile. Do not infer a physically
complete install from lock resolution or a dry run.

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

## Explicit retirement after aligned builds

```sh
bun scripts/node-modules.ts --retire-aligned --plan --build-receipt build/frontend/<qualified-output>/build-receipt.json
```

This distinct mode permits intentional old/new version changes only for
`apps/desktop/node_modules`, `libraries/artcraft/frontend/node_modules` and
`libraries/artcraft/frontend/apps/artcraft/node_modules`. Its plan never removes
files. The default mode retains its byte-for-byte comparison.

Retirement requires a successful compiled receipt from the existing frontend owner,
the current runtime identity, unchanged committed root dependency inputs, current
committed ArtCraft gitlink and frontend sources, and the exact current lock SHA256.
The complete built artifact tree is rehashed against its receipt. Every declared
workspace consumer is checked against root lock declarations and shared installed
dependency versions. A root provenance commit may remain an ancestor after unrelated
commits; the ArtCraft pin, lock and artifacts must still match exactly.

Old installs must be ignored and contain no Git-index files in their actual owner.
Known obsolete dependency names are qualified from the immutable original ArtCraft
manifests at `2134266d638094b8aac37d3fe7b190123bd46bc6`, which must remain an ancestor.
Unknown package/store entries, protected paths and nonregular metadata block the plan.
Old package trees are inventoried through regular metadata, without following links.
Allowed links must resolve inside the root, and their targets are never deletion
targets. Each old tree's metadata snapshot is checked again before retirement.

After explicit execution authorization and a passing plan, omission of `--plan`
removes qualified links individually with native literal-path deletion without
recursion. A further scan refuses remaining reparse points before recursive deletion
of the exact qualified nested directory. Build proof is revalidated before this
final removal. Root `node_modules`, `build/apps`, server staging, binaries,
`install/bin`, protected stores and source targets are never candidates.

The source preparation ran no retirement. Until a fresh receipt passes these gates,
the mode reports `ready: false`; neither source implementation nor prior compilation
is a claim that one physical install has already been achieved.
