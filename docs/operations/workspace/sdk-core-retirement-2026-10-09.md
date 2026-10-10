<!-- SPDX-License-Identifier: Apache-2.0 -->

# Retire the duplicate native SDK core

Following the layer directive, all four Aphrody native SDK core consumers now
resolve the Bun-owned `yolo-core` at
`6181424bc2fca4349560832161c07ba85c33e8ef`. The previous batch migrated
`aphrody-yolo` and the desktop manifest; this batch changes the remaining
`yolo-runtime` and `yolo-pyo3` dependencies to the same workspace entry.

The 12 tracked files under `crates/engine/yolo-core` (not in repo) were clean and matched
`packages/bun-runtime-sdk/crates/yolo-core` (not in repo) exactly in the configured Bun
checkout before removal (`git diff --no-index`, exit 0). Git retains the source
history and the Bun SDK's original MIT/Apache-2.0 provenance remains intact.
The local duplicate accounted for 2,889 lines. This is a source reduction, not
a measured runtime or build performance gain.

Native Windows gates through `scripts/dev/windows-cargo.ps1`:

- `check --offline -p yolo-runtime -p yolo-pyo3`: passed before and after removal.
- `test -p yolo-runtime --lib --locked`: all 18 tests passed, including ABI,
  allocator ownership, stale handles, panic conversion, cancellation and join;
  passed again after removal.
- `clippy -p yolo-runtime -p yolo-pyo3 --all-targets --locked -- -D warnings`:
  passed before and after removal.

Cargo generated the lockfile and removed the local `yolo-core` package. All
consumers resolve the same pinned Git package. No dependency version upgrade
was performed. The lock also preserves the concurrent native product-site
owner's new workspace entry; that member uses already locked dependencies.
It does not qualify the product-site implementation.

The local runtime ABI, its browser/GPU extensions, the Python module and their
compatibility entrypoints remain. Moving these extensions requires their own
qualified native contracts; disabling them would violate the migration. No
desktop rebuild, Python wheel publication, runtime activation or Bun binary
size/startup/RSS claim is made by this batch.
