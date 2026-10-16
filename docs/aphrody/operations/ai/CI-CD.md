<!-- SPDX-License-Identifier: Apache-2.0 -->

# CI / CD

Workflow definitions under `.github/workflows/`. GitHub Actions is disabled on the
`aphrody-code` organization, so these workflows do not run remotely; they document the
gate set, which is run locally (`cargo check/clippy/test`, `bun run typecheck`, `bun test`,
`uv run pytest`) before pushing.

| Workflow | Trigger | What it runs |
| --- | --- | --- |
| `ci.yml` | push to `main`, pull requests, manual | Rust on `ubuntu-latest` and `windows-latest`: `cargo check --workspace --all-targets`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, and on Linux `aphrody summary -- --check`. `cargo deny check` (EmbarkStudios/cargo-deny-action). Bun on both OSes: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`. |
| `python.yml` | changes under `py/` | `uv sync --locked --group dev`, `ruff check`, `ruff format --check`, `pytest -m "not live_api"` on Ubuntu and Windows. |
| `security.yml` | push/PR on `main`, weekly | gitleaks, trufflehog, informational `cargo audit`, trivy filesystem scan. |
| `dependabot-auto-merge.yml` | Dependabot pull requests | Auto-merges patch updates outside the deny-list. |

## Sibling checkouts

The Cargo workspace path-depends on sibling category repositories, so every
job that runs Cargo reproduces the local layout: this repository is checked
out into `./aphrody-ai` and each sibling (`aphrody-os`, `aphrody-ui`,
`aphrody-web`, `aphrody-compat`, `aphrody-contracts`, `aphrody-shell`,
`aphrody-native`, `aphrody-infra`) into `./<sibling>`, at its default branch.

The siblings are private. The repository secret `APHRODY_CI_TOKEN` must hold a
token with read-only `Contents` access to them; without it the checkouts fall
back to `github.token` and fail.

Cargo steps do not pass `--locked`: `Cargo.lock` also records the siblings'
own dependency choices, which change with their `main` branches.

## Releases

The monolith's tag-driven release and release-please workflows were removed
with the split: they built a single-repository checkout. Release packaging
and deployment for the category repositories belong to the release plane in
`aphrody-infra`.
