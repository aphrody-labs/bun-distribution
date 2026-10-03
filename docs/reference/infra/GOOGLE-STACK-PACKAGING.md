# Google stack packaging contract

`config/google-stack-release.json` is the current release manifest for the
Google integration. `config/google-gemini-pipeline.json` is a legacy pipeline
manifest: its split-repository owner and source paths no longer match this
monorepo and must not be used to locate current implementations.

## Current owners

The Google domain is `crates/google/*` (8 crates: `aphrody-google`, `-gemini-runtime`,
`-gemini-web`, `-antigravity`, `-model-antigravity`, `-notebooklm`, `-google-mcp`, `-gcs`),
`packages/google/google` (`@aphrody/google`) and `packages/google/antigravity-sdk-python`
(`google-antigravity`, consumed by `aphrody-py` as a path dependency). Each crate builds and
tests on its own; the verifier checks them one by one.

- `aphrody-google` is the Rust CLI in `crates/google/google` and owns runtime
  resolution, provider routing and the public `status`, `env` and `doctor`
  commands.
- `@aphrody/google` in `packages/google/google` is a Bun facade over that binary.
- `@aphrody/doc-ai` in `packages/ai/doc-ai` is a separate Vertex ADC adapter.
- `aphrody.google` is the Python facade in the sibling `aphrody-py` workspace,
  under `packages/ai/py/aphrody` (not in repo).
- Kernel/MCP and desktop integration belong to `crates/os`; provider business
  logic remains with the Google owners.

The installer owns only the native Rust CLI. It does not install Bun or Python
packages. Credentials remain host-local and are not included in releases.

## Install and update

Run these from the monorepo root. Both scripts default `AphrodyRoot` to the
parent of their own `scripts/` directory, so an explicit root argument is not
needed for the normal checkout.

```powershell
pwsh -NoProfile -File scripts/install-google-stack.ps1 [-Target <triple>] [-SkipBuild]
pwsh -NoProfile -File scripts/update-google-stack.ps1 [-Target <triple>] [-SkipFetch] [-SkipBuild]
```

Install builds `aphrody-google` through `scripts/build/rust/cargo-serial.ps1`
unless `-SkipBuild` is supplied, then atomically replaces the binary under
`$APHRODY_HOME/bin` and writes the `google` compatibility alias. It runs
`aphrody-google doctor` after installation.

Update fetches `main` from the selected remote unless `-SkipFetch` is
supplied. Pass `-Remote <name>` to select it explicitly; otherwise the script
uses `origin` when configured and falls back to `workspace`. It requires the
checkout to be on `main`, at the same commit as `refs/remotes/<remote>/main`,
and clean, including untracked files. In this checkout, the selected remote is
`workspace`. It then invokes the installer. These checks make this an update
from the verified monorepo checkout, not a release builder for arbitrary
branches.

## Verification

The current verifier checks owner paths and manifests for Rust, Bun, doc-ai
and the sibling Python workspace. It also checks that no literal provider key
assignments are present in their source trees.

```powershell
pwsh -NoProfile -File scripts/verify-google-pipeline.ps1 [-StaticOnly]
```

The script defaults to the monorepo and `../aphrody-py`. `-StaticOnly` stops
after source, manifest and toolchain pin checks. Full mode additionally runs
serialized Rust tests, the Bun Google `verify` script, doc-ai tests and
typecheck, and Python pytest.

Full mode runs clippy (`-D warnings`) and tests for every `crates/google` crate on its
own, the Bun `verify` script, doc-ai tests and typecheck, a standalone wheel build and
import of the `google-antigravity` SDK, and the `aphrody` pytest suite. Last full pass:
2026-10-02, 22 gates, `GOOGLE_PIPELINE: all current owner gates passed.`

## Legacy manifest

`config/google-gemini-pipeline.json` still names retired split repositories
and paths such as `crates/google/antigravity`,
`packages/google`, and `aphrody-web/apps/bxc`. Treat it as historical until it
is migrated or removed by its owner. Use
[`google-stack-release.json`](../../../config/google-stack-release.json) for
the current source roots and release artifacts.

The VPS deployment remains governed by the immutable release workflow in
[`IMMUTABLE-RELEASES.md`](../../operations/infra/IMMUTABLE-RELEASES.md).
