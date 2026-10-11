<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native CI automation through Workspace

Workspace owns continuous committed-source synchronization and its durable native
factory queue. The existing `repo-sync.ts` `once` and `watch` operations accept
`--apply --build --repo bun-os`. They prepare the captured immutable revision
through `build-factory.ts` and then execute the declared native owner command.
No additional runner, lock or scheduler is introduced.

`tools/config/commit-sync.json` declares the canonical sibling Bun checkout,
its existing `origin` remote, the public repository name `bun`, and the Infra
factory identity `bun-os`. Its native build is disabled with `buildEnabled: false`.
The queue and worker both enforce that switch; an already persisted job cannot
bypass it. Existing Aphrody source synchronization retains its behavior.

When enabled after qualification, the worker binds
`bun scripts/aphrody/native-ci.ts worker` to the durable job's exact revision and
an id derived from that revision and the request timestamp. Reconciliation keeps
the same id; a new explicit request has a distinct id. The authentication token
is neither the public job id nor an argument to native CI. The same revision is
passed to preparation, factory execution and the native worker. Configured extra
revision arguments are rejected. Source preparation and execution retain the
existing heavy/source locks and Cargo serialization.

Inspect the owner contract without executing a build:

```sh
bun packages/infra/workspace/src/repo-sync.ts --help
bun packages/infra/workspace/src/repo-sync.ts plan --build --repo bun-os --json
bun packages/infra/workspace/src/repo-sync.ts status --json
```

Activation requires the actual complete native CI receipt to succeed for the
selected Bun pin and declared sibling Aphrody pin, including strict installer
Clippy, Google/Web Rust checks, native tests and provenance. Keep the switch
disabled while any gate is red. Reconcile queued preparations and active owner
jobs before preparing another source revision; transport timeout does not prove
a remote process stopped.

Infra owns persistence through `tools/config/service-catalog.json` boot entries
and `aphrody infra boot plan|apply|audit`. A future timer/task must invoke the
existing Workspace owner and preserve its single synchronization lock. A `hold`
entry is audited but never corrected by `boot apply`. This batch creates or
activates no host timer/task and changes no concurrent service catalog.

Native CI receipts qualify their tested host only. Publication and deployment
remain with the existing release owner after its platform, artifact,
installation and activation gates. The seven Google 1.4.4 registry versions are
immutable; CI automation does not republish them. Chrome profile identity must
be established explicitly before authenticated binding, and private profile
stores never enter a public service or source repository.
