<!-- SPDX-License-Identifier: Apache-2.0 -->
# `vu`: the Aphrody Python runtime

Date: 2026-10-05. Status: plan, local scaffold, forks created and pinned; the `vu` binary is not built yet and no
repository `vu` exists. Every "verified" below names its source in the journal (section 11); everything else is
labelled as a decision, a recommendation or unverified.

## 0. Owner request and name

Owner request (verbatim, French): « absorbe py/packages/aphrody/native et fusionne nativement py à aphrody et
déduplique vraiment aphrody et py via un sub agent qui intègre uv et pyo3 direct au coeur d'aphrody comme on fait
pour bun avec un monorepo externe avec les crates rust astral sœurs de uv + uv et ruff et pyo3 pour avoir notre
runtime du nom de « ir » l'inverse de uv ».

Name: **`vu`**, the literal inverse of `uv`, settled by the owner on 2026-10-05. The request first wrote « ir »; that
wording is abandoned and no open decision on the name remains. The name is written once, in
[scaffold/vu.json](scaffold/vu.json); every other name (binary, packages, variables, fork branches, receipt schema) is a
template over it (section 4.5).

Batches already delivered for the same request (commits on `workspace/main`): inventory
[INVENTORY-py-vs-aphrody.md](INVENTORY-py-vs-aphrody.md) (`a90c757ee`), absorption of the native crate into
`crates/ai/rag-python` (`47d2681b5`), deduplication of `py/` (`0e57c2a8c`), rename to `vu` (`0cd1df3a8`).

## 1. Goal

One runtime, `vu`, built outside the Aphrody monorepo from pinned forks of uv, ruff and PyO3 plus a prebuilt CPython,
and consumed by Aphrody as a precompiled runtime/SDK, exactly like Bun (fork `aphrody-labs/bun`) is consumed through
Yolo:

- `vu uv ...` and `vu ruff ...`: the pinned uv resolver, installer and Python manager, and the pinned ruff linter and
  formatter;
- `vu python ...`: an embedded CPython (python-build-standalone) driven through PyO3, with the Aphrody native module
  available to scripts;
- `yolo py` and `vu` unified: one entry point for Python test, lint, format, build and status, replacing the direct use
  of the `uv`, `ruff` and `maturin` binaries found on PATH.

The Python product code stays in `py/` (a thin Python layer over the Rust runtime); the Rust binding of the SDK stays in
`crates/ai/rag-python`.

## 2. Verified starting point

| Fact | Consequence |
| --- | --- |
| uv 0.12.23, ruff 0.16.10 and PyO3 0.29.3 are the current releases; the crates.io packages carry the release commit in `.cargo_vcs_info.json` (J1, J2). | The pins are exact and checkable offline from crates.io as well as from GitHub. |
| The `Cargo.lock` of uv (737 packages) and of ruff (558) contain no git source, no PyO3, and uv does not depend on ruff (J3). | The instruction to pin ruff and PyO3 "at what uv's lock uses" has no object; they are pinned at their own releases. All Astral sister crates (`astral-*`) come from crates.io. |
| uv-* and ruff_* crates are published but described as internal components; the supported interface of uv is its CLI, and `uv::main` is documented as not recommended for external consumption and callable once per process (J4). | Library use is an unstable internal API: exact pins and forks that can carry patches are required. |
| 5 of the 8 ty crates that a consumer would need are not published (ty_project, ty_ide, ty_server, ty_test, ty_wasm) and the ty crate is version 0.0.0 with publish = false (J5). | ty can only be built from the ruff tree; no separate ty fork is needed. |
| Merging uv and ruff into the Aphrody `Cargo.lock` would add 477 registry packages: 192 new crates and 285 second versions of crates already locked (J6). | External monorepo with its own lock, as for Bun. |
| `cargo check --locked -p uv` and `-p ruff` succeed at the pins with the Aphrody toolchain 1.98.1 on the build host; a probe binary that calls `uv::main`, `ruff::run` and the PyO3 embedding API, with path dependencies on the three pinned checkouts, type-checks in one workspace of 804 locked packages (J7). | The toolchain and the dependency approach are feasible; release builds and linking are not measured. |
| python-build-standalone release 20261003 ships CPython 3.12.15 and 3.14.8 for x86_64-unknown-linux-gnu, with a shared and a static libpython in the full archive (J8). | The embedded interpreter has a verified source; the py workspace baseline (3.12) is available. |
| The WSL host has glibc 2.39 and the build host has glibc 2.43 (J9). | A binary built on the build host may not start in WSL; this must be measured on the first build. |

