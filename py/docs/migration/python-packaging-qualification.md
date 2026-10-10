<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native Python packaging qualification

The [workspace migration plan](../../../src/PLAN.md) owns P6 acceptance.
This check qualifies the SDK's wheel and source distribution independently
of a neighboring Rust checkout, and records a narrower result than P6 closure.

Run the committed-source check from this repository:

```sh
uv run --locked python tools/packaging/qualify_aphrody.py \
  --require-byte-reproducibility \
  --report /tmp/aphrody-packaging.json \
  --artifacts-dir /tmp/aphrody-distributions
```

The default clones committed Git source into a temporary directory, snapshots
the SDK outside both repositories, builds its native wheel directly, creates
its sdist, and rebuilds a second wheel from that archive. Each wheel is installed
with its dependencies in a separate environment. Isolated Python imports must
load the compiled extension from that environment and pass cosine similarity,
zero-vector handling, dimension validation, top-k ranking, rank fusion and public
SDK imports. The checker validates wheel RECORD entries, all Python package input
hashes, the typing marker, native extension, and package resources in both wheels.
Redistributable resources must also preserve their source hashes in the sdist.

Use `--worktree` only to qualify unpublished source explicitly. Its source input
allowlist includes tracked package files and the named native packaging inputs;
it excludes generated native source, build targets and ignored machine data.
Snapshots reject symlinks and a source change during copying. Reports distinguish
this mode from committed clean-clone qualification and hash every input.

## Evidence measured on 2026-09-30

The [recorded report](python-packaging-qualification.json) qualifies a fresh
clone of published Python revision
`dae9e9880472522807dd24a02a36f29a947857d6`, including the SDK/native packaging
commit `c6cadb28adc9b54189738f6da4320bf69416068e` and reproducibility fix
`6cf3144cc548efa829a0f9cddad42d550b2eabd8`. Both builds and installations
run outside the development workspace and without a neighboring Rust checkout.

The pinned native archive is byte-for-byte identical to
`aphrody@7721c47a88a4cd4ff08d0af27d5582bbd0f4ae4b:crates/ai/aphrody-python/src/lib.rs`.
The build uses Maturin 1.14.1, uv 0.12.17, Rust 1.98.1 and CPython 3.12 on
Linux x86_64. Its 166 inputs include the native extension stub, Apache license and five Blender
scripts. Both wheels contain every Python package input unchanged; all five
Blender resources and license also match in the sdist. The wheel includes the
same license under `dist-info/licenses/`. Both installed native smoke checks pass.

**The strict byte reproducibility gate passes.** Both wheel archives have SHA-256
`324e801ceb12a32b35f4fa9b5137d5d91615e1a5aebdd8c9ab56083d3dd860a2`.
Every member is identical, including the full SBOM and RECORD; no comparison
normalization is needed for this result. `SOURCE_DATE_EPOCH=1727740800` is set
during both builds. Toolchain, platform and inputs are recorded; this result
does not claim identical binaries across different Rust versions or platforms.

Maturin 1.14.1 generates the complete CycloneDX dependency inventory and graph.
The backend retains every component's details, versions, licenses and hashes.
It replaces the root source and target `bom-ref` identifiers and their matching
dependency references with deterministic identifiers based on the verified source
archive SHA. Cargo's temporary build location is not their identity.
[CycloneDX 1.5](https://cyclonedx.org/docs/1.5/json/) defines `bom-ref` as a unique
logical identifier and `ref`/`dependsOn` as matching component references.

The [Maturin generator](https://github.com/PyO3/maturin/blob/v1.14.1/src/sbom.rs)
derives these source identifiers from Cargo metadata and offers no source-ref
configuration. The existing PEP 517 backend therefore finalizes the generated
wheel: it validates the incoming RECORD first, canonicalizes only those source
identifiers, and regenerates every RECORD hash and size according to the
[wheel specification](https://packaging.python.org/en/latest/specifications/binary-distribution-format/).
The native binary and all other payload files are preserved. Signed wheels are
rejected, rather than invalidating an existing signature. Editable wheels use the
same verified source recipe; locked editable installation was also verified.

Eight new backend regressions cover unchanged graph/component details, source
identity changes, invalid source hashes, exact archive parity, complete RECORD,
rejection of corrupt input and editable provenance. Combined with existing backend
checks, 23 tests pass. The five qualifier regressions separately ensure version,
license and graph changes cannot be ignored. uv's
[build reference](https://docs.astral.sh/uv/reference/cli/#uv-build) documents the
direct wheel and sdist archive inputs used by the gate.

Other measured gates on the shared current worktree:

- `uv lock --check` and `uv sync --all-packages --locked`: pass; 271 packages
  resolved and 136 packages checked.
- SDK tests: 409 passed, 21 skipped; optional/live integrations remain skipped.
  An earlier run under concurrent build load had one failure in an unchanged
  two-second subprocess startup test (408 passed); its five-test focused suite
  and the full unchanged rerun pass. No timeout or assertion was weakened.
- Training, OCR and NIE tests together: 69 passed, 16 skipped, 16 failed.
  Every failure is a NIE native engine test because `nie_ffi` cannot be resolved.
- Packaging tooling Ruff check and format check: pass. This does not qualify
  the whole imported workspace's historical lint diagnostics.

Published SDK source now passes the default clean-clone build/install check.
Windows/macOS wheels, optional CPU/CUDA environments, the NIE native library and
protected game datasets, whole workspace lint, deployment and consumer integration
remain separate P6 gates.
