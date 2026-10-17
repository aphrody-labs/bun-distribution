<!-- SPDX-License-Identifier: Apache-2.0 -->
# SDK distribution validation

The Linux SDK qualification (`modernize_workspace.py linux-sdk --python VERSION`, Python
3.11, 3.12, 3.13 and 3.14) builds the `aphrody` wheel from the Aphrody monorepo checkout
into temporary storage with `uv build --wheel`; the native extension is the workspace crate
`crates/aphrody-rust`, so the build needs Cargo and runs on the serialized build host. No
source archive is built or rebuilt for `aphrody`: its Rust source lives outside the package
directory (see [native build](native-build.md)). Runtime dependencies resolve from published
package metadata; the root workspace environment and its optional training packages are not
involved. The nested GitHub workflows of the former standalone repository were removed
(GitHub reads only the root `.github`).

`tools/sdk/verify-wheel.py` checks each wheel's CPython 3.11 `abi3` tag, native
extension, the `aphrody-rust` CycloneDX SBOM, native type signatures,
Apache license text, PEP 561 marker and bundled Blender resources. It permits only the exactly pinned optional Antigravity Git dependency;
other direct URLs and a core Scrapy dependency are rejected. It installs the wheel into a new temporary virtual
environment, checks lazy root imports, checks the installed package origin and
version, and runs the three native ranking functions. These checks require no
credentials, model downloads, provider requests or running native CLI.

With `--tests`, the verifier copies all SDK `test_*.py` files except
`test_public_api.py`.
These files require the
source tree; installed lazy-import behavior has a separate smoke check. Pytest
runs with isolated Python, a separate configuration and explicit HTTPX/asyncio
plugin loading. NumPy, Pillow and pyoxipng are installed as test dependencies for
deterministic evaluation, forensic ranking, audio and image tests, without
installing model runtimes.
The source tree, repository conftest and workspace `pythonpath`
cannot shadow the installed wheel. Integration/live API tests are deselected and
opt-in variables are removed. State, secrets, cache and browser cookie paths use
temporary directories. Optional dependency omissions are reported as skips;
heavy media/ML extras and live services remain separate gates.

To reproduce an isolated Linux SDK qualification:

```sh
python tools/packaging/modernize_workspace.py linux-sdk --python 3.11
python tools/packaging/modernize_workspace.py check
```

The SDK command accepts 3.11, 3.12, 3.13 and 3.14 and records the wheel hash
after the installed-wheel checks pass. `check` qualifies all seven distributions on
the complete workspace baseline, CPython 3.12. Configured CI jobs alone do
not establish that a particular remote workflow run succeeded.

The following dated results describe earlier versions of the workspace.

## Local qualification, 2026-09-30

The final SDK was qualified on Linux x86_64 with CPython 3.12.3. Both installed
wheel checks used independent temporary virtual environments and the current
provider lifecycle tests.

| Gate | Result |
| --- | --- |
| SDK source suite | 401 passed, 21 skipped |
| Training and OCR focused suites | 20 passed |
| Locked workspace synchronization | Passed; 271 locked distributions after removing 25 unused dependencies |
| Wheel from source archive | 374 passed, 18 skipped, 3 integration tests deselected |
| Independently rebuilt source-archive wheel | 374 passed, 18 skipped, 3 integration tests deselected |
| Both wheel structural and native smoke checks | Passed: license, provenance, native signatures, PEP 561 marker, Blender resources, installed origin and all three native functions |

The first wheel SHA-256 was
`10d2b695502cbef9c0360b07605cceff2cd2de8909e7625324bd5e9ab3384e48`;
the independently rebuilt wheel SHA-256 was
`9a5c2269ecc0d1bef8be4268cd29c6113ef7cbf1c563b0a5dbca59fb278c6f7e`.
Both were `aphrody-0.1.0-cp311-abi3-linux_x86_64.whl`.

Installed-wheel skips cover the optional Antigravity/voice SDK, NetworkX RAG
extra, Rust CLI live integration, Whisper runtime/audio fixture, SVG renderer,
SciPy and trimesh. They do not prove those optional integrations are functional.
The additional Linux Python versions are configured CI gates;
this local qualification does not claim their execution.

## Short-path refactor qualification, 2026-10-03

The SDK now lives at `packages/aphrody`; all five installable packages live
directly under `packages/`. The complete root suite reports 563 passed and
18 skipped. Ruff passes. The SDK and training locks also pass from isolated
copies outside the workspace. All five packages build source archives and wheels.
The installed SDK wheel reports 392 passed, 19 skipped and three integration
tests deselected; provenance, native functions and installed origin pass.
Source-only build/pinning tests remain in the root suite; the RAG adapter
contract uses the installed package location in both environments.

The neighboring training runner passes Linux check/clippy and all eight tests,
including its Python dataset consumer. Windows MSVC check fails in ring's C
build because this host has no authentic MSVC installation at `/mnt/c/BuildTools`;
this is an environment failure, not a successful Windows qualification. WASM
is outside the process-based training runner's supported scope.

The per-file migration and validation evidence lives in
[the short-path map](../migration/short-paths-2026-10-03.json).

## Linux scope

The Windows failure recorded above is historical and is not a current gate.
Linux is the supported release platform. See [Linux contracts](linux.md).