## 3. Architecture

### 3.1 The Bun precedent, mirrored

| Bun / Yolo | Python / `vu` |
| --- | --- |
| Fork aphrody-labs/bun, branch `main` = upstream + patches, pin in config/vendor.json | Forks aphrody-labs/uv, ruff, pyo3, one branch per release `vu-pin-<version>` at the release commit, pins in scaffold/vendor.json |
| Planned repository `yolo` holding vendor/bun, built on the VPS | Planned repository `vu` holding vendor/{uv,ruff,pyo3}, built on the VPS (not created: decision D1) |
| bun-forge, `yolo forge`, config/bun-forge.json, receipts `aphrody.bun-forge/1` | scaffold/vu-forge.json, receipts `aphrody.vu-forge/1`, `yolo forge` generalised to a `--config` file |
| `scripts/tools/vendor/bun_upstream_sync.ts`, merge of upstream/main, never forced | Same engine for the three forks, pins move by release tag, not by merge of main |
| Provenance in config/upstream-sources.json | Entries vu-uv, vu-ruff, vu-pyo3, vu-python-build-standalone (added, section 4.2) |
| Yolo runtime SDK: artifact directory with manifest.json, current/previous links, verified before load | `vu` runtime artifact with the same layout and verification (section 3.6) |
| `yolo import` and vendor.toml for the Tauri forks | `vu import` only if a crate must be copied and renamed (section 4.4); the default is path dependencies |

### 3.2 Repositories

- Aphrody monorepo (this repository): products, `py/`, the SDK binding `crates/ai/rag-python`, the pins and provenance
  (config/upstream-sources.json), `yolo py`. It never builds uv, ruff or CPython.
- Planned repository `aphrody-labs/vu` (decision D1): the workspace that links uv, ruff, PyO3 and CPython into one
  binary, its forge configuration and receipts. Local scaffold: [scaffold/](scaffold/README.md).
