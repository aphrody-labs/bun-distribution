<!-- SPDX-License-Identifier: Apache-2.0 -->
# Python and uv updates (`yolo update uv`)

Owner: Infra (`packages/infra/update/src/ecosystems/uv.ts`, exported as `runUv` / `runUvWith`). It bumps everything that
is Python or uv: the uv pin, the managed CPython interpreters, every `uv.lock` of the Python workspace and the gates that
prove the result. The pipeline overview is [UPDATE.md](../UPDATE.md). The Python workspace is `py/` of this repository
(fused on 2026-10-05, [plan](../../../plans/vu/PLAN.md)); the module finds it through `inventory.pythonRoots` of
`tools/config/deps/watch.json` (override with `--py-root <dir>` or `APHRODY_PY_ROOT`).

## What is locked, and where

| Lock | Resolves | Used by |
| --- | --- | --- |
| `uv.lock` (root) | the six workspace members, Python `==3.12.*`, `aphrody-train` torch forked per platform (cu130 on Linux and Windows, PyPI elsewhere) | `uv sync --all-packages --locked`, every test and ruff gate |
| `packages/ai/py/aphrody/uv.lock` (not in repo) | the SDK on its own, Python `>=3.11` (forks per interpreter and platform) | CI distribution jobs, `uv build` of the SDK |
| `packages/ai/py/aphrody-train/uv.lock` (not in repo) | the training package on its own, Python 3.12, CUDA torch from `download.pytorch.org/whl/cu130` | standalone training environment |

All three move together: `apply` runs `uv lock --upgrade` in each directory and `verify` runs `uv lock --check` in each.
(removed import receipt) holds archived migration snapshots; the module never reads or edits them. Lock revision is
whatever the installed uv writes (revision 5 since uv 0.12.22).

Two environment facts that bite: `uv run` inside `packages/ai/py/aphrody` (not in repo) or `aphrody-train` uses that package's own
`uv.lock` and its own `.venv` (they are standalone projects, the `dev` group does not exist there), and `uv sync` run
inside them is exact and strips extras. Run every gate from the repository root.

## Policy

- uv follows the latest published release. Four places must agree: the installed binary, `tools/config/system-packages.json`
  (source of truth in `tools/config/update/pins.json`), `required-version = "==X"` in the workspace `pyproject.toml` and the
  `setup-uv` version in `.github/workflows/python-sdk.yml` (not in repo) (plus the README and the CLI/TOOLS reference tables). The
  pin manifest rewrites all of them: `yolo update tools uv --apply` installs and re-pins, or
  `yolo update pins apply uv <version>` when the binary is already in place. `required-version` refuses any other uv, so
  update the binary first.
- Every direct dependency follows its latest release inside its specifier; `uv lock --upgrade` is run on every bump.
  A specifier that excludes the latest release is a cap and needs an entry in `tools/config/deps/uv-holds.json` with the
  reason; `status` prints such a cap without an entry as `NO REASON` and exits 1.
- A major (and a `0.x` minor) is read before it is taken: the release notes (GitHub releases, the changelog or Context7),
  a grep of the repository's real usage, then the consumers' tests. A major that cannot be fixed cheaply is not bumped:
  it goes in the holds file, with the condition that releases it.
- Security first: a PyPI advisory (OSV) that a newer release fixes is bumped at once. One that no bump fixes goes in
  `tools/config/deps/advisory-holds.json` with its reason.
- Python versions: `.python-version` is 3.12, the interpreter every gate runs on (the training and OCR members need
  `==3.12.*` for their wheels). The SDK promises 3.11 to 3.14 and CI builds and tests it on all four, so its
  `requires-python` stays `>=3.11`; releases that need a newer interpreter (numpy 2.5, scipy 1.18, networkx 3.7) are
  reached through the lock's per-interpreter forks, not by raising the floor. uv-managed interpreters run the newest patch
  of their minor (`uv python upgrade`); the system interpreter (`/usr/bin/python3.12`) is not touched.
- Ruff has no suppressions: a diagnostic is fixed in the code. The only exclusion is the vendored upstream SDK
  `packages/ai/py/antigravity-sdk-python` (not in repo). `ruff format` is not a gate (28 files would be reformatted today).
- No cargo is run here. A bump that needs a native build (maturin) is qualified by the lead through the serialized
  Cargo wrapper.

## Holds

All reasons live in `tools/config/deps/uv-holds.json` (read by `status`, `plan`, `apply`); the cap itself stays in the
pyproject it belongs to. Re-check every row on each bump and delete it as soon as the blocker moves.

