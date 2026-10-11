<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-os documentation

Documentation of the system layer. Repository layout, crates, sibling repositories, build and
CI: [`../README.md`](./README.md.712b5622bf2b). Agent rules: [`../AGENTS.md`](../../../reference/os/AGENTS.md).

Topics owned by sibling category repositories are documented there: agents, models, RAG and the
CLI in `aphrody-ai`; Nushell, terminal and TUI in `aphrody-shell`; the web engine, Obscura and
BXC in `aphrody-web`; Material 3, GUI, Tauri and rendering in `aphrody-ui`; Bun and N2B in
`aphrody-compat`; protocol contracts in `aphrody-contracts`; infrastructure and deployment in
`aphrody-infra`.

## Architecture

| Document | Subject |
|---|---|
| [ARCHITECTURE.md](../../../architecture/os/ARCHITECTURE.md) | Privileged control plane: subsystem contract, O(1) kernel dispatch, protocol, transports, subsystems (system, cloud, infra), agent connection. |
| [ARCHITECTURE-GAPS-STATUS.md](../../../architecture/os/ARCHITECTURE-GAPS-STATUS.md) | Architecture gap audit status, verified local gates, and production exit conditions. |
| [ARCHITECTURE-GAPS.md](../../../architecture/os/ARCHITECTURE-GAPS.md) | Original architectural gap register and remediation checklist. |
| [COORDINATION-COMPATIBILITY.md](../../../reference/os/COORDINATION-COMPATIBILITY.md) | Coordination tool storage and atomic file contract for compatibility. |
| [YOLO-AUTHORITY.md](../../../reference/os/YOLO-AUTHORITY.md) | Authenticated YOLO / NHITL authority of the kernel. |
| [UV-RUST-INTEGRATION.md](../../../reference/os/UV-RUST-INTEGRATION.md) | `aphrody-toolchains` route to the pinned uv source tree and runtime. |

## Integrations

| Document | Subject |
|---|---|

## WinClean

| Document | Subject |
|---|---|
| [winclean-native-import.md](../../../reference/os/winclean-native-import.md) | Rust-only WinClean ownership and the kernel `admin` boundary. |
| [WINCLEAN-RUST-CONVERGENCE.md](../../../reference/os/WINCLEAN-RUST-CONVERGENCE.md) | WinClean to native Rust convergence plan and ledger. |
| [WINCLEAN-RUST-LIBRARY-GAP.md](../../../reference/os/WINCLEAN-RUST-LIBRARY-GAP.md) | Windows Rust library choices (UIA, capture, ONNX/WinML, ViGEm, Windows Search). |
| [WINCLEAN-LIVE-ARTIFACTS.md](../../../reference/os/WINCLEAN-LIVE-ARTIFACTS.md) | Live WinClean artifact capture (`bun scripts/tools/os/scripts/live-winclean-artifacts.ts`, private hidden kernel). |
| [OPENAI-LOCAL-INVENTORY.md](../../../reference/os/OPENAI-LOCAL-INVENTORY.md) | Read-only local OpenAI / ChatGPT inventory (`bun scripts/tools/os/scripts/live-openai-inventory.ts`, private hidden kernel). |

## Records

- [research/](../../../research/os/research/): Rust OS architecture, systemd integration, reverse engineering
  (Ghidra, Electron, VS Code forks, tooling landscape).
- [CODEX-REMAINING-WORK.md](../../../reference/os/CODEX-REMAINING-WORK.md): Codex session handoff and remediation tracking.
