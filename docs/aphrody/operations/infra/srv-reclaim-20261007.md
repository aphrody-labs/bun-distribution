<!-- SPDX-License-Identifier: Apache-2.0 -->
# VPS factory reclamation, 2026-10-07

The owner requested aggressive `/srv` reclamation and native `sudo-rs` execution.
The existing Infra factory cleanup operation removed the retired Aphrody Cargo
target under the global heavy lock. Runtime installations, rollback releases,
source worktrees, protected stores and shared compiler/package caches remain.

## Declared operation and evidence

- Policy: [build-factory.json](../../../../tools/aphrody/config/build-factory.json),
  `cleanup.retiredOutputs`, target `/srv/aphrody-build/cache/cargo/aphrody`.
- Terminal build receipt: factory job
  `downloads-aphrody-windows-x86_64-5bf7eed5a`, exit `0`, finished
  `2026-10-06T19:06:04.853Z`. Linux and Windows packaging jobs were terminal.
- Live process, filesystem mount and Docker bind-mount guards qualified the
  candidate immediately before deletion. Installed binary symlinks and systemd
  unit files did not reference this target.
- The persistent sccache server uses the distinct `aphrody-wsl` target. A sibling
  path match in the cleanup guard was corrected and covered by a regression;
  the server and its shared cache were preserved.
- Privilege executable: `/usr/bin/sudo-rs`, observed version `0.2.13-0ubuntu1.2`.
  Native Aphrody Infra SSH carried the operation; no legacy MCP alias was used.
- Retained private factory evidence:
  `/srv/aphrody-build/artifacts/srv-reclaim-20261007-aphrody/` contains the plan,
  apply result, terminal exit and before/after filesystem measurements. Cleanup
  runner PID `3669886` was missing when its exit `0` receipt was read.

## Measured result

`df -B1 /srv` was captured immediately around the serialized operation:

| Metric | Before | After |
| --- | ---: | ---: |
| Used bytes | 296,809,099,264 | 266,109,087,744 |
| Available bytes | 24,378,413,056 | 55,078,424,576 |
| Reported usage | 93% | 83% |

The removed target had **30,700,023,808 allocated bytes**. Actual filesystem free
space increased by **30,700,011,520 bytes**; receipts consumed a small amount of
space. Earlier retirement of four fork/Vu targets is a separate operation and
must not be counted again in this before/after comparison.

## Preserved scope

The active WSL target, global sccache, Cargo registry, Bun cache, Bun/WebKit build
cache, retained artifacts, source patches, deployment rollback trees, databases,
models, cookies and archives were not reclaimed. Docker storage is on the root
filesystem, so pruning it would not free `/srv`.

A task-owned abandoned read-only `du` process was terminated after its exact PID,
start time and command were verified. Other sessions' live scans and all builds
were preserved. Additional generated CDN scratch was inventoried but was not
included in the factory Cargo allowlist or deleted by this operation.

The single transient resource is `/srv/aphrody-build/transient`; its automatic
cleanup is owned by the existing factory wrapper. This receipt proves the
retired Cargo target reclamation, not a new runtime activation or release.
