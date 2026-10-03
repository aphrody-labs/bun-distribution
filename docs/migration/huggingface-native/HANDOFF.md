<!-- SPDX-License-Identifier: Apache-2.0 -->
# Integrating-parent handoff — 2026-10-03

Implemented source within `crates/ai/models`, with structured evidence in
[INVENTORY.json](INVENTORY.json) and coverage limits in [INVENTORY.md](INVENTORY.md).
No Cargo, commit, staging, branch switch, root manifest/lock edit, service change,
clone, credential acquisition or payload download was performed by this worker.

## Owned implementation

- Host-only `hub` module uses official `HFClient` rather than hand-written Hub HTTP.
  Anonymous discovery and authenticated store selection are explicit. Search is
  bounded to 1–100 results for models/datasets/Spaces. Metadata accepts an explicit
  revision; Space runtime and remote identity validation are read-only.
- `resolve_token(store, key)` reuses the existing `aphrody-secrets::SecretStore`.
  Missing/blank/binary credentials fail; lookup and remote errors discard their
  bodies/details. No default path, new store, credential export or token-file write.
- `Downloader::from_secret_store` injects the same redacted/zeroizing token into
  the existing digest/resume/store path. `Downloader::new` retains its existing
  environment compatibility; explicit protected-store lookup never falls back.
  Bearer credentials remain gated to the exact HTTPS Hub origin.
- New tests cover path/query injection, bearer rejection, redaction, missing
  identity, selected-store reuse, local anonymous identity refusal, and official
  bounded search parsing against a loopback HTTP metadata fixture. Existing
  downloader integrity/resume/adoption tests are retained. Fixtures qualify no
  real identity, provider, model, dataset or deployment.

## Exact dependency and provenance requirements

Member host dependencies now inherit `hf-hub` and `aphrody-secrets` from root.
Root already declares both, so no new root dependency is required:

```toml
hf-hub = { version = "1.1.0", git = "https://github.com/huggingface/hf-hub", rev = "473de9430b0fbc544fb1d91102180eb713f8dc87" }
aphrody-secrets = { path = "crates/os/secrets", version = "1.0.0-canary", features = [] }
```

Official source inspected in the existing Cargo Git cache at that exact commit:
`hf-hub/src/client.rs`, `repository/mod.rs`, `repository/repo_type.rs`, `users.rs`,
`spaces.rs`, and `hf-hub/Cargo.toml`. License: Apache-2.0. Preserve the current
pin, notices and defaults (`rustls-tls`), with blocking off. No upstream code was
copied or patched. `config/upstream-sources.json` has no explicit hf-hub record
at audit time. If the source-owner catalog requires direct Git dependencies,
register this URL/revision/license/package under its existing schema; do not
invent a new engine/catalog or classify unmodified dependency code as a local patch.

The parent must resolve/update Cargo.lock through Cargo after reviewing the
combined member changes. `hf-hub 1.1.0` already exists in the lock but the
`aphrody-models` dependency roster needs regeneration. Do not hand-edit the lock
or bulk-upgrade existing hf-hub 0.4.3/0.5.0 consumers. No root pin bump is proposed.

## Precise out-of-scope CLI/auth wiring

Extend the existing `crates/infra/aphrody-command/src/model_cmd.rs` `ModelAction`
and `run`, routed by `Commands::Model` in `src/lib.rs`; no second CLI binary.
Proposed nested `aphrody model hub` commands (not yet installed/advertised):

| Proposed action | Owner API | Output |
| --- | --- | --- |
| `search --kind model\|dataset\|space --query ... --limit 20` | `Hub::search` | Existing `OutputOpts` JSON/report contract |
| `info --kind ... --repo owner/name --revision ...` | `Hub::info` | Typed official metadata serialized as JSON |
| `space-runtime --repo owner/name` | `Hub::space_runtime` | Read-only runtime metadata |
| `auth-status` | `Hub::from_secret_store` then `verify_identity` | Authenticated boolean only; no profile/email/token |

The selector is re-exported as `aphrody_models::hub::RepoTypeAny`; the CLI does
not need its own direct hf-hub dependency. Reuse its existing `aphrody-models`
dependency. Ensure host guards match the member's wasm guards.

The parent must inject the authorized Aphrody profile's existing protected store
and its configured key into both Hub and model pull (replace the current
`Downloader::new` call in `model_cmd.rs::pull` only when authenticated access is
selected). Choose anonymous discovery explicitly, rather than swallowing a store
error. Never use DBFR/IE stores or print the returned token.

`commands.rs::AuthCommand` currently authenticates Google/Antigravity. Preserve
that public contract; HF auth belongs in the existing model command namespace.
No HF interactive login flow is implemented here. If no authorized HF token
exists, return `MissingIdentity`; let the existing auth/store owner capture a
user-provided HF access token through protected input and store APIs, without
argv, transcripts, logs, repository files or a second credential store. Browser
cookies are not asserted to be usable HF bearer credentials. This worker read no
real token and made no whoami call, so identity/permissions remain unverified.

Regenerate the generated ecosystem/CLI catalogs through Workspace after the
parent's command wiring; do not hand-edit generated inventories. Verify installed
`--help` before claiming CLI availability.

## Integrator gates (not run by worker)

Run serialized on the configured build factory with global sccache, without a
guard bypass. First use the factory's existing approved lock-resolution workflow
for the combined manifest batch; then execute these scoped gates sequentially:

```sh
scripts/build/rust/cargo-serial.sh check -p aphrody-models --all-targets --locked
scripts/build/rust/cargo-serial.sh test -p aphrody-models --locked
scripts/build/rust/cargo-serial.sh clippy -p aphrody-models --all-targets --locked -- -D warnings
scripts/build/rust/cargo-serial.sh check -p aphrody-models --target wasm32-unknown-unknown --locked
scripts/build/rust/cargo-serial.sh check -p aphrody-models --target x86_64-pc-windows-msvc --locked
```

Record unsupported/uninstalled targets separately; do not infer cross-platform
support from source gating. After CLI integration, run the command owner's scoped
tests/check/strict Clippy and Workspace documentation consistency/catalog gates.

Worker checks actually performed: direct rustfmt on the two edited Rust source
files; scoped `git diff --check`; JSON parse and inventory evidence/link validation.
Cargo compilation, test execution and Clippy are **not run** by instruction.
Packaging, installation, CLI activation and live provider auth are **not verified**.

## Remaining qualification limits

Official `HFClient` internally copies the token into a non-zeroizing String;
the adapter does not claim end-to-end secret-buffer zeroization. Keep client
lifetimes bounded and never expose its internals or raw error bodies. Metadata
has per-request timeouts and bounded result counts, but no response-byte ceiling;
official retries extend total operation time. Callers must supply cancellation
and operation budgets when exposing this in a long-running product flow.

No Hub write/upload/provisioning, dataset processing engine, Gradio client or
dedicated HF inference-task adapter was added. Reuse model-client/gateway and
existing inference engines for future provider work. Official Xet download
integration requires digest/resume/rollback qualification before replacing the
existing downloader. Python Transformers/datasets compatibility remains outside
this native source batch. No performance or production-readiness claim is made.