- Forks (created): aphrody-labs/uv, aphrody-labs/ruff, aphrody-labs/pyo3 (section 4.1).
- Not forked: python-build-standalone (release assets pinned by sha256), maturin (PyPI build backend, pinned
  `maturin==1.14.1` by the SDK), astral-sh/ty (its code is in the ruff tree), astral-sh/pubgrub and the other `astral-*`
  crates (from crates.io at the versions of uv's lock). A fork is created when a patch exists, not before.

### 3.3 Layout of the external monorepo (planned)

```text
vu/
  Cargo.toml  Cargo.lock  rust-toolchain.toml     workspace and lock of the runtime only
  vu.json                                          the single place of the runtime name
  vendor.json                                      pins: forks, release assets (scaffold/vendor.json)
  vendor/uv  vendor/ruff  vendor/pyo3              fetched, shallow, git-ignored (not submodules)
  crates/vu                                        the binary: multi-call dispatcher and sidecar launcher
  crates/vu-runtime                                embedded CPython through PyO3 (auto-initialize)
  config/vu-forge.json                             build host configuration (scaffold/vu-forge.json)
  docs/                                            provenance, licences, contracts
```

### 3.4 Integration tiers (verified constraints, recommendation)

| Tier | What | Upstream support | Verdict |
| --- | --- | --- | --- |
| T0 | `vu` ships the unmodified `uv` and `ruff` binaries built from the pins as sidecars of the runtime directory and execs them; the CLI is the public interface of both tools | Fully supported interface | **Recommended first** (phase P2): no coupling to internal crates, upstream behaviour, including `uv run` re-invoking `$UV`, is preserved |
| T1 | `vu uv ...` calls `uv::main` and `vu ruff ...` calls `ruff::run` in the same process | `uv::main` is "not recommended for external consumption"; it assumes it controls the process, may be called once, is `unsafe` (no other thread running) and sets `UV` to the current executable (J4); `ruff::run` installs a global panic hook | Possible only as single-shot dispatch before any thread or interpreter exists; needs a patch so that nested `$UV` calls reach a `uv` entry (fork branch); optional (P5) |
| T2 | Aphrody Rust code links individual library crates (uv-pep440, uv-pep508, uv-resolver, ruff_python_parser, ruff_linter ...) | Internal component crates, no stability promise (J4) | Only for a named consumer, with an exact pin and a contract test; never by range |

### 3.5 Embedded CPython

- Source: python-build-standalone 20261003, default CPython 3.12.15 (the py workspace baseline: `py/.python-version`,
  aphrody-train requires >=3.12,<3.13), 3.14.8 also qualified for the SDK matrix 3.11 to 3.14. The distributions
  for x86_64-unknown-linux-gnu require glibc 2.17 or newer (J8).
- Link inputs: the full archive of 3.14.8 was downloaded on the build host (sha256 equal to the release digest) and its
  PYTHON.json (version 8) read: `libpython_link_mode` is shared, both `libpython3.14.so.1.0` and the static
  `libpython3.14.a` are present, the core links `pthread`, `dl`, `util`, and an inittab object is provided
  (`build/Modules/config.o`) (J8). The 3.12.15 archives were not downloaded: their digests come from the release API,
  and the runtime tree digest equals the one pinned by uv.
- PyO3: version 0.29.3 (the version of the Aphrody lock) with `auto-initialize`; the deprecated `extension-module`
  feature is not used for embedding. PyO3 documents dynamic embedding as the easy mode and says static embedding is
  not first-class (needs `--export-dynamic` to import extension modules) (J10). Recommendation: shared libpython shipped
  next to the binary (decision D4); the prior art for static embedding, PyOxidizer, has no commit since 2024-12-24
  (J11).
- Free-threading: `abi3` wheels cannot be loaded by a free-threaded CPython; PyO3 0.29 adds `abi3t` (PEP 803,
  Python 3.15 and newer) and maturin >= 1.14 builds such wheels (J10). The SDK wheel stays `abi3-py311`; the free-threaded
  interpreter is not part of the first runtime (decision D5).
- Aphrody native module: the SDK wheel (`aphrody.aphrody_rust`, crate `crates/ai/rag-python`) is installed in the embedded
  interpreter like any wheel. `vu` does not link Aphrody crates, so the dependency direction stays Aphrody to `vu` (an
  artifact), never the reverse. Registering the module in the interpreter's inittab is a later optimisation.

### 3.6 Consumption by Aphrody

- Artifact: a directory per version, in the layout of the Yolo runtime SDK (`packages/engine/runtime`, function
  `verifyArtifact`): manifest.json listing every file with sha256 and size, `current` and `previous` links for rollback,
  verification before any use. Planned manifest schema `vu.runtime/1`: name, version, target, toolchain, the pins of
  vendor.json, the CLI major version, the list of files. Planned name: {name}-runtime-{version}-{sha8}-{target}.tar.zst.
- `yolo py`: already targets the `py/` workspace (`apps/yolo/cli/src/python.ts`). Phase P4 makes it prefer the verified
  `vu` artifact (`vu uv run`, `vu ruff check`, `vu uv build`) and fall back to the tools on PATH, then drops the fallback.
- Out of process by default: Aphrody and Yolo start `vu` as a child process (JSON receipts, exit codes). An in-process C ABI
  (`vu_*` exports in `aphrody-ffi`) is not planned: two language runtimes, two sets of threads and a GIL in one process
  need a measured need first (decision D3).

## 4. Pinning, import and the single name

### 4.1 Forks and pin branches (created 2026-10-05)

| Fork | Upstream | Pinned branch | Commit (release) | Crates.io `cargo_vcs_info` |
| --- | --- | --- | --- | --- |
| aphrody-labs/uv | astral-sh/uv | vu-pin-0.12.23 | 46b84fd0bfec23b72f29e8e2185ba68a65052f48 (uv 0.12.23) | uv 0.12.23, uv-* 0.0.90: same sha |
| aphrody-labs/ruff | astral-sh/ruff | vu-pin-0.16.10 | 3265ed1f944c98bb4c04d632fbefb1257cdb583d (ruff 0.16.10) | ruff 0.16.10, ruff_* 0.0.16, ty_python_semantic 0.0.16: same sha |
| aphrody-labs/pyo3 | PyO3/pyo3 | vu-pin-0.29.3 | 451d99fdcdcddf159e8e0a1186960b332cdb5d7c (tag v0.29.3) | pyo3 and pyo3-ffi 0.29.3: same sha |

The forks are public because GitHub creates forks of public repositories as public; they are created with
`default_branch_only`, so only `main` is mirrored and the pin branch holds the release commit. No Aphrody patch exists on
them. No `ir-pin-*` branch was ever created, so nothing was renamed or deleted remotely when the name changed.

Considered and not created: python-build-standalone (consumed as release assets), ty (inside the ruff tree), pubgrub,
tokio-tar, rs-async-zip, astral-tl and the reqwest forks (all published on crates.io and locked there by uv; the one
licence to watch is `astral-pubgrub`, MPL-2.0).

### 4.2 Pins and provenance

[scaffold/vendor.json](scaffold/vendor.json) is written like config/vendor.json (name, path, url, upstream, ref) and adds the
tag, the fork branch, the crates.io evidence, the workspace facts and the release assets with sha256.
config/upstream-sources.json carries the same facts as tier `build` references with `forkUrl`, `forkRef` and `forkCommit`
(ids `vu-uv`, `vu-ruff`, `vu-pyo3`, `vu-python-build-standalone`).
The gate `bun scripts/audit/workspace/vu-pins.ts` (tests: vu-pins.test.ts, 6 tests) checks both files against each other and
against the identity; `--online` also reads the fork branches and the upstream tags through `aphrody git api`.

### 4.3 Path dependencies, not crates.io (decision, verified feasible)

uv, ruff and PyO3 are consumed by path from the fetched fork checkouts under vendor/, so that a patch can be carried on a
fork branch; the workspace excludes vendor/ so the forks stay workspaces of their own. A probe workspace built from
scaffold/Cargo.toml.scaffold resolved `uv`, `ruff` and `pyo3` together into one lock of 804 packages on the build host
(J7). Consuming exact crates.io versions instead would work for uv and ruff (published, same commits) but not for
ty (unpublished crates) and would leave no place for patches; it stays the fallback.

### 4.4 Import in the manner of vendor.toml

Not needed by default: path dependencies need no copy or rename. A `vu import` (the `yolo import` machinery with a
vu.toml) is justified only if a crate must be renamed to avoid a name clash in a consumer's lock (for example the
unrelated crates.io package named `ty`, which already exists).

