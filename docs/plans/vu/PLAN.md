<!-- SPDX-License-Identifier: Apache-2.0 -->
# `vu`: the Aphrody Python runtime

Date: 2026-10-05. Status: forks created and pinned, private repository `aphrody-labs/vu` created, every decision settled
(section 9, `tranché`), execution in bounded batches (section 7). Every "verified" below names its source in the journal
(section 11); everything else is labelled as a decision or as unverified.

## 0. Owner request and name

Owner request (verbatim, French): « absorbe py/packages/aphrody/native et fusionne nativement py à aphrody et
déduplique vraiment aphrody et py via un sub agent qui intègre uv et pyo3 direct au coeur d'aphrody comme on fait
pour bun avec un monorepo externe avec les crates rust astral sœurs de uv + uv et ruff et pyo3 pour avoir notre
runtime du nom de « ir » l'inverse de uv ».

Name: **`vu`**, the literal inverse of `uv`, settled by the owner on 2026-10-05. The request first wrote « ir »; that
wording is abandoned and no open decision on the name remains. The name is written once, in
[scaffold/vu.json](scaffold/vu.json); every other name (binary, packages, variables, fork branches, receipt schema) is a
template over it (section 4.5).

Owner order of 2026-10-05 (yolo mode): every open decision is settled by the executing agent, without asking, and carried
out in bounded batches; the monorepo is multi-licensed, so a licence never blocks a choice. Guardrails kept: no public
publication, no deletion outside the repository, Cargo only through `vps-cargo`, only owned paths staged, no new public
repository.

Batches already delivered (commits on `workspace/main`): inventory
[INVENTORY-py-vs-aphrody.md](INVENTORY-py-vs-aphrody.md) (`a90c757ee`), absorption of the native crate into
`crates/ai/rag-python` (`47d2681b5`), deduplication of `py/` (`0e57c2a8c`), rename to `vu` (`0cd1df3a8`), forks, pins,
provenance and the first plan (`be67fd6e2`).

## 1. Goal

One runtime, `vu`, built outside the Aphrody monorepo from pinned forks of uv and ruff, PyO3 and a prebuilt CPython,
and consumed by Aphrody as a precompiled runtime/SDK, exactly like Bun (fork `aphrody-labs/bun`) is consumed through
Yolo:

- `vu uv ...` and `vu ruff ...`: the pinned uv resolver, installer and Python manager, and the pinned ruff linter and
  formatter;
- `vu python ...`: an embedded CPython (python-build-standalone) driven through PyO3, in the same process;
- `yolo py` and `vu` unified: `yolo py` resolves and verifies the `vu` artifact and uses its pinned tools; the direct use
  of the `uv`, `ruff` and `maturin` binaries found on PATH remains only as a fallback until activation.

The Python product code stays in `py/` (a thin Python layer over the Rust runtime); the Rust binding of the SDK stays in
`crates/ai/rag-python`.

## 2. Verified starting point

| Fact | Consequence |
| --- | --- |
| uv 0.12.23, ruff 0.16.10 and PyO3 0.29.3 are the current releases; the crates.io packages carry the release commit in `.cargo_vcs_info.json` (J1, J2). | The pins are exact and checkable offline from crates.io as well as from GitHub. |
| The `Cargo.lock` of uv (737 packages) and of ruff (558) contain no git source, no PyO3, and uv does not depend on ruff (J3). | The instruction to pin ruff and PyO3 "at what uv's lock uses" has no object; they are pinned at their own releases. All Astral sister crates (`astral-*`) come from crates.io. |
| uv-* and ruff_* crates are published but described as internal components; the supported interface of uv is its CLI, and `uv::main` is documented as not recommended for external consumption and callable once per process (J4). | Library use is an unstable internal API; the CLI is the contract. |
| 5 of the ty crates that a consumer would need are not published (ty_project, ty_ide, ty_server, ty_test, ty_wasm) and the ty crate is version 0.0.0 with publish = false (J5). | ty can only be built from the ruff tree; no separate ty fork is needed. |
| Merging uv and ruff into the Aphrody `Cargo.lock` would add 477 registry packages: 192 new crates and 285 second versions of crates already locked (J6). | External monorepo with its own lock, as for Bun. |
| `cargo check --locked -p uv` and `-p ruff` succeed at the pins with the Aphrody toolchain 1.98.1 on the build host; a probe binary that calls `uv::main`, `ruff::run` and the PyO3 embedding API type-checks in one workspace of 804 locked packages (J7). | The toolchain is sufficient and library linking is possible; it is not needed for the first tier. |
| python-build-standalone release 20261003 ships CPython 3.12.15 and 3.14.8 for x86_64-unknown-linux-gnu, with a shared and a static libpython in the full archive (J8). | The embedded interpreter has a verified source; the py workspace baseline (3.12) is available. |
| The WSL host has glibc 2.39 and the build host has glibc 2.43 (J9). | A binary built on the build host may not start in WSL; this is measured on every build (section 6.2). |
| The build host cannot read private GitHub repositories (its git credential helper is missing; J14). | A private repository is built from a snapshot pushed over the SSH master, as `vps-cargo` does, not from GitHub. |

