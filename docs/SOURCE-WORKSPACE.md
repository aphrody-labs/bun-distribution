# Source workspace integration

Bun OS owns the source inventory for the selected source directory through
`infra/source-workspace.json`. Checkout locations resolve from the distribution
checkout, and `--config` supplies explicit `checkouts` overrides. No fixed drive
or workstation directory is required.

```sh
bun src/cli.ts workspace
bun src/cli.ts workspace --config factory.local.json
```

The existing factory CLI reports every catalogued source owner, committed HEAD,
locked revision, local changes, physical checkout location, build/workspace
ownership and migration state. It also identifies additional sibling
repositories and linked distribution worktrees. An unclassified repository or
missing source pin makes the command fail. An absent checkout or a local
revision mismatch remains visible separately from committed source coverage.
The output is JSON; keep machine-specific receipts under `.local/`.

## Source graph

`sources.lock.json` retains the existing Bun, Material, APT and distribution
inputs. It adds the complete committed Android, Aphrody, IECODE and Shenron
graphs, including IECODE's M3 forks and Shenron's configuration submodule.
The integration contains 95 mounts, 82 repository/revision identities and
82 gitlinks. Existing pins are unchanged. Bun Libraries' integrated report
revision is checked against the distribution's Git ancestry.

The factory exporter consumes these pins and the explicit catalog checkout
locations. Its existing capacity, cleanliness, Git-object, LFS and license
boundaries still apply. A dirty checkout cannot qualify an export or a build.
An explicit `sourceExport.repositories` entry can supply an existing read-only
Git object store through the export owner's documented contract. The inventory
does not materialize sources, import uncommitted work or change branch state.

## Physical migration boundary

Source coverage is complete for the selected source directory. Physical
consolidation is incomplete: active source checkouts, their ignored state and
the distribution's linked worktree remain at their existing locations. Bun
still resolves through its existing junction. The old Bun Libraries checkout
retains local residue even though its source history is already integrated.

Relocation requires consumer updates together: Aphrody has sibling Bun path
dependencies, the factory resolves sibling Bun/Material owners, and the parent
workspace discovery marker is still consumed by runtime tooling. A clean Git
status alone does not qualify moving IECODE's ignored private inputs. No
checkout, protected store or local artifact was moved or removed in this batch.

The root Cargo/Bun migration remains separate. Catalogued independent owners
retain their workspace manifests, releases and license boundaries; the source
inventory does not claim one Cargo workspace or native product qualification.
Production DBFR authority remains with Omar. Provider authentication, sessions,
cookies, databases, datasets and model weights are never imported by this flow.
