<!-- SPDX-License-Identifier: Apache-2.0 -->
# Architecture

Shared runtime/product contracts: [Aphrody PLAN](../aphrody/PLAN.md).
Yolo delivery states: [PLAN.md](PLAN.md). This page owns source layout and flows.

| Path | Role |
| --- | --- |
| `crates/` | Owned `yolo-*` crates and imported `aphrody-*` Rust packages |
| `vendor/` | Pinned fork submodules: Bun, Obscura, Tauri/plugins, Wry, Tao, create-tauri-app, Next |
| `packages/runtime` | SDK and `runtime:*` preload/bundler integration |
| `apps/` | CLI and desktop frontend |
| `templates/` | Scaffold inputs and stack pins |
| `examples/` | Example applications |
| `scripts/` | Import, upstream, release and factory operations |
| `test/`, `docs/` | Bun tests and mdBook sources |
| `target/`, `dist/`, `var/`, `.cache/` | Ignored local/generated output |

- Import: committed fork revision → generated `vendor` history → merge into
  `dev`. Integration changes stay on `dev`. [VENDORING](docs/VENDORING.md).
- Runtime: `crates/engine/yolo-runtime` → verified target artifact → SDK loader.
  [RUNTIME-ABI](docs/RUNTIME-ABI.md).
- Distribution: pinned tag → factory gates → assets/installers → qualified
  install/rollback. [DISTRIBUTION](docs/DISTRIBUTION.md).
- Stack maturation, agent-first rigor and protocols (CLI ↔ MCP ↔ API ↔ FFI):
  [STACK-DECISION](docs/STACK-DECISION.md).
- Heavy builds use Workspace/Infra and its existing remote checkout, locks and
  resource policy. [TOOLING](docs/TOOLING.md). No research/test clone is required.

Bun/Obscura retain their build graphs. Next/Turbopack uses its pinned nightly
on the factory. Do not force incompatible panic profiles into one executable.