## 3. Architecture

### 3.1 The Bun precedent, mirrored

| Bun / Yolo | Python / `vu` |
| --- | --- |
| Fork aphrody-labs/bun, branch `main` = upstream + patches, pin in config/vendor.json | Forks aphrody-labs/uv, ruff, pyo3, one branch per release `vu-pin-<version>` at the release commit, pins in vendor.json |
| Planned repository `yolo` holding vendor/bun, built on the VPS | Private repository aphrody-labs/vu (created 2026-10-05) holding vendor/{uv,ruff,pyo3}, built on the VPS |
| bun-forge, `yolo forge`, config/bun-forge.json, receipts `aphrody.bun-forge/1` | Receipts `aphrody.vu-forge/1` written by the build scripts of the vu repository, driven through `vps-cargo --repo vu` (no second forge, no `yolo forge` generalisation: D13) |
| `scripts/tools/vendor/bun_upstream_sync.ts`, merge of upstream/main, never forced | Pins move by release tag (a new branch `vu-pin-<version>`), never by merge of main |
| Provenance in config/upstream-sources.json | Entries vu-uv, vu-ruff, vu-pyo3, vu-python-build-standalone (added, section 4.2) |
| Yolo runtime SDK: artifact directory with manifest.json, current/previous links, verified before load | `vu` runtime artifact with the same layout and verification (section 3.6) |
| `yolo import` and vendor.toml for the Tauri forks | Not needed: no crate is copied or renamed (section 4.4) |

### 3.2 Repositories

- Aphrody monorepo (this repository): products, `py/`, the SDK binding `crates/ai/rag-python`, the pins and provenance
  (config/upstream-sources.json, the mirror in [scaffold/](scaffold/README.md)), `yolo py`. It never builds uv, ruff or
  CPython.
- Private repository `aphrody-labs/vu` (created 2026-10-05): the workspace that builds, links and packages the runtime,
  its build scripts and receipts.
