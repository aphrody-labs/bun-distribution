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
The integration contains 96 mounts, 85 repository/revision identities and
83 gitlinks. The original 85 pins are unchanged; the four new source graphs
record the committed revisions after synchronization. Bun Libraries' integrated report
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

## Git synchronization

The owner's subsequent request also covers pending source checkpoints and
actual pulls with rebase. Nested source owners are synchronized before their
parent Git pins. The distribution's existing font workflow and press assets
are committed; macOS archive metadata remains excluded. The composition
worktree is published on `codex/material-work` after rebasing onto `os`, with
its unregistered source repositories retained for their separate migration.
Live edits in an actively changing index are preserved rather than raced.
These checkpoints preserve source work; they do not qualify application
behavior, native artifacts, production activation or the unfinished physical
consolidation.