### 4.5 One name constant

scaffold/vu.json holds `name` and templates for every derived name (binary, package, runtime crate, environment prefix,
home directory, repository, fork pin branch, upstream-sources id, receipt schema, artifact name, Python module). The
procedure to rename the runtime: change `name`, regenerate the derived names, rename the repository and the fork pin
branches (create the new branch at the same commit, delete the old one), run the pins gate. The test of the gate proves
that a changed `name` makes the stale branch names and ids fail.

## 5. ABI, ownership and permission contracts

- Public interface: the `vu` CLI. `vu uv ...` and `vu ruff ...` keep the argument syntax, output and exit status of the
  pinned tools; `vu python ...` keeps the CPython command line. `vu --version --json` prints schema `aphrody.vu/1` with the
  versions of vu, uv, ruff, PyO3, CPython, the git revision and the target.
- Environment: prefix VU_ (from the identity). The runtime sets `UV_PYTHON_DOWNLOADS=never` and `UV_PYTHON_INSTALL_DIR` so
  the interpreter provenance is the pinned distribution, and never reads credentials; index credentials stay in the
  tool's own mechanism.
- Ownership: the pins and provenance belong to the Aphrody monorepo (config/upstream-sources.json); the build, the lock
  and the artifact belong to the `vu` repository; the Python product code and the SDK binding stay with `py/` and
  `crates/ai/rag-python`. `yolo py` is the only Aphrody consumer.
