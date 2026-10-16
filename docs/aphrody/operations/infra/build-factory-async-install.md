<!-- SPDX-License-Identifier: Apache-2.0 -->

# Detached build and verified installation

`yolo ops build-factory run --detach --job <stable-id> --install ...` submits a durable
factory build and returns after the native Infra owner confirms the submission. It no longer
waits for compilation or starts a download in the caller process. The returned receipt keeps the
factory job ID/fingerprint and says installation is pending; it does not claim that a binary was
installed.

Poll the existing read-only status operation:

```sh
yolo ops build-factory status --job <stable-id>
```

Only after status reports `succeeded`, run the matching explicit install operation with the same
repository, pinned revision, build command, job ID and optional binary selection:

```sh
yolo ops build-factory install --repo aphrody --revision <40-hex-sha> \
  --job <stable-id> --bin <binary-name> -- <same owner build command>
```

The install command rejects a job that has not succeeded. Artifact transfer still checks the
factory SHA-256 and byte count, probes the executable on the destination host, preserves the
previous binary, and uses an atomic replacement. A host-local lock serializes PATH activation;
an existing lock is preserved for explicit reconciliation, never cleared or replayed
automatically. Repeating an install for identical verified bytes is idempotent.

The detached build and status operations are nonblocking and durable on the factory. The
explicit artifact installation is still a synchronous local action. This contract does not make
npm/crates publication, GitHub release creation, application update or production deployment
asynchronous. Those operations need their own durable job owners, idempotency keys, receipts,
capacity/host locks, and plan/apply/health/rollback gates before they can be described as
nonblocking.
