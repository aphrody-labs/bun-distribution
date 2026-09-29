<!-- SPDX-License-Identifier: Apache-2.0 -->
# Koharu: Aphrody OS integration map

The 2026-09-27 comparison below records which Koharu system-facing capabilities
have a related owner in Aphrody OS and what would be required to connect them.
That snapshot was source inspection, not evidence of an integration, migration,
release, or runtime test.

## Working-tree update (2026-09-28)

Koharu now exposes the headless Rust [`koharu-library`](../../../products/koharu/crates/koharu-library/README.md)
for page import, detection, OCR, translation, inpainting, typed scene results,
and PNG/PSD export. `aphrody-ai` consumes it through the optional `koharu`
feature of `aphrody-manga`; the feature's focused Cargo check passed. The
library retains Koharu's model runtime, progress/cancellation, and document
ownership. Aphrody OS has no direct Koharu dependency, kernel subsystem, job
adapter, or shared secret/runtime service. The comparison below remains the
source snapshot from 2026-09-27.

## Source snapshot

- Koharu: `main` at `c697b31e` (`chore(deps): update Tauri CEF to 3.0.0-alpha.2`),
  clean worktree during inspection.
- Aphrody OS: `main` at `36683120` (`docs(shenron): aligner shenron-admin sur le
  formulaire securise et les 7 piliers`), clean worktree during inspection.
- No Koharu reference exists in this repository's tracked source/docs at that
  snapshot. The capabilities below are related by responsibility only.

## Capability map

| Koharu source capability | Existing Aphrody OS capability | Status and boundary |
|---|---|---|
| `koharu-runtime` discovers hardware and plans/installs/activates Torch, Llama and Diffusion packages; `koharu-ml` initializes the ML device; `koharu-pipeline` schedules model stages and exposes resource snapshots. | `aphrody-proc` has process groups, file locks and a GPU lease; `aphrody-compat` detects/routs Wine, Proton, .NET and PowerShell runtimes. | **No Koharu integration.** OS compatibility runtimes are not ML runtimes. The GPU lease may be relevant to a future shared GPU admission contract, but Koharu currently owns runtime selection, model loading and pipeline resources. Do not claim that the OS lease controls Koharu's GPU use. |
| `koharu-runtime::download` fetches runtime artifacts with retry/progress events; `koharu-runtime::Store` stages packages, validates them and publishes them under a process-wide store root. | `aphrody-jobs` provides durable queued work; `aphrody-proc` provides process lifetime and lock primitives. | **No shared download or artifact-store service is wired.** Koharu runtime installation is an in-process library flow, not an OS job or supervised child process. A future adapter must preserve Koharu's artifact validation, destination ownership and cancellation/error semantics. |
| `koharu-app::Processing` tracks jobs in memory, permits one active pipeline run, supports a pipeline stop token, and reports progress/terminal state over Tauri channels. | `aphrody-jobs` provides persistent SQLite jobs, leases, retries, crash recovery and NDJSON logs; `aphrody-task-runner` executes DAG work; `aphrody-proc` supervises OS processes. | **Related lifecycle, different contract.** Koharu jobs are tied to an open project/page and frontend channels; the inspected job map is process-local. OS durable jobs are reusable only through an explicit adapter that maps project identity, cancellation, progress and terminal states. They do not transparently replace `koharu-app` state. |
| `koharu-secrets` stores provider credentials through OS keyring backends under Koharu's own service namespace, wraps values for redaction/zeroization, and preference commands return configured/presence state. | `aphrody-secrets` owns Aphrody secret storage (environment/file and encrypted-file paths, redaction and zeroization). | **No shared secret contract.** Storage backends and namespaces differ; neither repository currently delegates Koharu credentials to the other. Keep credential values out of logs and status responses. Do not migrate or mirror credentials as part of this inventory. |
| `koharu-config` maintains typed live configuration in `.koharu/config.toml`, with atomic writes and in-process revisions/subscriptions. | `aphrody-settings` loads hierarchical user/project/local/environment JSON settings with merge and schema validation. | **Not format- or lifecycle-compatible.** There is no Koharu settings adapter. Koharu's config remains Koharu-owned; do not point it at Aphrody settings or convert it implicitly. |
| `koharu-app` is the Tauri host and exposes a typed Specta-generated command contract and Tauri channels to its UI. The app initializes model runtime and application state itself. | `aphrody-kernel` exposes OS-owned system subsystems over local IPC/MCP; `@aphrody/os` is a Bun kernel client. | **Separate host and protocol.** Tauri commands are not kernel tools or MCP. OS capabilities can be consumed as a client over the declared kernel contract if a concrete Koharu feature needs one; the kernel must not absorb Koharu project, canvas, editing, export or model APIs. No current Koharu client/adapter was found. |
| Koharu Rust ML crates include `koharu-torch`/`koharu-torch-sys`, `koharu-llama`/`koharu-llama-sys`, and `koharu-diffusion`/`koharu-diffusion-sys`, with native dynamic loading/build integration. | `aphrody-native` owns neutral portable native foundations and bridge ABIs; OS keeps process/policy control. | **No direct crate reuse established.** Koharu's model-specific FFI and runtime loader remain with Koharu. Do not add a dependency from the OS workspace to Koharu or copy its native wrappers; any cross-repository wire/API contract belongs at the appropriate neutral boundary. |