- Permissions: no implicit privileged host access for scripts or remote pages; `vu python` runs with the permissions of its
  caller; the runtime opens no network listener. uv's own network use (indexes, optional downloads) is the only network
  surface and is configured through uv.
- Panic and unwind: uv and ruff release profiles use `panic = "abort"`. PyO3 turns a Rust panic into a Python exception only
  with unwinding; under abort a panic ends the process. The `vu` binary follows the upstream choice (abort); the SDK wheel
  keeps unwinding. Any in-process Aphrody ABI (decision D3) must restate this contract first.
- Compatibility: package, library and crate identities are compatibility contracts: `aphrody-rust` and `aphrody_rust` do not
  change; the module `aphrody.aphrody_rust` and its stubs stay in the wheel.

## 6. Build, verification and release

### 6.1 Build host and measurements

- Built on the VPS under the factory locks (heavy lock, `scripts/build/rust/cargo-serial.sh`, sccache), jobs 1..6.
- Measured on 2026-10-05 with rustc 1.98.1 (the Aphrody pin, newer than the 1.97 minimum of uv and ruff and older than
  the 1.99.0 they pin in their own toolchain files), `cargo check --locked`, 4 jobs, nice 10, other agents sharing the host:
  uv 3 min 51 s (largest process 553 MB resident), ruff 1 min 32 s, the probe workspace of section 4.3 3 min 29 s.
  Not measured: release builds (fat LTO), peak memory of the whole build, the final binary size. The Bun precedent is
  902.8 s for a complete build (fusion plan, decision 6); it is not a prediction for vu.

### 6.2 glibc

Verified: WSL Ubuntu 24.04.5 has glibc 2.39, the build host Ubuntu 26.04.1 has 2.43; python-build-standalone supports
glibc 2.17 and newer. Bun showed that a host-built binary can import a few symbols versioned 2.43 (fusion plan, decision 5).
First build gate: read the version needs (`.gnu.version_r`) of the `vu` binary and of `libpython` and fail above 2.39. No
tool of the toolbox exposes them: `aphrody re triage` lists sections and imports but its output for the installed Bun binary
contains no `GLIBC_` string, so the gate is a small ELF reader in Bun (to write in P1). If a needed version is above 2.39,
define the few missing libm symbols in the fork as done for Bun, or build against an older sysroot. Unmeasured until the
first `vu` build.

### 6.3 Receipts

One JSON receipt per built revision, schema `aphrody.vu-forge/1`, in the shape of `aphrody.bun-forge/1` (revision, toolchain,
pinned sources, artifact path and sha256, smoke results of scaffold/vu-forge.json: versions of uv, ruff, CPython and a call of
the native module).

### 6.4 Generalising `yolo forge`

`yolo forge` embeds the Bun configuration. The change is to accept `--config <file>`; the planning code (scratch space,
commit queue, receipts) is reused, not copied, so there is no second forge.

## 7. Absorption order

| Phase | Content | State |
| --- | --- | --- |
| P0 | Inventory, native crate absorbed, `py/` deduplicated, name settled, forks pinned, plan and scaffold, provenance, pins gate | done 2026-10-05 |
| P1 | Decision D1; create the private repository `vu` from the scaffold; first gates there: lock, `cargo check -p vu`, pins gate | open |
| P2 | T0: build the pinned `uv` and `ruff` binaries and the `vu` launcher on the build host with receipts; runtime artifact and manifest; smoke; no activation | open |
| P3 | Embedded CPython: `vu-runtime`, link inputs from the full archive, `vu python` parity with `python`, the SDK wheel installed in the embedded interpreter | open |
| P4 | `yolo py` prefers the verified artifact; `py/` tools and `modernize_workspace.py` call `vu uv` and `vu ruff`; locks stay byte-compatible | open |
| P5 | Optional: T1 single-shot dispatch (needs the nested `$UV` patch) and T2 library crates for named consumers | open |
| P6 | Converge `packages/engine/python` and `crates/engine/yolo-pyo3` (second Python package and second PyO3 module crate) with the runtime; untrack the compiled `.so` | open |
| P7 | Installation and activation through Infra's catalog and runbook; never implied by a source change | open |