- Forks (created): aphrody-labs/uv, aphrody-labs/ruff, aphrody-labs/pyo3 (section 4.1).
- Not forked: python-build-standalone (release assets pinned by sha256), maturin (PyPI build backend, pinned
  `maturin==1.14.1` by the SDK), astral-sh/ty (its code is in the ruff tree), astral-sh/pubgrub and the other `astral-*`
  crates (from crates.io at the versions of uv's lock). A fork is created when a patch exists, not before (D11).

### 3.3 Layout of the external monorepo

```text
vu/
  Cargo.toml  Cargo.lock  rust-toolchain.toml     workspace and lock of the runtime only (PyO3, no other dependency)
  .cargo/config.toml                               PYO3_CONFIG_FILE for the pinned CPython (written by fetch)
  vu.json  vendor.json                             name constant and pins (mirrored in the Aphrody scaffold)
  vendor/uv  vendor/ruff  vendor/pyo3              fetched, shallow, git-ignored (not submodules)
  crates/vu                                        the binary: launcher of the uv and ruff sidecars, vu python
  crates/vu-runtime                                embedded CPython through PyO3, pure launcher helpers
  scripts/                                         Bun: fetch, assemble, manifest, glibc audit, smoke, forge (+ tests)
  receipts/                                        one JSON receipt per build
```

### 3.4 Integration tiers (tranché: T0)

| Tier | What | Upstream support | Verdict |
| --- | --- | --- | --- |
| T0 | `vu` ships the unmodified `uv` and `ruff` binaries, built from the pins with their own upstream locks, in the runtime directory and execs them; the CLI is the public interface of both tools | Fully supported interface | **Tranché (D3): the only tier now.** No coupling to internal crates; `uv run` re-invoking `$UV` keeps working because the real binary is the one that sets it |
| T1 | `vu uv ...` calls `uv::main` and `vu ruff ...` calls `ruff::run` in the same process | `uv::main` is "not recommended for external consumption"; assumes it controls the process, may be called once, is `unsafe` (no other thread running) and sets `UV` to the current executable (J4); `ruff::run` installs a global panic hook | Rejected for now: needs a fork patch for nested `$UV` calls and gives no capability T0 lacks |
| T2 | Aphrody Rust code links individual library crates (uv-pep440, uv-pep508, uv-resolver, ruff_python_parser, ruff_linter ...) | Internal component crates, no stability promise (J4) | Only for a named consumer, exact pin, contract test; none exists |

### 3.5 Embedded CPython (tranché)

- Source (D5, D7): python-build-standalone 20261003, default CPython 3.12.15 (the py workspace baseline:
  py/.python-version, aphrody-train requires >=3.12,<3.13), 3.14.8 also pinned for the SDK matrix 3.11 to 3.14. The
  gnu distributions require glibc 2.17 or newer (J8). The first artifact carries 3.12.15 only.
- Link inputs (J8): the full archive of 3.14.8 was downloaded on the build host (sha256 equal to the release digest) and
  its PYTHON.json (version 8) read: `libpython_link_mode` is shared, `libpython3.14.so.1.0` and the static
  `libpython3.14.a` are present, the core links `pthread`, `dl`, `util`. The same layout is assumed for 3.12.15 and checked
  by the build (the build fails if `lib/libpython3.12.so.1.0` is missing).
- Link mode (D4): shared, the runtime directory carries `lib/libpython3.12.so.1.0` and the binary an `$ORIGIN/../lib`
  runpath. PyO3 documents dynamic embedding as the easy mode and static embedding as not first-class (J10); the prior art
  for static embedding, PyOxidizer, has no commit since 2024-12-24 (J11).
- PyO3 (D8): version 0.29.3 (the version of the Aphrody lock), `auto-initialize`; the deprecated `extension-module` feature
  is not used for embedding. The fork checkout is a path dependency of the `vu` workspace.
- `vu python ...` runs `Py_BytesMain` (exported by `pyo3-ffi` 0.29.3) in the `vu` process with `argv[0]` set to the
  runtime's own bin/python3.12, so `sys.executable`, `sys.prefix` and every subprocess behave like the standalone
  interpreter. The parity gate compares the output of both on the same scripts.
- Free-threading (D5): `abi3` wheels cannot be loaded by a free-threaded CPython; PyO3 0.29 adds `abi3t` (PEP 803, Python
  3.15 and newer) and maturin >= 1.14 builds such wheels (J10). The SDK wheel stays `abi3-py311`; no free-threaded
  interpreter ships.
- Aphrody native module: the SDK wheel (`aphrody.aphrody_rust`, crate `crates/ai/rag-python`) is installed in the
  interpreter like any wheel (the build smoke installs it with the runtime's own `uv`). `vu` does not link Aphrody crates, so
  the dependency direction stays Aphrody to `vu` (an artifact), never the reverse.

### 3.6 Consumption by Aphrody (tranché)

- Artifact: the python-build-standalone install tree of the default interpreter is the prefix; the build adds bin/vu,
  bin/uv, bin/ruff and `share/vu/manifest.json`. Layout on a host, as for the Yolo runtime SDK
  (`packages/engine/runtime`, `verifyArtifact`): `$VU_HOME/runtime/<target>/<version>-<hash8>/`, with `current` and
  `previous` links for rollback; default `$VU_HOME` is `~/.vu`. The manifest (schema 1, name `vu-runtime`) lists every
  file with its sha256 and size, the target, the toolchain, the revisions of the vu repository and the pins, and
  `compatibility.cliMajor`.
- `yolo py` (D2, implemented in apps/yolo/cli/src/vu.ts and python.ts, commit `caa20e186`): resolves the active artifact
  (`$VU_HOME`, or `--vu <dir>` for one directory), verifies the manifest, the target, the CLI major and the sha256 of
  bin/vu, bin/uv and bin/ruff (`--vu-full`: every file), and runs `uv` and `ruff` from the artifact's bin/ with it first in
  PATH; without an artifact it falls back to the tools on PATH and says so in `yolo py status`; a damaged artifact is
  refused with exit status 3 (`--no-vu` selects the PATH tools explicitly). The py gates themselves keep calling `uv` by name: activation puts the artifact's `bin/` first in
  PATH, so the pinned uv is used without a change in `py/`; the lock files stay compatible because the uv version is the one
  already in use (0.12.23).
- Out of process (D12): Aphrody and Yolo start `vu` as a child process (JSON receipts, exit codes). There is no in-process
  C ABI and no `vu_*` export in `aphrody-ffi`.

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

Considered and not created (D11): python-build-standalone (consumed as release assets), ty (inside the ruff tree), pubgrub,
tokio-tar, rs-async-zip, astral-tl and the reqwest forks (all published on crates.io and locked there by uv).

### 4.2 Pins and provenance

[scaffold/vendor.json](scaffold/vendor.json) is written like config/vendor.json (name, path, url, upstream, ref) and adds the
tag, the fork branch, the crates.io evidence, the workspace facts and the release assets with sha256; the same file is
the build input of the vu repository. config/upstream-sources.json carries the same facts as tier `build` references with
`forkUrl`, `forkRef` and `forkCommit` (ids `vu-uv`, `vu-ruff`, `vu-pyo3`, `vu-python-build-standalone`).
The gate `bun scripts/audit/workspace/vu-pins.ts` (tests: vu-pins.test.ts) checks both files against each other and the
identity; `--online` also reads the fork branches and the upstream tags through `aphrody git api`; `--vu <checkout>`
checks that the private repository's vendor.json and vu.json are byte-identical to the mirror kept here.

### 4.3 Dependency modes (tranché, D8)

- Sidecars (T0): uv and ruff are built from their own fork checkouts with `--locked`, that is with the dependency set their
  maintainers lock and test. This removes the main weakness of a merged workspace: the probe workspace of J7 resolved 804
  packages to the latest compatible versions, not to the upstream locks.
- The `vu` workspace itself depends on PyO3 by path from the fork checkout (a patch can be carried on the fork branch) and
  on nothing else beyond the standard library and `pyo3-ffi`. The vendor directory is excluded from the workspace so the forks
  stay workspaces of their own.
- Library path dependencies on uv and ruff are deferred with T1 and T2 (the probe of J7 proves they type-check).

### 4.4 No import step

No crate is copied or renamed, so no `vu import` (the vendor.toml machinery) exists. If a name clash ever requires a
renamed crate (for example the unrelated crates.io package named `ty`), the machinery of `yolo import` is reused then.

### 4.5 One name constant

scaffold/vu.json holds `name` and templates for every derived name (binary, package, runtime crate, environment prefix,
home directory, repository, fork pin branch, upstream-sources id, receipt schema, artifact name, Python module). The
procedure to rename the runtime: change `name`, regenerate the derived names, rename the repository and the fork pin
branches (create the new branch at the same commit, delete the old one), run the pins gate. The test of the gate proves
that a changed `name` makes the stale branch names and ids fail.

## 5. ABI, ownership and permission contracts (tranché, D12)

- Public interface: the `vu` CLI and the artifact manifest. `vu uv ...` and `vu ruff ...` keep the argument syntax, output and
  exit status of the pinned tools; `vu python ...` keeps the CPython command line. `vu --version --json` prints schema
  `aphrody.vu/1` with the versions of vu, uv, ruff, PyO3, CPython, the revision and the target. The manifest schema is
  `1` with `compatibility.cliMajor`; a consumer refuses another major.
- Environment: prefix VU_ (from the identity): `VU_HOME` (artifact store), `VU_RUNTIME` (the prefix of the running
  artifact, set by `vu` for its children). The runtime does not read credentials; index credentials stay in the tool's own
  mechanism.
- Ownership: the pins and provenance belong to the Aphrody monorepo (config/upstream-sources.json); the build, the lock and
  the artifact belong to the `vu` repository; the Python product code and the SDK binding stay with `py/` and
  `crates/ai/rag-python`. `yolo py` is the only Aphrody consumer.
- Permissions: no implicit privileged host access for scripts or remote pages; `vu python` runs with the permissions of its
  caller; the runtime opens no network listener. uv's own network use (indexes, optional downloads) is the only network
  surface and is configured through uv.
- Panic and unwind (D10): uv and ruff release profiles use `panic = "abort"`; the `vu` binary follows (abort), and PyO3
  cannot turn a Rust panic into a Python exception under abort. The SDK wheel keeps unwinding. Any in-process Aphrody ABI
  would have to restate this contract first (none exists).
- Compatibility: package, library and crate identities are compatibility contracts: `aphrody-rust` and `aphrody_rust` do not
  change; the module `aphrody.aphrody_rust` and its stubs stay in the wheel.

## 6. Build, verification and release

### 6.1 Build host and measurements

- Built on the VPS under the factory locks (heavy lock, `scripts/build/rust/cargo-serial.sh`, sccache) through `vps-cargo`
  (D13), which snapshots the exact worktree of the vu repository and pushes it over the SSH master.
- Measured on 2026-10-05 with rustc 1.98.1 (the Aphrody pin, newer than the 1.97 minimum of uv and ruff and older than the
  1.99.0 they pin in their own toolchain files), `cargo check --locked`, 4 jobs, nice 10, other agents sharing the host:
  uv 3 min 51 s (largest process 553 MB resident), ruff 1 min 32 s, the probe workspace 3 min 29 s. Release builds are
  measured by the batches of section 7 (results there).

### 6.2 glibc

Verified: WSL Ubuntu 24.04.5 has glibc 2.39, the build host Ubuntu 26.04.1 has 2.43; python-build-standalone supports
glibc 2.17 and newer; MEMORY.md records a factory-built `aphrody-mcp` refused by WSL on 2026-10-05. Every build runs
a small ELF reader (scripts of the vu repository; no tool of the toolbox exposes version needs: `aphrody re triage` lists
sections and imports but its output for the installed Bun binary contains no `GLIBC_` string) that lists the version needs
(`.gnu.version_r`) of each executable and shared library of the artifact and writes the highest into the receipt. A need
above 2.39 is a finding recorded in the receipt, not a hidden failure; the remedies are the libm symbols defined in the fork
as done for Bun, or an older sysroot.

### 6.3 Receipts

One JSON receipt per built revision, schema `aphrody.vu-forge/1`, in the shape of `aphrody.bun-forge/1`: revision,
toolchain, pinned sources, per-step durations, artifact path and sha256, glibc audit, smoke and parity results.

### 6.4 No `yolo forge` generalisation (tranché, D13)

`yolo forge` is tied to the Bun build (LLVM, cmake and rustup bootstrap). The runtime is plain Cargo plus an archive
pipeline already covered by the factory locks, so the build is `vps-cargo run --repo vu -- build ...` for each Cargo step and a
Bun assemble script for the rest. `vps-cargo` gains a generic `--repo` option (one entry per external repository in
config/host/vps-cargo.json); no second build mechanism is added.

## 7. Absorption order and execution

| Phase | Content | State |
| --- | --- | --- |
| P0 | Inventory, native crate absorbed, `py/` deduplicated, name settled, forks pinned, plan, provenance, pins gate | done 2026-10-05 |
| P1 | Decisions settled (section 9); private repository `aphrody-labs/vu` created | done 2026-10-05 |
| P2 | `vps-cargo --repo` (done, `445a854fd`); repository seeded and pushed (private, `f9d6b3d`, `6de8f0d`: launcher, embedding, Bun scripts with 19 tests); T0 build on the build host: `uv`, `ruff`, `vu`, artifact, glibc audit, smoke, receipt; no activation | done 2026-10-05: receipt `7c3db189` of the `vu` repository (`df8a358`): uv 94 s, ruff 159 s, vu 161 s, tests 508 s, clippy 54 s, assemble 7 s, smoke 12 s; artifact `0.1.0-7c3db189`, 3 491 files, 1 049 links, 187 MB; glibc ceiling 2.39 (J15); no activation |
| P3 | `vu python` (embedded CPython) parity and the SDK wheel smoke inside the runtime | done 2026-10-05: the smoke of the receipt proves `vu python` parity (sys.version, prefix, executable, path, extension modules), exit status and stdin, and the SDK wheel (`aphrody.aphrody_rust.cosine_similarity` returned 1.0 inside `vu python`) (J15) |
| P4 | `yolo py` resolves and verifies the artifact, falls back to PATH | done 2026-10-05 (`caa20e186`, 17 tests); no artifact is installed, so the PATH fallback is the active mode |
| P5 | Installation and activation through Infra's catalog and runbook; never implied by a source change | open (not executed here) |
| P6 | Converge `packages/engine/python` and `crates/engine/yolo-pyo3` (second Python package and second PyO3 module crate) with the runtime; untrack the compiled `.so` | done 2026-10-06: the compiled `_yolo_native` extension is untracked and ignored; the two bindings stay separate by design (D17) |

Execution order is the table order; each batch is committed and pushed (aphrody monorepo and, from P2, the private `vu`
repository) before the next starts.

## 8. Risks

| Risk | Evidence | Mitigation |
| --- | --- | --- |
| Internal API drift of uv-* and ruff_* crates | Descriptions "internal component crate"; `uv::main` documentation (J4) | T0 only (D3): the CLI is the contract; exact pins; forks to carry patches |
| glibc mismatch between build host and WSL | 2.43 against 2.39 (J9); MEMORY.md records a factory-built binary refused by WSL | audit in every receipt (6.2); libm symbols or older sysroot if needed |
| Build time and memory | check: 232 s and 92 s; release build times measured in P2 (J15); peak memory not measured | factory locks, sccache; results recorded in the plan |
| Release builds hold the heavy lock | Other agents wait for the lock up to 1 800 s | each Cargo step is a separate job, so the lock is released between steps |
| Toolchain deviation | uv and ruff pin 1.99.0 upstream; the build uses 1.98.1 (their MSRV is 1.97) | checked compile (J7); the receipt records the toolchain |
| Licences | uv MIT OR Apache-2.0, ruff MIT, PyO3 MIT OR Apache-2.0, uv-pep440/508 Apache-2.0 OR BSD-2-Clause, astral-pubgrub and python-build-standalone MPL-2.0 (J1, J8) | recorded; not a blocking criterion (owner: the monorepo is multi-licensed); notices ship in the artifact |
| Static embedding is not first-class in PyO3 | PyO3 guide (J10) | shared libpython (D4) |
| `extension-module` is deprecated upstream | PyO3 guide (J10); `crates/ai/rag-python` still enables it | drop the feature after a wheel build without it is verified on the build host (open item) |
| ty tree mismatch | ty 0.0.84 vendors ruff 11aaa39f, 107 commits behind the pin (J5) | ty is not shipped (D6) |
| Wheel size grew when the native crate moved to rag-core | `aphrody_rust.abi3.so` 790 160 bytes (old standalone crate) against 1 161 480 bytes (in-tree crate with the default features of rag-core) (J12) | gate the chunkers of rag-core behind a feature if the size matters; not done |
| Remote pages or scripts gaining host access through the runtime | Repository rule | permissions contract (section 5) |
| Forks are public | GitHub behaviour for forks of public repositories | no patch with private data; the `vu` repository stays private |

## 9. Décisions tranchées (2026-10-05)

Settled by the executing agent on the owner's order of 2026-10-05; each carries its reason.

| ID | Question | Tranché | Reason |
| --- | --- | --- | --- |
| D1 | Repository name and visibility | `aphrody-labs/vu`, private, created 2026-10-05 and seeded by batch P2 | The Bun precedent (external build, own lock); 477 extra registry packages stay out of the Aphrody lock (J6); private because nothing is authorised for publication |
| D2 | Replace the `uv` binary use in `py/`? | Yes, through activation: `yolo py` resolves and verifies the artifact; the artifact's `bin/` first in PATH makes every py gate use the pinned uv; PATH tools remain the fallback until P5 | No change in `py/` is needed and the uv version (0.12.23) is the one already in use, so locks stay compatible; rollback is the `previous` link |
| D3 | Integration tier | T0 only (sidecar binaries); T1, T2 and an in-process C ABI rejected for now | The CLI is upstream's public interface; `uv::main` is single-shot, `unsafe` and sets `UV`; the crates are internal (J4) |
| D4 | libpython | Shared, shipped in the artifact, `$ORIGIN/../lib` runpath | First-class in PyO3; static embedding is not (J10), and the shared library is in the distribution (J8) |
| D5 | Default interpreter, free-threading | 3.12.15 default (py baseline), 3.14.8 pinned for the matrix; no free-threaded build | `py/.python-version` and aphrody-train `<3.13`; abi3 wheels do not load in free-threaded builds (J10) |
| D6 | ty | Not shipped | Unpublished crates, version 0.0.0, no consumer; it can be built from the ruff pin later without a fork |
| D7 | python-build-standalone | Consume release 20261003, pinned by sha256 (3.12.15 and 3.14.8); no fork | The distributions are prebuilt and verified (J8); a fork would only rebuild what upstream already ships |
| D8 | Cargo dependency mode | Sidecars from their own locks (`--locked`); the vu workspace depends on PyO3 by path from the fork | Upstream-tested dependency sets; a merged workspace resolved 804 packages to latest compatible versions (J7) |
| D9 | Licence | Apache-2.0 for the code of `vu`; third-party notices (including MPL-2.0 parts) ship in the artifact; no licence blocks any choice | Owner order: the monorepo is multi-licensed |
| D10 | Panic strategy | Abort for the `vu` binary (as uv and ruff); unwind stays in the SDK wheel | Upstream release profiles; no in-process ABI exists to restate |
| D11 | Forks to create | None beyond uv, ruff and pyo3 | Every other Astral crate is on crates.io at the versions uv locks; a fork is created with its first patch |
| D12 | ABI | The CLI and the manifest schema 1 (`compatibility.cliMajor`); no C ABI | Out-of-process keeps two language runtimes and their threads apart; panic contract (D10) stays trivial |
| D13 | Build host and forge | VPS under the factory locks through `vps-cargo --repo vu`; Bun assemble scripts in the vu repository; `yolo forge` untouched | The VPS cannot read private repositories (J14), `vps-cargo` already pushes snapshots over SSH; the Bun forge is bound to the Bun toolchain |
| D14 | What stays Python product code | Everything unique under py/packages, py/apps, py/docs, py/uv.lock and the Python packaging qualification tools; the Rust-owned parts (binding, kernels) are not Python | Inventory: no Rust counterpart with parity evidence; thin adapters already delegate arithmetic to `aphrody_rust` |
| D15 | py/tools/workspace (Bun supervisor) | Stays until the Yolo runtime SDK is installable in this checkout, then moves into `yolo py` | It is the bounded supervisor built on `@aphrody/runtime-sdk`; its tests cannot run here without an installed workspace, so a rewrite would be unverified |
| D16 | Order of absorption | Section 7, table order | Each phase needs the previous artifact |
| D17 | Converge `yolo-pyo3` with `rag-python`? | No: two modules stay (`yolo._yolo_native` over `yolo-core`, `aphrody.aphrody_rust` over `aphrody-rag-core`); both take PyO3 from `workspace.dependencies` (0.29.3); the compiled extension of `packages/engine/python` is untracked | Different capability owners and different wheels; a merged module would couple the Yolo engine release to the RAG kernels; the only duplication was the committed build output |

## 10. Staged follow-ups from the py fusion

Not edited by the fusion batches because they are host and factory catalog entries (Infra plans before it applies):
the former repository `aphrody-py` is still wired into config/update/pins.json, config/google-stack-release.json,
config/docs/documentation.json, config/github/templates.json, config/ai/agent-plugin-providers.json, config/deps/watch.json,
config/build-factory.json, config/host/toolchain.json, config/commit-sync.json, the systemd unit catalog
(source-sync `--repo aphrody-py`), scripts/dev/bootstrap and clone-and-bootstrap, scripts/tools/shell/setup, and the root
GOAL.md. Also staged: the nested `py/package.json` workspace identity (D15), the SDK-archive channel
`py/config/sibling-checkouts.json`, the legacy Infra dispatcher `py/tools/infra/scripts/python-workspace-dispatch.py`, and the
tracked compiled extension of `packages/engine/python` (P6).

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
| J7 | Feasibility on the build host | `cargo check --locked --manifest-path ... -p <crate>` through `cargo-serial.sh` under the heavy lock, rustc 1.98.1, 4 jobs; probe workspace with path dependencies on shallow clones of the three pin branches and a `vu` binary calling `uv::main`, `ruff::run` and `Python::attach` | uv: exit 0, 3 min 51 s; ruff: exit 0, 1 min 32 s; probe: `cargo generate-lockfile` locked 804 packages (latest compatible versions, not the upstream locks) and the check exited 0 in 3 min 29 s with one warning (`Python::version` is deprecated in PyO3 0.29.3, use `version_str`) |
| J8 | python-build-standalone | Release API (897 assets; CPython 3.10.22, 3.11.17, 3.12.15, 3.13.16, 3.14.8, 3.15.0rc3); docs `running.rst`, `distributions.rst`; full archive of 3.14.8 downloaded and hashed on the build host; uv's `download-metadata.json` at the pin | sha256 of the 3.14.8 full archive equals the release digest; PYTHON.json version 8, `libpython_link_mode` shared, `libpython3.14.a` and `libpython3.14.so.1.0` present, links pthread dl util; install_only_stripped sha256 equals uv's pin for 3.12.15 and 3.14.8; minimum glibc 2.17 |
| J9 | glibc | `/etc/os-release` and the runtime report on WSL; `ldd --version` on the build host | WSL Ubuntu 24.04.5, glibc 2.39; build host Ubuntu 26.04.1, glibc 2.43 |
| J10 | PyO3 0.29.3 guide | Guide sources at the tag (features, building-and-distribution, free-threading) | `extension-module` deprecated (use maturin >= 1.9.4); `auto-initialize`; static embedding not first-class; `abi3` wheels not loadable by free-threaded CPython; `abi3t` (PEP 803) from 3.15, maturin >= 1.14; modules assumed thread-safe since 0.28; `pyo3-ffi` exports `Py_BytesMain` |
| J11 | Prior art | GitHub API | indygreg/PyOxidizer last pushed 2024-12-24, no astral-sh/PyOxidizer (404) |
| J12 | The wheel built from the monorepo crate | `uv build --wheel` on the build host (maturin 1.14.1, rustc 1.98.1), installed-wheel verification (`py/tools/sdk/verify-wheel.py`, Python 3.14.4) | wheel 788 600 bytes with the CycloneDX SBOM; extension 1 161 480 bytes (old standalone crate: 790 160); 514 SDK tests passed, 31 skipped; `py/tools/packaging/qualify_aphrody.py` passed |
| J13 | Forks and pins | `POST /forks` (202) and `POST /git/refs` (201); `scripts/audit/workspace/vu-pins.ts --online`; shallow clones of the pin branches on the build host | three forks, three branches, all at the pinned commits; heads of the clones equal the pins |
| J14 | Repository and build host access | `POST /orgs/aphrody-labs/repos` (201, private, empty); `git ls-remote` of the new repository from the build host | `aphrody-labs/vu` is private; the build host fails with "gh: not found" in its credential helper and cannot read it |
| J15 | First complete build of the runtime | `vu` repository `scripts/forge.ts` on the build host under the factory locks (receipt `receipts/7c3db189-2026-10-05T21-13-26-131Z.json`, schema `aphrody.vu-forge/1`); `bun test scripts` 20 passed; `vps-cargo --repo vu` clippy `-D warnings` and `cargo test --workspace` green on 2026-10-06 | all ten steps ok at `7c3db189` (rustc 1.98.1); `vu --version --json` reports vu 0.1.0, uv 0.12.23, ruff 0.16.10, Python 3.12.15, PyO3 0.29.3; glibc needs: vu, uv, ruff 2.39, libpython 2.17, highest 2.39 within the 2.39 of WSL |
| J16 | `yolo py` against the real artifact | the artifact tarred on the build host (65 MB zstd), downloaded with `aphrody infra ssh sftp`, extracted under a scratch `VU_HOME` (`runtime/x86_64-unknown-linux-gnu/<version>-<rev8>`, `current` link); `yolo py status` and `--vu-full`; `uv sync --frozen` and `uv run pytest` of `py/` through the artifact's uv in a scratch environment (workspace members not installed, torch excluded) | quick and full manifest checks `verified` (bytecode caches excluded as derived data); `yolo py status` reports uv 0.12.23 (46b84fd0b), Python 3.12.15 and ruff 0.16.10 from the runtime; pytest 707 passed, 18 skipped, 3 failed (subprocess tests that import the installed `aphrody` wheel, not installable while the Cargo workspace is mid-edit by another batch); nothing installed under the real `~/.vu` (P5 stays open) |

## 12. Checklist

- [x] Inventory of `py/` against the monorepo.
- [x] Native crate absorbed into `crates/ai/rag-python`; wheel built and verified on the build host (J12).
- [x] `py/` deduplicated; follow-ups listed (section 10).
- [x] Runtime name settled by the owner: `vu`; one constant.
- [x] Forks created and pinned: uv `vu-pin-0.12.23`, ruff `vu-pin-0.16.10`, pyo3 `vu-pin-0.29.3`.
- [x] Provenance in config/upstream-sources.json; pins gate and tests.
- [x] Feasibility: `cargo check` of uv and ruff at the pins; probe binary linking uv, ruff and PyO3.
- [x] Every decision settled (section 9); private repository created.
- [x] `vps-cargo --repo`; repository seeded; first `vu` build with a receipt; glibc audit; release build times (peak memory not measured).
- [x] Embedded CPython parity test (`vu python` against `python`) and the SDK wheel smoke inside it (J15).
- [x] `yolo py` consumes the verified artifact: quick and full checks pass on the artifact pulled from the build host (J16).
- [ ] Installation and activation through Infra (never claimed from source alone).