## Evidence in Koharu source

- Crates and ownership: [`koharu-app`](../../../products/koharu/crates/koharu-app/README.md),
  [`koharu-runtime`](../../../aphrody-koharu/crates/koharu-runtime/Cargo.toml),
  [`koharu-pipeline`](../../../products/koharu/crates/koharu-pipeline/README.md), and the root
  [`Cargo.toml`](../../../aphrody-koharu/Cargo.toml).
- Runtime package planning and activation: [`runtime/mod.rs`](../../../aphrody-koharu/crates/koharu-runtime/src/runtime/mod.rs),
  [`store.rs`](../../../aphrody-koharu/crates/koharu-runtime/src/store.rs),
  [`download.rs`](../../../aphrody-koharu/crates/koharu-runtime/src/download.rs).
- Tauri command surface and app state: [`commands/mod.rs`](../../../aphrody-koharu/crates/koharu-app/src/commands/mod.rs),
  [`commands/processing.rs`](../../../aphrody-koharu/crates/koharu-app/src/commands/processing.rs),
  [`commands/lifecycle.rs`](../../../aphrody-koharu/crates/koharu-app/src/commands/lifecycle.rs),
  [`app.rs`](../../../aphrody-koharu/crates/koharu-app/src/app.rs).
- Koharu credential/config implementations: [`koharu-secrets`](../../../aphrody-koharu/crates/koharu-secrets/src/lib.rs),
  [`koharu-config`](../../../aphrody-koharu/crates/koharu-config/src/lib.rs),
  and provider preference commands in [`preferences.rs`](../../../aphrody-koharu/crates/koharu-app/src/commands/preferences.rs).

## Aphrody OS owners to reuse when a real integration is specified

- Durable OS work and recovery: [`aphrody-jobs`](../../crates/aphrody-jobs/Cargo.toml).
- Process lifetime, locks and shared GPU leases: [`aphrody-proc`](../../crates/aphrody-proc/Cargo.toml).
- OS-managed secrets and settings: [`aphrody-secrets`](../../crates/aphrody-secrets/Cargo.toml),
  [`aphrody-settings`](../../crates/aphrody-settings/Cargo.toml).
- Kernel boundary and client ownership: [repository README](../../../products/os/README.md) and
  [OS architecture](../../../architecture/os/ARCHITECTURE.md).

An integration proposal should name the specific Koharu operation that needs OS
authority, the kernel IPC/MCP contract it would call, cancellation and restart
behavior, and which repository remains the source of truth. Until that exists,
Koharu's application, model and configuration behavior remains Koharu-owned.