| Package | Held at | Reason |
| --- | --- | --- |
| `torch` | `==2.13.0` (aphrody-train) | first release that fixes GHSA-rrmf-rvhw-rf47; the Windows CPU smoke (`import torch.amp`) and the embed/rerank ONNX export pass on it. The 2.14.0 Windows wheel failed to import `torch.amp`, so the smoke and the export must be re-run on 2.14.x (and the cu130 index must carry it) before lifting. The SDK lock already resolves 2.14.1 for its `depth` extra |
| `magika` | `~=0.6.1` | markitdown hard-pins `magika~=0.6.1` as a core dependency; `classify.py` handles both result shapes so a markitdown bump makes the upgrade a no-op |
| `maturin` | `==1.14.1` | exact build-backend pin of the SDK. 1.15.0 changes the sdist tar headers (UID and GID in pax) and hardens the PEP 517 build-wheel path, so the reproducibility and RECORD-integrity checks and the cargo-built wheels need a full requalification (`uv build`, `py/tools/sdk/verify-wheel.py`, six CI jobs), which needs Cargo |
| `torchvision`, `triton`, `nvidia-*`, `cuda-*` | follow torch | pinned by the torch wheel that pulls them |
| `huggingface-hub` | resolver | docling-slim and sentence-transformers 6.1 cap huggingface-hub `<2` |
| `typer`, `semchunk`, `mammoth`, `websockets` | resolver | docling-slim `typer<0.27`, docling-core `semchunk<4`, markitdown `mammoth<1.12`, google-genai `websockets<17` |
| `fsspec`, `multidict`, `antlr4-python3-runtime`, `mpmath`, `pydantic-core`, `onnxruntime` | resolver | datasets `fsspec<=2026.6.0`, aiohttp `multidict<7`, omegaconf `antlr4==4.9.*`, sympy `mpmath<1.4`, pydantic `pydantic-core==2.46.5`, magika `onnxruntime<=1.20.1` on Windows |

No PyPI advisory hold remains; new ones go in `tools/config/deps/advisory-holds.json`.

## Commands

The CLI wiring is the lead's (`case "uv": return runUv([...rest, "--root", root])` in `src/cli.ts`); until then run the
module directly from the repository root.

```sh
bun packages/infra/update/src/ecosystems/uv.ts status [--offline] [--json]
bun packages/infra/update/src/ecosystems/uv.ts plan
bun packages/infra/update/src/ecosystems/uv.ts apply [--upgrade-package a,b] [--skip-tests]
bun packages/infra/update/src/ecosystems/uv.ts verify [--skip-tests]
bun packages/infra/update/src/ecosystems/uv.ts rollback
```

| Subcommand | What it does |
| --- | --- |
| `status` | uv installed vs pinned vs latest and every `required-version`; `uv lock --check` per lock; every direct requirement of every pyproject (dependencies, extras, dependency groups, build requirements) against PyPI latest as `current`, `held` (manifest cap, python floor of the lock, or a recorded hold) or `open`; resolver-limited packages not explained by a hold; OSV advisories not covered by a hold; Python version policy. Exit 1 on uv drift, a stale lock, a cap without a reason, an open advisory or a policy finding |
| `plan` | `uv lock --upgrade --dry-run` per lock (every change with its patch, minor, major or pre kind), the uv step, and the open direct rows that need a decision |
| `apply` | snapshot, `uv python upgrade`, `uv lock --upgrade` per lock (or `--upgrade-package` for the named packages only), a journal entry in `tools/config/deps/journal.json` (`ecosystem: uv-lock`), then `verify`. Refuses to run when the installed uv differs from the pin |
| `verify` | uv pins agree and the installed uv matches; `uv lock --check` per lock; `uv sync --all-packages --locked --extra rag --extra dedup`; `ruff check .`; pytest for every workspace member that ships `tests/test_*.py` (the SDK suite is about 500 tests) |
| `rollback` | restore the lock files from the newest snapshot in `target/update/uv/<stamp>/` |

`apply` does not install uv: do that first with `yolo update tools uv --apply`. The monorepo side of a bump
(`tools/config/system-packages.json`, the CLI and TOOLS reference tables, the holds file, the journal) is committed in the
monorepo; the Python side (locks, pyprojects, workflow, README) is committed in `py/` of the same repository.

## Rollback

1. `bun packages/infra/update/src/ecosystems/uv.ts rollback` restores every `uv.lock` from the newest snapshot, or
   `git checkout -- py/uv.lock`.
2. `uv sync --all-packages --locked --extra rag --extra dedup` realigns the environment.
3. A uv bump is undone with `uv self update <old>` followed by `yolo update pins apply uv <old>`.
4. Record why in `tools/config/deps/uv-holds.json` so the next run does not retry it blindly.

## How a major bump is done

1. `status`: pick an `open` row of kind `major`, or a `held` row whose blocker moved.
2. Read the release notes (GitHub releases, changelog, Context7) and grep the real usage in `py/`.
3. Edit the specifier in the owning pyproject and delete or update the hold entry and the comment next to the cap.
4. `apply --upgrade-package <name>` re-resolves only that package (and what it drags in) in every lock, then runs the
   whole verify pass. For torch, run the Windows CPU smoke as well: the verify pass is Linux only.
