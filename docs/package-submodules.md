# Flat JavaScript package ownership

The root Bun workspace contains ten product members at version 1.4.4. Three
private forge submodules import existing Aphrody packages at source commit
`3187d795e84ff88da67f53f12be1add715ad73b2` without publishing the source
repository's full private history in the public distribution repository.

| Root path | Package | Source prefix | Projected history | Child `os` revision |
| --- | --- | --- | --- | --- |
| `packages/paths` | `@aphrody/paths` | `packages/infra/paths` | 23 commits, 1 merge | `42b4db7768807187c5c1df1f42ad7980bc75acaf` |
| `packages/ovh` | `@aphrody/ovh` | `packages/infra/ovh` | 20 commits, 1 merge | `7088376bf9460af0d3868078509785b43a5379a0` |
| `packages/kernel-client` | `@aphrody/os` | `packages/os/kernel-client` | 19 commits, 1 merge | `6491e524361aed7983918ced139b69399e43572f` |

Each genuine Git subtree split reproduces the original prefix tree. Later
child commits adapt manifests, root build/type ownership, formatting, Apache
license text and `SOURCE.json` provenance. The kernel integration test resolves
the root `target/` directory; its backend remains unqualified. Source worktrees
and concurrent changes remain with their existing owners until consumers qualify.

The root owns `bun.lock`, the hoisted `node_modules`, and
`scripts/build-packages.ts`. Package build wrappers invoke that owner with a
30-second deadline; outputs belong to `build/packages/<directory>`. Exports and
types resolve TypeScript source. No external declaration compiler, package-local
`dist`, runtime npm dependency, OVH profile or protected secret was imported.

Observed on 2026-10-14: frozen root installation passes; types, lint and format
pass on 124 files. All three JavaScript builds pass and record eight exports
with SHA-256 receipts (`compiledJS:true`, `executed:false`, `deployed:false`).
No package test or live OVH/kernel operation was executed. The standalone
product server's earlier sixteen HTTP gates qualify its recorded source,
not these package operations or a later distribution snapshot.

The builder refuses existing output directories, so subsequent compilation
requires an explicit owner-controlled output lifecycle. This first build does
not establish incremental rebuild or deployment qualification. Remaining source
packages and nested workspaces are still migration work.
