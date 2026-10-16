<!-- SPDX-License-Identifier: Apache-2.0 -->

# Publish ladder (crates.io)

Cross-repository runbook for publishing the curated crates.io release set of the Aphrody
ecosystem. Read top to bottom; never skip a rung. Decision recorded on 2026-09-26 in
[`docs/PLAN.md` (not in repo)](../../../plans/ai/PLAN.md) and in the `docs/PLAN.md` (not in repo) of `aphrody-contracts`, `aphrody-native`
and `aphrody-compat`.

Cross-references:

- [`docs/operations/ai/CI-CD.md`](../../../operations/ai/CI-CD.md#releases): the monolith release-please and tag-release workflows
  were removed with the split; binary packaging belongs to the `aphrody-infra` release plane.
- [`docs/reference/ai/cargo/SUPPLY_CHAIN.md`](./SUPPLY_CHAIN.md): cargo-deny / cargo-vet policy.
- [`docs/operations/ai/RELEASE-CHECKLIST.md`](../../../operations/ai/RELEASE-CHECKLIST.md): the per-release checklist of `aphrody`.

Execute an authorized publication task under [NHITL](../AGENTS.md): run the
technical gates and publish without an extra maintainer-confirmation step. Missing
credentials or failed checks are blockers, not permission prompts. Documentation
maintenance alone is not a publication task.

## 1. Release set

Fifteen library and CLI crates from three repositories. Versions are the declared ones: the
A2A stack is `0.x`, the n2b crates move together at `0.6.x`, the others follow their workspace
version `1.0.0-canary`. Every crate has `publish = true`, a README inside the crate, `license`,
`description`, `repository` (the repository's `origin`), `homepage`, `keywords`, `categories`
and an inherited `rust-version`; every internal path dependency also carries a `version`.

| Rung | Crate | Version | Repository | Internal dependencies |
| --- | --- | --- | --- | --- |
| 0 | `aphrody-a2a` | 0.3.0 | `aphrody-contracts` | none |
| 0 | `aphrody-agent-proto` | 1.0.0-canary | `aphrody-contracts` | none |
| 0 | `aphrody-app-protocol` | 1.0.0-canary | `aphrody-contracts` | none |
| 0 | `aphrody-subsystem` | 1.0.0-canary | `aphrody-contracts` | none |
| 0 | `aphrody-native` | 1.0.0-canary | `aphrody-native` | none |
| 0 | `aphrody-n2b-types` | 0.6.2 | `aphrody-compat` | none |
| 0 | `aphrody-toolchains` | 1.0.0-canary | `aphrody-compat` | none |
| 1 | `aphrody-a2a-pb` | 0.1.8 | `aphrody-contracts` | `aphrody-a2a` |
| 1 | `aphrody-n2b-registry` | 0.6.2 | `aphrody-compat` | `aphrody-n2b-types` |
| 2 | `aphrody-a2a-client` | 0.1.16 | `aphrody-contracts` | `aphrody-a2a`, `aphrody-a2a-pb` |
| 2 | `aphrody-a2a-server` | 0.3.0 | `aphrody-contracts` | `aphrody-a2a`, `aphrody-a2a-pb` |
| 3 | `aphrody-a2a-grpc` | 0.2.2 | `aphrody-contracts` | `aphrody-a2a`, `-pb`, `-client`, `-server` |
| 3 | `aphrody-a2a-coord` | 1.0.0-canary | `aphrody-contracts` | `aphrody-a2a`, `aphrody-a2a-server` |
| 4 | `aphrody-n2b-core` | 0.6.2 | `aphrody-compat` | `-types`, `-registry` (owns the former `-ai`, `-github`, `-report`, `-rules`, `-scanners`, `-util` crates as modules since 2026-10-02) |
| 5 | `aphrody-n2b` (binary `n2b`) | 0.6.2 | `aphrody-compat` | `aphrody-n2b-core`, `aphrody-toolchains` |

The three repositories do not depend on each other inside the set (the n2b closure uses no
`aphrody-contracts` crate), so each repository's crates only wait for their own lower rungs.

## 2. Not on crates.io

- **The `aphrody` CLI** and every other `aphrody-ai` crate (`publish = false`): the CLI is
  distributed as per-target binaries on GitHub Releases, built by the `aphrody-infra` release
  plane. `aphrody-summary` is an internal docs tool and is `publish = false` too.
- `aphrody-n2b-native` (cdylib, bun:ffi ABI) and `aphrody-bun-docs` (kernel subsystem) in
  `aphrody-compat`; the excluded `a2a-slimrpc` stub in `aphrody-contracts`.
- Every crate of `aphrody-os`, `aphrody-ui`, `aphrody-web`, `aphrody-shell` and `aphrody-infra`.

## 3. crates.io constraints

- **Immutable uploads.** A published version can be yanked, never replaced or deleted.
- **Rate limit on new crates.** crates.io allows a burst of 5 *new* crates, then 1 per 10 minutes
  (updates to existing crates: burst 30, then 1 per minute). The whole set is new, so a first
  run takes at least 16 × 10 = 160 minutes after the first five uploads. A throttled upload fails
  with `You have published too many new crates in a short period of time`; wait and re-run the
  same command. The script in §5 does that.
- **Every dependency must already be on crates.io**, hence the rungs. Path dependencies carry a
  `version`, which is what the published manifest keeps.
- **Pre-release requirements.** `version = "1.0.0-canary"` means `^1.0.0-canary`: it matches
  `1.0.0-canary`, later pre-releases of `1.0.0` and `1.x` releases, but no pre-release of another
  `major.minor.patch`. A `0.x` requirement such as `0.3` means `>=0.3.0, <0.4.0`.
- **Build scripts write only to `OUT_DIR`.** `aphrody-a2a-pb` regenerates `src/gen/` only when
  `A2A_PB_REGEN` is set: never set it while packaging or publishing.
- **Credentials.** The maintainer's crates.io token comes from `~/.cargo/credentials.toml`
  (created beforehand by the maintainer) or `CARGO_REGISTRY_TOKEN`. Never print it, never commit
  it, never pass it on a command line that is logged.

## 4. Pre-publish gates

From each repository, with `RUSTC_WRAPPER=` exported, on a clean `main` equal to `origin/main`:

```bash
cargo check  --workspace --all-targets --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test   --workspace --locked
git diff --check
```

Then the dry runs. Cargo 1.90+ packages every listed crate, publishes the unreleased internal
dependencies to a temporary local registry and verifies each tarball against it, so a whole
repository is checked in one command before anything exists on crates.io:

```bash
# aphrody-contracts
cargo publish --dry-run --locked -p aphrody-a2a -p aphrody-agent-proto -p aphrody-app-protocol \
  -p aphrody-subsystem -p aphrody-a2a-pb -p aphrody-a2a-client -p aphrody-a2a-server \
  -p aphrody-a2a-grpc -p aphrody-a2a-coord
# aphrody-native
cargo publish --dry-run --locked -p aphrody-native
# aphrody-compat
cargo publish --dry-run --locked -p aphrody-n2b-types -p aphrody-toolchains \
  -p aphrody-n2b-registry -p aphrody-n2b-core -p aphrody-n2b
```

Inspect a package with `cargo package --locked --list -p <crate>`: only files of the crate, a
`README.md`, no `.env`, no generated artefacts.

## 5. Publish script

Run from the directory that holds the sibling checkouts (`aphrody-contracts`, `aphrody-native`,
`aphrody-compat` side by side), with the maintainer's crates.io credentials already configured.
Each rung ends with a 30-second pause and a `max_version` check of every crate of the rung on the
crates.io API before the next rung starts. The script is idempotent: a version that is already
on crates.io counts as published.

```bash
#!/usr/bin/env bash
set -euo pipefail
unset A2A_PB_REGEN
export RUSTC_WRAPPER=
ROOT=$(pwd)
UA='aphrody-publish-ladder (https://github.com/aphrody-code)'
LOG=${TMPDIR:-/tmp}/aphrody-publish
mkdir -p "$LOG"

publish() { # publish <repository> <crate>
  until (cd "$ROOT/$1" && cargo publish --locked -p "$2") >"$LOG/$2.log" 2>&1; do
    if grep -q 'already exists' "$LOG/$2.log"; then return 0; fi
    if grep -qiE 'too many new crates|status 429' "$LOG/$2.log"; then sleep 600; continue; fi
    cat "$LOG/$2.log" >&2; return 1
  done
}

check() { # check <crate> <version>
  local got
  got=$(curl -fsS -A "$UA" "https://crates.io/api/v1/crates/$1" | jq -r '.crate.max_version')
  if [ "$got" != "$2" ]; then echo "$1: max_version=$got, expected $2" >&2; exit 1; fi
  echo "$1 $got live"
}

# Rung 0
publish aphrody-contracts aphrody-a2a
publish aphrody-contracts aphrody-agent-proto
publish aphrody-contracts aphrody-app-protocol
publish aphrody-contracts aphrody-subsystem
publish aphrody-native    aphrody-native
publish aphrody-compat    aphrody-n2b-types
publish aphrody-compat    aphrody-toolchains
sleep 30
check aphrody-a2a 0.3.0
check aphrody-agent-proto 1.0.0-canary
check aphrody-app-protocol 1.0.0-canary
check aphrody-subsystem 1.0.0-canary
check aphrody-native 1.0.0-canary
check aphrody-n2b-types 0.6.2
check aphrody-toolchains 1.0.0-canary

# Rung 1
publish aphrody-contracts aphrody-a2a-pb
publish aphrody-compat    aphrody-n2b-registry
sleep 30
check aphrody-a2a-pb 0.1.8
check aphrody-n2b-registry 0.6.2

# Rung 2
publish aphrody-contracts aphrody-a2a-client
publish aphrody-contracts aphrody-a2a-server
sleep 30
check aphrody-a2a-client 0.1.16
check aphrody-a2a-server 0.3.0

# Rung 3
publish aphrody-contracts aphrody-a2a-grpc
publish aphrody-contracts aphrody-a2a-coord
sleep 30
check aphrody-a2a-grpc 0.2.2
check aphrody-a2a-coord 1.0.0-canary

# Rung 4
publish aphrody-compat aphrody-n2b-core
sleep 30
check aphrody-n2b-core 0.6.2

# Rung 5
publish aphrody-compat aphrody-n2b
sleep 30
check aphrody-n2b 0.6.2
```

`max_version` includes pre-releases, so it reports `1.0.0-canary` for a crate that only has that
version (`max_stable_version` stays `null`).

## 6. After the ladder

- Check that docs.rs built every crate (`https://docs.rs/crate/<name>/<version>`).
- Smoke-test the CLI from the registry: `cargo install aphrody-n2b --locked` then `n2b --version`.
- Record the published versions in the `docs/PLAN.md` (not in repo) of the three repositories.
- Consumers keep their `path` + `version` dependencies; nothing else changes for local builds.

## 7. Yank policy

Only yank for a critical vulnerability without a same-day fix, or an accidentally broken upload
caught within one hour.

```bash
cargo yank --version <version> <name>
cargo yank --version <version> --undo <name>
```

## 8. Next versions

crates.io is immutable: to fix a release, bump the version and publish again. There is no
release automation; bump by hand with Conventional Commits:

- `aphrody-a2a*`: bump the crate `version` and its `CHANGELOG.md`, and the matching requirement in
  the `aphrody-contracts` root `[workspace.dependencies]` when the minor (for `0.x`) changes.
- n2b crates: they move together with the `@aphrody/n2b-*` packages; regenerate the baselines
  under `aphrody-compat/tests/`, because the version appears in the JSON, JSONL and SARIF
  output.
- Crates on the workspace version: bump `[workspace.package].version` and every path dependency
  `version` that points at them, in every consuming repository.
- Only the changed crates and their dependents need a new upload; follow the rungs of §1 for
  that subset.

## 9. Rollback

A failed `cargo publish` leaves nothing on crates.io; the upload is atomic per crate. Fix the
manifest or the source, re-run the gates of §4, then re-run the script: the crates already
published are skipped.