5. Fix real breakage in code; never silence ruff or skip a test. If it cannot be fixed cheaply, `rollback`, keep the
   cap and write the reason and the unblocking condition in the holds file.
6. Commit the Python repository, then the monorepo files; the CI matrix (Linux, Windows, macOS; Python 3.11 to 3.14)
   is the final gate and must be read, not assumed.

## Automation

`status` and `plan` are report-only and network-bound (PyPI with a six-hour cache in `target/deps-inventory/cache` (not in repo) (generated or machine-local artifact; presence depends on the build host),
shared with `deps inventory`, plus one OSV batch). They belong in the weekly `aphrody-update.timer` run next to `tools`;
`apply` is never scheduled. `deps inventory` already lists the PyPI rows of the Python root in
`docs/reference/workspace/DEPS-INVENTORY.md`.

## Record, 2026-10-02

- uv 0.12.21 -> 0.12.22 (installer and pins). Release notes: new CPython patch builds, lock files now record
  workspace-member default groups and dependency-group Python requirements (lock revision 3 -> 5), relock verifies
  unchanged hashes, no breaking change. `uv python upgrade` took CPython 3.14.7 -> 3.14.8.
- `uv lock --upgrade` (root, SDK, training): the root lock was already at the newest resolution (only the revision
  changed); the SDK lock moved `filelock` 4.0.8 -> 4.0.9, `google-genai` 2.26.0 -> 2.27.0, `mail-parser` 4.7.0 -> 4.8.0;
  the training lock moved `filelock` 4.0.8 -> 4.0.9. Everything else behind PyPI latest is capped by a documented hold
  (table above); no direct dependency is open.
- Majors evaluated and held: torch 2.8.0 -> 2.14.1, transformers 4.57.6 -> 5.18, sentence-transformers 5 -> 6 (`full`),
  magika 0.6 -> 1.0, maturin 1.14.1 -> 1.15.0, huggingface-hub 0.36/1.33 -> 2.1, typer 0.26 -> 0.27, semchunk 3 -> 4,
  websockets 16 -> 17, multidict 6 -> 7, mammoth 1.11 -> 1.13.
- Ruff: 24 legacy diagnostics (BLE001 and S110 in the retained Drive adapters and four AI scripts) are fixed by
  narrowing the handlers to the exceptions each call raises (`OSError` for file copies, `OSError` and `ValueError` for HTTP
  and JSON, `gdown` and `google-genai` error classes for the SDK scripts); the gmail "message deleted" branch now logs a
  warning instead of `pass`. Hashes and transformation notes in (removed import receipt) (not in repo) were updated.
  `ruff check .` reports zero. The Drive adapters were not run against a real Spacedrive runtime.
- Gates: `uv lock --check` on the three locks, `ruff check .`, pytest: SDK 490 passed and 18 skipped, training 44 passed,
  OCR 2, embedding fixtures 5, Koharu tools 5.
- Fixed in passing: `aphrody-ci.yml` ran `uv run pytest` inside the standalone packages, whose environment has no
  pytest (the step only worked where a system pytest existed); it now syncs the workspace once and runs ruff and both suites
  from the root, and checks the three locks.

## Record, 2026-10-09

- Dependabot (16 PyPI alerts on the root and training locks): torch 2.8.0 -> 2.13.0 (GHSA-rrmf-rvhw-rf47,
  GHSA-qfhq-4f3w-5fph, GHSA-vgrw-7cvw-pwgx), transformers 4.57.6 -> 5.18.0 (GHSA-x9r9-c232-4q39, GHSA-xrqw-3rrv-vx5w,
  GHSA-fgcw-684q-jj6r, GHSA-29pf-2h5f-8g72, GHSA-69w3-r845-3855), sentence-transformers 5.7 -> 6.1 in both extras.
- The ONNX export no longer goes through `sentence-transformers[onnx]` and optimum-onnx (which capped transformers below
  4.58): `aphrody_train/onnx_export.py` exports the transformer with `torch.onnx` (dynamo, opset 18, single file) in the
  layout the Rust ORT loaders read, and writes `special_tokens_map.json`, which transformers 5 no longer saves. The
  `full`/`mine` conflict is gone; optimum and optimum-onnx left the locks, onnxscript entered.
- torch moved from cu129 (Linux) + cu130 (Windows) to one cu130 index: uv refused two indexes for the same package across
  marker environments once the extras stopped conflicting. `uv lock --upgrade-package torch` restores the PyPI fork for
  macOS.
- Gates: `modernize_workspace.py locks` (three locks), `ruff check`, pytest training + embedding fixtures; Windows CPU
  smoke on torch 2.13.0 (`import torch.amp`); `dry_run --steps 4` (all-MiniLM-L6-v2, ONNX cosine 0.99999988) and rerank
  (ms-marco-MiniLM-L2-v2, max abs diff 5e-6) end to end on CPU.
