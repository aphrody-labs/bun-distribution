<!-- SPDX-License-Identifier: Apache-2.0 -->
# Building the native SDK

`aphrody` ships its `aphrody.aphrody_rust` extension in every wheel. It provides
cosine similarity, top-k cosine similarity and reciprocal rank fusion. Wheels
use PyO3's CPython 3.11+ stable ABI; source builds require Python 3.11 or later,
a Rust toolchain supporting edition 2024 and Cargo access to the locked crates.

The Python packaging recipe is self-contained in
`packages/aphrody/native/Cargo.toml`, with exact PyO3 0.29.0 and a committed
`Cargo.lock`. PEP 517 uses `build_backend.py` and exact maturin 1.14.1. The backend
checks the compressed source archive's SHA-256, a strict file allowlist and each
file's SHA-256 and size before materializing ignored `native/src/lib.rs`. It then
delegates wheel, sdist, metadata and editable hooks to maturin with `--locked`.
Generated source is replaced atomically on the next build if it differs from the
artifact. The wheel includes the verified provenance at
`aphrody/native-source.json` for correlation with the source release; the compressed
source archive remains in the sdist.

Rust implementation remains owned by the Aphrody Rust monorepo. The current
source pin is recorded in `packages/aphrody/native/source.json`; it projects
the canonical `crates/ai/rag-python/src/lib.rs` binding and byte-identical
`rag-core` modules `fusion`, `vectors_f64`, and `vectors_f32`. The binding adds
only the crate alias and module declarations required for standalone packaging.
The provenance includes the full source revision, per-file hashes, sizes and
archive SHA-256. Tar permissions are fixed, owners and timestamps are zeroed,
and gzip mtime is zero. Generated Rust implementation is not maintained here.

RAPTOR arithmetic includes float64 normalization, matrix products and spherical
centers, plus direct Euclidean squared distances in float32/float64. UMAP's
float32 centroid means stay float32; implicit promotion can change assignments.
Python retains tree iteration, label ordering, first-minimum selection and
remapping policy. Native distance reduction uses the NumPy fast-axis ordering;
consumer tests compare the installed wheel against the prior NumPy arithmetic.

Build both distributions from the workspace:

```sh
uv build --package aphrody --out-dir /tmp/aphrody-native-build
```

The sdist includes the backend, packaging recipe, lockfile, provenance and
compressed source. It excludes generated Rust source. A source distribution can
therefore rebuild its native wheel outside both source repositories:

```sh
cd /tmp
uv build /tmp/aphrody-native-build/aphrody-0.1.0.tar.gz \
  --wheel --out-dir /tmp/aphrody-native-rebuild
uv venv /tmp/aphrody-native-install
uv pip install --python /tmp/aphrody-native-install/bin/python --no-deps \
  /tmp/aphrody-native-rebuild/aphrody-0.1.0-cp311-abi3-linux_x86_64.whl
/tmp/aphrody-native-install/bin/python -c \
  'from aphrody import aphrody_rust; assert aphrody_rust.cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0'
```

Use the wheel filename produced for your operating system and architecture.
The `--no-deps` install above tests the native extension independently; ordinary
SDK installs should resolve the declared Python dependencies. Wheel content
excludes tests and build/target directories. Source and dependency inputs are
pinned; compiler and platform differences can change the resulting wheel bytes.

Maturin currently emits a warning when the PEP 517 backend is this verification
wrapper rather than `maturin`. PEP 517 loads the declared wrapper and successfully
delegates to maturin; the warning does not disable native builds.

To refresh native source, change the canonical Rust repository first and pin its
reviewed commit. Export the binding and all three canonical core modules with `git show`,
construct a USTAR archive with the strict four-file allowlist, mode `0644`, uid/gid zero, empty owner names and
mtime zero, and compress it with gzip mtime zero. Update `source.tar.gz` and all
provenance fields/hashes together. Keep the source allowlist in `build_backend.py`
and its tests synchronized if the canonical crate gains source files. Update the
packaging recipe and lockfile only when the canonical dependencies change.
Re-run the backend integrity tests, the wheel/sdist build and the isolated sdist
rebuild before committing the refresh. Never edit generated `native/src/lib.rs`.
