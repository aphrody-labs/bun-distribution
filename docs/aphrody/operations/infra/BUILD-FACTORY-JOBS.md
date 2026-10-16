<!-- SPDX-License-Identifier: Apache-2.0 -->
# Durable native factory jobs

Owner: Workspace/Infra. Source:
[factory CLI](../../../../packages/workspace/src/build-factory.ts) and
[job supervisor](../../../../packages/workspace/src/build-factory-jobs.ts).
The selected [factory configuration](../../../../tools/aphrody/config/build-factory.json)
must enable the canonical VPS and must not mark it execution-only.
This capability does not provision a host or change its placement policy.

Plan a pinned owner command with an explicit stable job ID:

```sh
/home/aphro/yolo/bin/yolo ops build-factory plan \
  --repo aphrody --revision FULL_40_CHARACTER_GIT_SHA \
  --detach --job ffi-release-20261005 \
  -- scripts/build/rust/cargo-serial.sh build --release --locked -p aphrody-ffi
```

Replace `plan` with `run` to submit through the installed native Infra SSH owner.
Submission detaches the host supervisor and redirects its standard streams to
private host files. Repeating the same ID and request observes the existing
job; a different request with that ID is refused. No automatic replay, adoption
or cancellation of earlier attached jobs is provided.

Observe a job without starting another command:

```sh
/home/aphro/yolo/bin/yolo ops build-factory status \
  --job ffi-release-20261005 --tail 20
```

The existing `status --route` remains the Cargo wrapper's routing contract.
Job tails accept 0–200 lines and at most 65,536 UTF-8 bytes per stream.
SSH observation uses a 60-second deadline. A transport error or an invalid
acknowledgement reports an unknown result requiring reconciliation; it does
not assert that the remote command failed or never ran.

The original owner plan runs unchanged under the heavy, repository-source and
Cargo locks. Revision and cleanliness checks still happen after lease acquisition.
`active` means the detached supervisor is alive, including time waiting for a
lease. A successful or failed command requires its atomically written exit
receipt. Process identity includes PID, start ticks and Linux boot ID; an absent
supervisor without a terminal receipt is indeterminate.

The configured command timeout includes queue wait and execution on the host.
At expiry, the supervisor kills its own command process group together so a
compiler cannot continue after its lease holder exits. Shared cache daemons
retain their separate lifetime and do not inherit the lock descriptors.

Job records live under `artifactRoot/factory-jobs/JOB_ID`: directories are 0700,
regular files are 0600 and writes are atomic. Symlinks, foreign permissions,
conflicting IDs and artifact locations overlapping sources or locks are refused.
Keep job scripts, logs and receipts on the protected host; never stage runtime
output or credentials.

An exit-zero receipt establishes command completion. Artifact provenance,
checksums, ABI, consumer behavior, packaging and activation need their owner gates.
The sample Cargo command alone does not produce an installed release manifest.
