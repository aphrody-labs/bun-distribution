<!-- SPDX-License-Identifier: MIT -->
# SpaceUI upstream reference archive

This MIT-licensed snapshot of `spacedriveapp/spaceui` is retained for provenance.
It is excluded from the Aphrody Bun workspace and is not a build or publishing target.

Maintained components live in first-party packages:

- `packages/m3-primitives`
- `packages/m3-forms`
- `packages/m3-ai`
- `packages/m3-explorer`
- `packages/m3-theme`
- `packages/assets` (not in repo)
- `examples/m3-spaceui-showcase`

The old `@spacedrive/{primitives,forms,ai,explorer}` local re-export packages and
their build manifests were removed. Their release history remains under each
package's `CHANGELOG.md`; each directory README points to its M3 replacement.
The old showcase source was migrated; `examples/showcase/README.md` is a pointer.
Retired duplicate icon paths and hashes are listed in
`packages/icons/RETIRED-DUPLICATES.json` (not in repo).

See `UPSTREAM.txt` for the source revision, license, and migration map. Other
documents in this archive describe the upstream project at that revision and are
historical references, not Aphrody setup instructions.
