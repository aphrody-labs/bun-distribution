# Google stack packaging contract

`tools/config/google-stack-release.json` is the current release manifest for the
Google integration. `tools/config/google-gemini-pipeline.json` is a legacy pipeline
manifest: its split-repository owner and source paths no longer match this
monorepo and must not be used to locate current implementations.

## Current owners

The Google domain is `crates/google/*` (8 crates: `aphrody-google`, `-gemini-runtime`,
`-gemini-web`, `-antigravity`, `-model-antigravity`, `-notebooklm`, `-google-mcp`, `-gcs`),
`packages/google/google` (`@aphrody/google`) and `packages/google/antigravity-sdk-python` (not in repo)
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

`crates/google/google` no longer ships a standalone installer script. The
multicall binary `aphrody` links every compatibility name, including
`aphrody-google` and `google`, under `$APHRODY_HOME/bin`:

```sh
aphrody self install-path --bin
```

This replaces the former `install-google-stack.ps1`/`update-google-stack.ps1`
pair (both removed): building `aphrody-google` is a normal workspace build
(`scripts/build/rust/cargo-serial.sh build -p aphrody-google`), and installing
or refreshing the compatibility links is `aphrody self install-path --bin`,
re-run after any rebuild. Run `aphrody-google doctor` after installation to
verify runtime resolution and provider routing.

## Verification

The current verifier checks owner paths and manifests for Rust, Bun, doc-ai
and the sibling Python workspace. It also checks that no literal provider key
assignments are present in their source trees.

```powershell
bun scripts/audit/verify-google-pipeline.ts [--static-only]
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

`tools/config/google-gemini-pipeline.json` still names retired split repositories
and paths such as `crates/google/antigravity`,
`packages/google`, and `aphrody-web/apps/bxc`. Treat it as historical until it
is migrated or removed by its owner. Use
[`google-stack-release.json`](../../../tools/config/google-stack-release.json) for
the current source roots and release artifacts.

The VPS deployment remains governed by the immutable release workflow in
[`IMMUTABLE-RELEASES.md`](../../operations/infra/IMMUTABLE-RELEASES.md).
