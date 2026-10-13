# Flat crate migration

The root owns the Cargo workspace, nightly, shared dependency versions and
outputs. Each migrated product crate lives at `crates/<package-name>` as a
pinned forge Git submodule, retaining its source history and license notices.

Inspect immutable manifests before choosing a migration batch:

```sh
bun scripts/crate-inventory.ts aphrody=../aphrody material=../material
```

The command reads tracked Git objects at each source revision, rather than
scanning generated directories or modifying active checkouts. Its report is
written to the ignored `.local/crate-inventory.json`. It records source pins,
package identities, dependency names, proposed destinations and collisions.
The source names and extra checkout paths are explicit arguments.

`crates` counts all tracked package manifests, including nested, vendored and
fixture packages. `declaredWorkspaceCrates` counts root manifests and explicit
root workspace members after exclusions; it is not Cargo metadata's complete
automatically included dependency closure. `remainingDeclared` identifies
unmigrated declared members. Unavailable submodules are reported explicitly.

Shared source copies and generic names such as `xtask` must be reconciled
before importing them into one Cargo namespace. A proposed path in the report
does not constitute migration or a new repository. Imported libraries retain
their existing workspace until consumers, manifests, assets, histories and
native gates have actually switched. The font and atomic crates currently
implement this contract.