## 8. Risks

| Risk | Evidence | Mitigation |
| --- | --- | --- |
| Internal API drift of uv-* and ruff_* crates | Descriptions "internal component crate"; `uv::main` documentation (J4) | T0 first; exact pins; contract tests per consumer; forks to carry patches |
| `uv::main` sets `UV` to the current executable | Source of crates/uv/src/lib.rs (J4) | T0 avoids it; T1 needs a fork patch |
| glibc mismatch between build host and WSL | 2.43 against 2.39 (J9); MEMORY.md records a factory-built `aphrody-mcp` refused by WSL on 2026-10-05 | measure symbol versions on the first build; libm symbols or older sysroot |
| Build time and memory | check: 232 s and 92 s; release not measured (6.1) | factory locks, sccache, measure before any claim |
| Lock divergence if merged into the Aphrody lock | +477 registry packages, 285 of them second versions (J6) | external repository with its own lock |
| Licences | uv MIT OR Apache-2.0, ruff MIT, PyO3 MIT OR Apache-2.0, uv-pep440/508 Apache-2.0 OR BSD-2-Clause, astral-pubgrub and python-build-standalone MPL-2.0 (J1, J8); deny.toml already allows MPL-2.0 and BSD-2-Clause | ship notices in the artifact; keep MPL files unmodified or publish them with the artifact if distributed |
| A fresh lock is not the lock upstream tested | The probe lock resolved to the latest compatible versions of 804 packages (J7) | Seed the `vu` lock from the uv and ruff locks (precise updates), record the delta, run the upstream tests of the consumed crates in P2 |
| Static embedding is not first-class in PyO3 | PyO3 guide (J10) | shared libpython first |
| `extension-module` is deprecated upstream | PyO3 guide (J10); `crates/ai/rag-python` still enables it | drop the feature after a wheel build without it is verified on the build host (open item, not done here) |
| ty tree mismatch | ty 0.0.84 vendors ruff 11aaa39f, 107 commits behind the pin (J5) | decision D6; use the ruff pin or add a branch at 11aaa39f |
| Wheel size grew when the native crate moved to rag-core | `aphrody_rust.abi3.so` 790 160 bytes (old standalone crate) against 1 161 480 bytes (in-tree crate with the default features of rag-core) (J12) | gate the chunkers of rag-core behind a feature if the size matters; not done |
| Remote pages or scripts gaining host access through the runtime | Repository rule | permissions contract (section 5) |
| Forks are public | GitHub behaviour for forks of public repositories | no patch with private data; the `vu` repository stays private until the owner decides |

## 9. Decisions open for the owner

The name is settled (section 0). Defaults in brackets are what this plan assumes.

- D1 Repository: create `aphrody-labs/vu`, private, from the scaffold? [yes, when the owner confirms; not created]
- D2 Replace the `uv`, `ruff` and `maturin` binaries used by `py/`, `yolo py` and the SDK qualification by `vu uv` and `vu ruff`
  once P2 has a verified artifact? [yes; the lock files stay compatible because the uv version is pinned]
- D3 Integration beyond T0: single-shot in-process dispatch (T1), library crates for Rust consumers (T2), an in-process C ABI?
  [T0 only until a consumer is named]
- D4 libpython: shared next to the binary, or static? [shared]
- D5 Default interpreter and free-threading: 3.12.15 (py baseline) with 3.14.8 qualified; ship a free-threaded build? [3.12.15, no free-threaded build]
- D6 Include ty (from the ruff tree, pinned at the ruff release or at 11aaa39f for the ty 0.0.84 release)? [no, not before a consumer]
- D7 python-build-standalone: keep consuming the releases, or fork to rebuild with Aphrody flags? [consume]
- D8 Cargo dependency mode: path dependencies on the forks, or exact crates.io versions? [path]
- D9 Licence of `vu` itself and notice handling for the MPL-2.0 parts. [Apache-2.0, notices in the artifact]
- D10 Panic strategy of the `vu` binary: abort (as uv and ruff) or unwind? [abort]

