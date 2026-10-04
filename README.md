<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody

Private Rust/Bun monorepo for product applications, shared capabilities and
Workspace/Infra operations. Architecture and migration: [PLAN.md](PLAN.md).
Current evidence: [MEMORY.md](MEMORY.md). Working rules: [AGENTS.md](AGENTS.md).

| Path | Owner surface |
| --- | --- |
| `apps/<domain>/<app>` | Product applications |
| `packages/<domain>/<package>` | Bun packages |
| `crates/<domain>/<crate>` | Rust capabilities |
| [`m3/`](m3/README.md) | UI framework, shared components and `packages/app-ui` |
| `config/` | Build, product, host and deployment declarations |
| `scripts/` | Audit, build, dev, migration, release and tools |
| `docs/` | Canonical guides, contracts and generated references |
| `.coord/` | Claims and execution receipts |

Yolo produces the precompiled runtime and SDK. Aphrody keeps product behavior.
Python services and IECODE retain their separate repositories and stores.

Use existing capability owners, checkouts and caches. Run the selected package's
gates; Cargo uses `scripts/build/rust/cargo-serial.sh` and the configured factory.
Deliver authorized batches without intermediate confirmation. Preserve concurrent
changes and private data; distinguish tested source, artifact, installation and
activation.

[Documentation](docs/README.md) ·
[Workspace inventory](docs/reference/workspace/STATE.md) ·
[Operations](docs/operations/)
