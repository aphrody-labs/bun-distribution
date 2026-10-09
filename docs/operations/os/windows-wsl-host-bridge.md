<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native Windows host bridge and optional Linux guests

> Current context (2026-10-09): development and builds follow the selected host. The Windows installer creates native services only and retires its old WSL boot task on upgrade. Guest transport observations below are historical WSL qualification, not proof of Docker/other guest support. Existing authentication principals are preserved.

The Windows host service runs as LocalSystem, the Linux privileged helper as root,
and the desktop companion as the signed-in Windows user. The user's Linux kernel
imports their tool catalogs as `windows_*`, `privileged_*` and `desktop_*`.
Windows imports Linux tools as `linux_*`. Calls, results and subscribed bus events
travel over persistent authenticated Hyper-V byte streams, without an IP listener.
This is a control plane, not a GPU, audio or disk streaming protocol.

## Install

Build the Linux control plane and native Windows host:

```bash
cargo build -p aphrody-kernel --bin aphrody-kernel --bin aphrody-host-service --locked
cargo build -p aphrody-kernel --no-default-features --target x86_64-pc-windows-gnu --bin aphrody-host-service --locked
```

MSVC is also supported through `bun scripts/build/rust/cargo-serial.ts --msvc`. Preserve the
configured sccache wrapper; any opt-out requires a demonstrated compiler issue
and a recorded reason. The initial historical artifact was the GNU build.

Stage the Windows executable and `scripts/release/install-host-bridge.ps1` in a
Windows administrator-owned directory. Run elevated PowerShell:

```powershell
.\install-host-bridge.ps1 -Binary C:\ProgramData\Aphrody\HostStaging\aphrody-host-service.exe
```

The installer puts binaries, private authentication and boot configuration under
`C:\ProgramData\Aphrody\Host`, restricted to SYSTEM, administrators and the owner.
It registers the two Hyper-V service GUIDs for ports 47651 and 47652, creates the
automatic `AphrodyHost` SCM service with restart recovery, the interactive
`AphrodyDesktopBridge` logon task. WSL is not started or required by installation.

The following Linux guest setup is optional and retains its historical scope.

With `/etc/wsl.conf` configured for `systemd=true`, run as the Linux owner:

```bash
scripts/release/install-linux-host-bridge.sh
```

This installs stable user binaries, the root-owned helper binary, private tokens,
user units, the root unit and login linger. Upgrades replace binaries atomically.
The bridge configs are private files under `~/.config/aphrody/host-bridge`;
root authentication lives under `/etc/aphrody/host-bridge`. Never copy them into Git.

## Use and check

```bash
aphrody-kernel call windows_get_memory_info '{}'
aphrody-kernel call desktop_list_windows '{}'
aphrody-kernel call privileged_nu_eval '{"code":"^id -u"}'
aphrody-kernel call nu_eval '{"code":"aphrody wsl status"}'
aphrody winclean call windows_get_os_info --json
python3 scripts/audit/os/host-bridge.py
```

The CLI routes the three imported prefixes to the running kernel. Nushell has the
structured `aphrody wsl` builtin: status, distributions, processes, fixed read-only
probes and literal-argument exec. The desktop Rust facade and Tauri commands expose
Windows host status, windows and observation through the same typed kernel client.

`system/publish` events cross once under `bridge.linux.*`, `bridge.windows.*`,
`bridge.desktop.*` or `bridge.privileged.*`; imported events are not reflected back.
Tool changes and generated skills are not exported recursively. Tool catalogs are
sampled on connection; restart the corresponding bridge after adding native tools.
The bridge checks both peers every five seconds, reconnects with bounded backoff,
and re-registers catalogs. Calls with unknown outcomes are never replayed.
HCS resolves the exact running WSL VM GUID and the host rebinds when it changes.
Established Windows I/O uses IOCP; Linux uses nonblocking vsock readiness.

The privileged helpers grant the authenticated owner all tools exposed by their
kernel. LocalSystem/root authority is subject to each OS and driver contract.
Neither identity makes all host RAM, GPU registers, Windows boot disks or PCI devices
available raw inside WSL. Windows-side supported operations can run through the
host tools; GPU compute already uses `/dev/dxg` and the Windows NVIDIA driver.
USB requires a real USB/IP exporter/attachment; a generic RPC is not a USB transport.

## Evidence on 2026-10-01

- Windows service: automatic, Running, LocalSystem identity confirmed by a host call.
- WSL startup task: Running after an explicit scheduler start; cold boot not exercised.
- Desktop companion: visible session windows enumerated successfully.
- Root Linux helper: `privileged_nu_eval` returned UID 0.
- Two Hyper-V bridges: each exported 166 Windows and 320 Linux tools.
- 100 persistent ping samples: median 0.078 ms, p95 0.156 ms, maximum 0.168 ms
  in one run. Other observed runs had scheduling outliers; these are RPC RTT samples,
  not bulk-transfer throughput or a latency guarantee. A later run during builds
  measured median 0.198 ms, p95 0.769 ms and maximum 1.712 ms.
- Reverse Windows-to-Linux call and events in both directions succeeded;
  an invalid authentication token was rejected.
- WinClean, Nushell and kernel-client library tests passed; kernel tests passed
  79 with one credential-dependent GCS test ignored. Linux scoped strict clippy,
  native Windows GNU build, MSVC check, desktop library and CLI checks passed.
- Broader default-feature clippy encounters the existing terminal-backend
  `result_large_err` warning. The first CLI check hit concurrently edited RAG code;
  the subsequent CLI check passed after its owner corrected it.

Source audits live in `.cache/upstream/audits/{wsl-boot,hardware-access}.md`.
Official clones are under `.cache/upstream/{WSL,wslg,WSL2-Linux-Kernel,terminal}`.
Audited commits: WSL `c34e75aea8dcc50c0c2f9e76b2de9b26a58e8b67`, WSLg
`6942bb534b537302a7a22617261d9274db3cfa37`, kernel
`14794180686c2fb6307fbe359c359bec765249f3`, Terminal
`2b5336c1fca1e53ceeaac09710a13c478938cc8d`. Cloned sources are not evidence that
installed upstream binaries were built at those revisions.

The boot audit traced distribution quoting to WSL's `WslClient.cpp:1587` and
`helpers.cpp:664–681`; a S4U task invoking a protected PowerShell script resolves it.
GPU, guest memory, disk passthrough and session restrictions were checked in the
WSL owners and the dxgkrnl, USB/IP and Hyper-V kernel implementations.

References: [Microsoft Hyper-V sockets](https://learn.microsoft.com/windows-server/virtualization/hyper-v/make-integration-service),
[HCS enumeration](https://learn.microsoft.com/virtualization/api/hcs/reference/hcsenumeratecomputesystems),
[Windows service sessions](https://learn.microsoft.com/windows/win32/services/interactive-services),
[WSL filesystem contracts](https://learn.microsoft.com/windows/wsl/filesystems).
