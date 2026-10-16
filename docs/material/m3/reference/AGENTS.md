<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-ui: agent rules

M3 framework, desktop hosts, rendering, Drive presentation and editor components.

Follow the [workspace rules](https://github.com/aphrody-labs/aphrody/blob/main/docs/reference/workspace/AGENTS.md) and the user's global agent policy.
**NHITL:** execute authorized work without approval prompts or interactive questions;
choose routine details autonomously and report actual blockers. These local rules
add repository constraints, not a separate approval workflow.

## Local constraints

- Target: one portable M3 design contract across web, desktop and mobile under the
  [M3 host plan](../plans/design/M3-MULTI-HOST-PLAN.md). Tauri is the current desktop host;
  mobile and a replacement native host require separate qualification.
- AI stays out of the UI dependency graph; use the resident app-server process.
  Contracts owns wire types, OS owns process policy, Infra owns destinations.
- Follow [UI rules](./UI-RULES.md), [design](../architecture/UI-DESIGN.md) and
  [GUI contracts](./GUI.md): one product navigation, real actions, accessible M3,
  no placeholders or shell/PTY/terminal views.
- `aphrody-bun` and `@aphrody/bun` live here; Compat owns `aphrody-toolchains`.
  Build FFI-backed tests with `bun run bun:native`.
- Preserve Drive/FSL and upstream provenance. Migrate active consumers and data before
  removing upstream copies; use pinned external Tauri forks for the current host.
- Format owned crates only. Keep LF line endings and supported platform builds.

## Validation

Documentation-only changes need links/anchors and `git diff --check`; use the
repository documentation generator where required. For implementation/release
work, run focused checks first, then the applicable owner gates below with
`RUSTC_WRAPPER=` and the pinned toolchain. Record unrun or failing checks.

```sh
export RUSTC_WRAPPER=                 # sccache is not used
cargo check --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo deny check
bun install --frozen-lockfile
bun run bun:native                    # @aphrody/bun native library from crates/aphrody-bun
bun run typecheck && bun run test
git diff --check
```

Layout and entry points: [README](../products/README.md). Reuse the
[ecosystem inventory](https://github.com/aphrody-labs/aphrody/blob/main/docs/ecosystem/ECOSYSTEM.md) before adding code.

## Automatisation transversale

Les contrôles Bun, monorepo, import/export, desktop et SpaceUI passent par les scripts `bun run` déclarés dans `package.json`, qui délèguent à `aphrody-ops` du paquet `@aphrody/workspace`. Conserver cette entrée locale lors de toute évolution du module central.
