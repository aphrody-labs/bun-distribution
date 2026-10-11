<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native build fleet

Workspace owns `build-fleet`; `ops.ts` routes it alongside the existing
`build-factory`. Configuration is `tools/config/build-fleet.json`. The four
declared hosts are local Windows, Omar Windows, VPS Linux and DBFR Linux.
No Chromium source tree is duplicated and no distributed compiler protocol
is claimed. The VPS factory keeps its existing heavy/source flock ordering
and source/cache policy. DBFR accepts metadata probes only; heavy builds are
disabled to preserve production capacity.

Run the source entry with the installed fork:

```powershell
bun packages/infra/workspace/src/build-fleet.ts readiness
bun packages/infra/workspace/src/build-fleet.ts plan --file requests.json
bun packages/infra/workspace/src/build-fleet.ts run --file requests.json
bun packages/infra/workspace/src/build-fleet.ts status --id public-build
```

Requests are an array. A metadata request is
`{"id":"native-probe","kind":"probe","host":"omar","memoryGiB":0.1,"jobs":1}`.
It executes the fixed public metadata program; supplied arbitrary commands
are never executed as a probe. A build requires a full 40-character Git
revision, clean canonical source workspace, declared public owner Git remote,
native Bun factory command and explicit factory `-j` before execution arguments.
Only qualified hosts with matching OS, CPU budget, recent inventory, memory
reserve, disk capacity and unoccupied owner leases are eligible. Omitting
`host` selects the eligible host with the lowest observed CPU load. Omitting
`os` permits either native OS; specify it for target-specific jobs.

Windows readiness obtains physical available RAM and CPU load through CIM;
Linux uses native OS memory/load. Metadata probes retain at least 1 GiB free.
Heavy reserve is 4 GiB on local/Omar/VPS; DBFR has an 8 GiB heavy reserve and
heavy execution disabled. Max native jobs are local 4, Omar 2, VPS 6, DBFR 1.
Native Bun factory admission requires at least 10 GiB for the task plus the
host reserve, even if the caller declares less. Omar's 2026-10-11 native link
reached at least 8.84 GiB working set and available RAM fell to 0.74 GiB with
two compiler jobs. A smaller job count does not bound linker memory. Omar's
roughly 6.4 GiB idle baseline cannot admit another full Bun link with this
reserve; source/static/helper work remains separate from a full engine build.
Existing Chromium setup and Bun factory directory locks are preserved.
The scheduler allocates at most one request per host in each submitted batch.
It does not reserve resources against unrelated operating-system processes;
execution rechecks capacity and refuses changed conditions.

All request identifiers are reserved before any dispatch. Identical recorded
requests return existing receipts without replay; conflicting requests are
refused. Central private receipts live under the configured owner home
`.aphrody/build-fleet/requests`; each host stores its own private marker and
exclusive lease under `.aphrody/build-fleet`. The owner's existing home
junction is resolved canonically; a fleet child directory redirect outside
that home is refused. Lease removal requires the worker's matching token.
Foreign or stale leases are preserved for explicit reconciliation.
Status reads remote markers and validates PID identity with native Windows
process start ticks or Linux boot ID and `/proc` start ticks. Transport
uncertainty remains indeterminate and never triggers automatic replay.
This supplies durable request evidence, not a guarantee that an SSH-launched
build survives every host/transport failure.

2026-10-11 qualification: four real metadata workers were dispatched in parallel to
local, Omar, VPS and DBFR, each with terminal `complete`, exit code 0 and
matching request fingerprint/PID identity. Local Chromium compilation and
Omar's separately owned native factory were preserved. This qualifies native
transport, placement and receipt handling; the short remote probes do not
establish overlapping heavy execution. It does not qualify an engine build
on all four machines. Scoped tests exercise OS/capacity rejection, protected
DBFR placement, source pin validation, transport encoding and real isolated
workers for completion, replay refusal, foreign leases and terminal failure.