## 10. Staged follow-ups from the py fusion

Not edited by the fusion batches because they are host and factory catalog entries (Infra plans before it applies):
the former repository `aphrody-py` is still wired into config/update/pins.json, config/google-stack-release.json,
config/docs/documentation.json, config/github/templates.json, config/ai/agent-plugin-providers.json, config/deps/watch.json,
config/build-factory.json, config/host/toolchain.json, config/commit-sync.json, the systemd unit catalog
(source-sync `--repo aphrody-py`), scripts/dev/bootstrap and clone-and-bootstrap, scripts/tools/shell/setup, and the root
GOAL.md. Also staged: the nested `py/package.json` workspace identity, `py/tools/workspace` (not resolvable by Bun
without an install of the Aphrody workspace), the SDK-archive channel `py/config/sibling-checkouts.json`, the legacy
Infra dispatcher `py/tools/infra/scripts/python-workspace-dispatch.py`, and the tracked compiled extension of
`packages/engine/python`.

## 11. Verification journal (2026-10-05)

Reproducible with `aphrody git api`, the crates.io API (HTTP, User-Agent set), the build host through `aphrody infra ssh exec`
and Bun scripts; raw outputs were kept in the session scratch space and are summarised here.

| ID | Fact | Source and method | Result |
| --- | --- | --- | --- |
| J1 | Releases and commits | GitHub API `releases/latest` and `commits/<tag>` for uv, ruff, ty, PyO3, python-build-standalone | uv 0.12.23 `46b84fd0` (2026-10-03); ruff 0.16.10 `3265ed1f` (2026-10-01); ty 0.0.84 `8dd9a7f7` (2026-09-24); PyO3 v0.29.3 `451d99fd` (2026-09-30); python-build-standalone 20261003 `5e46737f` (2026-10-03) |
| J2 | Crates.io builds come from those commits | Download of the packages, read of `.cargo_vcs_info.json` | uv 0.12.23 and uv-resolver 0.0.90: `46b84fd0`; ruff 0.16.10, ruff_python_parser 0.0.16 and ty_python_semantic 0.0.16: `3265ed1f`; pyo3 and pyo3-ffi 0.29.3: `451d99fd`; astral-pubgrub 0.6.1: `233ec983` (repository astral-sh/pubgrub) |
| J3 | Lock contents | `Cargo.lock` of uv 0.12.23 and ruff 0.16.10 parsed with `Bun.TOML` | uv: version 4, 737 packages = 664 registry + 73 path + 0 git; ruff: 558 = 505 + 53 + 0; no pyo3 in either, no ruff in uv; `astral-*` all `registry+crates.io` |
| J4 | Library entry points and stability | Source of crates/uv/src/lib.rs and crates/ruff/src/lib.rs at the pins; crates.io descriptions | `pub unsafe fn main<I,T>(args: I) -> ExitCode` documented "not recommended for external consumption", single call, sets `UV`; `pub fn run(Args) -> Result<ExitStatus>` in ruff, sets a panic hook; all uv-* and ruff_* crates described "an internal component crate" |
| J5 | Library or binary, published or not | Git trees at the pins (`src/lib.rs`, `src/main.rs`, `src/bin/`) and crates.io lookup of every crate | uv: 74 crates = 68 lib + 5 lib+bin + 1 bin; 71 published (unpublished: uv-bench, uv-dev, uv-trampoline); ruff: 53 = 47 lib + 3 lib+bin + 3 bin; 40 published; ty crates unpublished: ty (0.0.0, publish = false, name taken on crates.io by another owner), ty_project, ty_ide, ty_server, ty_test, ty_wasm; ty 0.0.84 submodule ruff `11aaa39f` is 107 commits behind `3265ed1f` |
| J6 | Lock overlap with Aphrody | Comparison of registry packages with the Aphrody `Cargo.lock` (2 721 packages, 2 468 from a registry) | uv 664: 394 identical, 165 other version, 105 absent; ruff 505: 225 identical, 168 other version, 112 absent; union of both 943 distinct name@version: 466 identical, 285 other version of a locked crate, 192 new crates |
| J7 | Feasibility on the build host | `cargo check --locked --manifest-path ... -p <crate>` through `cargo-serial.sh` under the heavy lock, rustc 1.98.1, 4 jobs; probe workspace from scaffold/Cargo.toml.scaffold with path dependencies on shallow clones of the three pin branches and a `vu` binary calling `uv::main`, `ruff::run` and `Python::attach` | uv: exit 0, 3 min 51 s; ruff: exit 0, 1 min 32 s; probe: `cargo generate-lockfile` locked 804 packages (latest compatible versions, not the upstream locks) and `cargo check --locked -p vu` exited 0 in 3 min 29 s with one warning (`Python::version` is deprecated in PyO3 0.29.3, use `version_str`) |
| J8 | python-build-standalone | Release API (897 assets; CPython 3.10.22, 3.11.17, 3.12.15, 3.13.16, 3.14.8, 3.15.0rc3); docs `running.rst`, `distributions.rst`; full archive of 3.14.8 downloaded and hashed on the build host; uv's `download-metadata.json` at the pin | sha256 of the 3.14.8 full archive equals the release digest; PYTHON.json version 8, `libpython_link_mode` shared, `libpython3.14.a` and `libpython3.14.so.1.0` present, links pthread dl util; install_only_stripped sha256 equals uv's pin for 3.12.15 and 3.14.8; minimum glibc 2.17 |
| J9 | glibc | `/etc/os-release` and the runtime report on WSL; `ldd --version` on the build host | WSL Ubuntu 24.04.5, glibc 2.39; build host Ubuntu 26.04.1, glibc 2.43 |
| J10 | PyO3 0.29.3 guide | Guide sources at the tag (features, building-and-distribution, free-threading) | `extension-module` deprecated (use maturin >= 1.9.4); `auto-initialize`; static embedding not first-class; `abi3` wheels not loadable by free-threaded CPython; `abi3t` (PEP 803) from 3.15, maturin >= 1.14; modules assumed thread-safe since 0.28 |
| J11 | Prior art | GitHub API | indygreg/PyOxidizer last pushed 2024-12-24, no astral-sh/PyOxidizer (404) |
| J12 | The wheel built from the monorepo crate | `uv build --wheel` on the build host (maturin 1.14.1, rustc 1.98.1), installed-wheel verification (`py/tools/sdk/verify-wheel.py`, Python 3.14.4) | wheel 788 600 bytes with the CycloneDX SBOM; extension 1 161 480 bytes (old standalone crate: 790 160); 514 SDK tests passed, 31 skipped; `py/tools/packaging/qualify_aphrody.py` passed |
| J13 | Forks and pins | `POST /forks` (202) and `POST /git/refs` (201); `scripts/audit/workspace/vu-pins.ts --online`; shallow clones of the pin branches on the build host | three forks, three branches, all at the pinned commits; heads of the clones equal the pins |
| J14 | Names | `aphrody-labs/vu`, `uv`, `ruff`, `pyo3` before creation | uv, ruff, pyo3 were absent (404) and are now forks; `vu` is absent and is not created |

## 12. Checklist

- [x] Inventory of `py/` against the monorepo.
- [x] Native crate absorbed into `crates/ai/rag-python`; wheel built and verified on the build host (J12).
- [x] `py/` deduplicated; follow-ups listed (section 10).
- [x] Runtime name settled by the owner: `vu`; one constant.
- [x] Forks created and pinned: uv `vu-pin-0.12.23`, ruff `vu-pin-0.16.10`, pyo3 `vu-pin-0.29.3`.
- [x] Provenance in config/upstream-sources.json; pins gate and tests.
- [x] Feasibility: `cargo check` of uv and ruff at the pins; one lock for the three.
- [ ] D1 to D10 answered by the owner.
- [ ] Repository `vu` created from the scaffold (after D1).
- [ ] First `vu` build with a receipt; glibc symbol audit; release build time and memory measured.
- [ ] Runtime artifact, manifest and rollback links; `yolo py` consumes it.
- [ ] Embedded CPython parity test (`vu python` against `python`) and the SDK wheel smoke inside it.
- [ ] Installation and activation through Infra (never claimed from source alone).
