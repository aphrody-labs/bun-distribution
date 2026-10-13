# Product Cargo source vendor

`scripts/vendor-cargo.ts` owns the root Cargo source snapshot. It uses the
existing native admission wrapper, root nightly and shared process deadlines.
It does not create another workspace, modify root manifests/lockfiles, compile
Rust, activate source replacement, or clean external caches.

## Prepare and qualify

From the root, with its exact configured Bun runtime:

```sh
bun scripts/vendor-cargo.ts plan
bun scripts/vendor-cargo.ts prepare
bun scripts/vendor-cargo.ts verify
```

Each action is serialized by `runNative` and bounded to 30 seconds. Plan
captures the root manifest/lock and each flat member manifest. It inventories
cached compressed registry archives before downloads. Prepare requires that
exact snapshot and runs `cargo vendor --locked --versioned-dirs --no-delete`
into `vendor/cargo`. Partial copies remain resumable; caches remain intact.

Verify supplies a temporary absolute source configuration only to
`cargo metadata --locked --offline --all-features`. It compares every package name, version,
and original source identity to Cargo.lock, checks archive checksum identities
and manifest/license/notice file digests, rejects extra packages and escaped
source paths, and limits expanded sources to 2 GiB. Inventory preserves upstream
license identities; it does not substitute the root license.

## Staged configuration

Cargo's emitted table becomes `source-replacement.toml` here. Merge it into
root `.cargo/config.toml` only after offline metadata and the root compilation
gate both pass. This is a snippet for root configuration, not a portable standalone
configuration. Verification uses a generated absolute test configuration under
`build/vendor`; the active source table remains untouched.

`cargo-inventory.json` is written only after qualification. Its `compiled`
and `activeSourceReplacement` flags remain false. Actual source sizes and package
counts belong to that receipt; cached archive size is preflight evidence only.

## Scope and upstream integrity

This snapshot covers the current root product Cargo members. Runtime native
vendors, nested library workspaces, npm modules and protected application stores
are separate open migration work. Existing source locks, Git pins and license
owners remain unchanged. Different locked upstream versions remain distinct
package identities. Editing upstream sources requires their normal patch/source
owner; replacement assumes equivalent sources.

References: [Cargo vendor](https://doc.rust-lang.org/cargo/commands/cargo-vendor.html)
and [Cargo source replacement](https://doc.rust-lang.org/cargo/reference/source-replacement.html).

## Qualified snapshot

The 2026-10-13 snapshot contains 12 root members and 514 remote packages
(513 registry packages plus the Git-pinned winprint source). Offline metadata
with all root features resolves exactly the 526 lockfile package identities.
Cargo nightly-2026-09-15 is recorded in the generated inventory. Source content
is 658422334 bytes across 27526 checksum-listed files. Manifest, notice and
declared license files are independently checked; full compilation remains
pending. The active source configuration, root toolchain, source lock and Git
module ledger hashes are recorded and unchanged by this lot.
