<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody OS

Privileged user-space control plane. `aphrody-kernel` exposes system capabilities
through local MCP/IPC; desktop, AI and Bun callers are clients.

<a id="sibling-repositories"></a>

## Capabilities and ownership

- Windows administration: `aphrody-winclean` through the kernel `admin` subsystem.
- Processes, policy and services: `aphrody-proc`, `sandbox`, `execpolicy`, `guard`, `systemd`.
- Persistent work: `aphrody-jobs`, `cron`, `task-runner`, events and telemetry.
- System libraries: coreutils adapters, reverse engineering, capture, filesystem
  indexing/search, secrets and settings. See [architecture](../../architecture/os/ARCHITECTURE.md).
- Drive backend: the isolated [FSL migration workspace](../../../../apps/aphrody-drive/README.md) holds
  the imported core, daemon, CLI and bundled adapters pending runtime cutover.
- Bun clients: `@aphrody/os`, `@aphrody-code/winclean`; the unified agent plugin in the sibling `../aphrody-ai/plugins/aphrody/` repository path.

Contracts owns `aphrody-subsystem`. Shell and Compat supply the lower-level
capabilities declared in Cargo.toml. Higher-layer Web/UI providers
run as supervised MCP processes. The unified Aphrody plugin is maintained in
`../aphrody-ai/plugins/aphrody`; the OS kernel remains independent of AI at the
Cargo layer; Infra owns deployments.

## Start and validation

```sh
export RUSTC_WRAPPER=
cargo run -p aphrody-kernel -- --help
```

Use repository toolchain pins. [AGENTS.md](../../reference/os/AGENTS.md) owns NHITL and validation;
Bun integration tests require a built `aphrody-kernel`. Local dispatch policy is
not universal process confinement or production rollout evidence.

- [Documentation index](./_source/README.md)
- [Architecture and open gates](../../architecture/os/ARCHITECTURE-GAPS-STATUS.md)
- [WinClean plan](../../reference/os/WINCLEAN-RUST-CONVERGENCE.md)
- Third-party sources

Apache-2.0. Keep upstream pins and data outside source inventories distinct.

## Automatisation transversale

`scripts/tools/os/scripts/fix-all.nu` conserve son entrée Nushell et délègue les liens, références, dépendances et contrôles au module `yolo ops workspace-repair`.

`bun run check:runtimes` délègue les versions Bun/uv à `yolo ops runtime-versions`.

`scripts/tools/os/scripts/strip-ai-trailers.nu` conserve sa syntaxe et délègue la réécriture explicite d’une branche non publiée à `yolo ops git-attribution`.

`scripts/tools/os/scripts/repair-cargo-p.nu` est l’entrée compatible de `yolo ops cargo-package-repair`.
