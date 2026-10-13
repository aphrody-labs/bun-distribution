# Aphrody / Bun control plane

Aphrody Infra owns hosts, services, routes and lifecycle. Komodo is the Rust
deployment actuator; Gitea owns Git hosting and its runner owns CI execution.
The existing Infra catalogs remain the single desired-state source.

## Placement

All control services use the qualified VPS under its configured `~/apps`
layout. One `aphrody` Compose project includes `gitea`, `komodo` and
`gitea-runner`. Existing workloads and protected stores remain independently
owned. No local Windows build or WSL is part of this deployment.

| Capability | Loopback port | Domain |
| --- | --- | --- |
| video | 29000 | app-video.aphrody.app |
| generation | 29001 | app-generation.aphrody.app |
| images | 29002 | app-images.aphrody.app |
| vectors | 29003 | app-vectors.aphrody.app |
| compositing | 29004 | app-compositing.aphrody.app |
| photo-processing | 29005 | app-photo-processing.aphrody.app |
| pdf | 29006 | app-pdf.aphrody.app |
| documents | 29007 | app-documents.aphrody.app |
| audio | 29008 | app-audio.aphrody.app |
| layout | 29009 | app-layout.aphrody.app |
| cad | 29010 | app-cad.aphrody.app |
| slides | 29011 | app-slides.aphrody.app |
| tables | 29012 | app-tables.aphrody.app |
| interface-layouts | 29013 | app-interface-layouts.aphrody.app |
| Git forge | 29020 | git.aphrody.app |
| Deployment | 29021 | deploy.aphrody.app |
| Git SSH | 29022 | Private tunnel only |

This table describes canonical reservations. Application slots stay staged,
without a container or systemd unit, until a verified native artifact qualifies.
Their initial ingress returns 503. Cloudflare owns public DNS and shared R2;
Workspace owns immutable assets through its CAS/S3 adapter. The artifact
package owns native extraction and artifact manifests.

## Authentication and persistence

Gitea installation is locked, signup is disabled, repositories default to
private and anonymous repository viewing requires sign-in. Create the first
admin through the native CLI on the private origin with a random password
captured directly into the protected secret store.

Komodo creates the configured admin from a mounted password file. Local and
OIDC registration are disabled. MongoDB is private; JWT, webhook and database
credentials remain mounted files in `~/.aphrody/secrets/control`. Persist Core
and Periphery keys. Initialize and verify both admins before enabling ingress.

Gitea 28.1.0, Runner 5.0.0, Komodo 2.3.3 and MongoDB 8.0.32 use version and
registry digest pins in their canonical Compose sources. Runtime databases,
repositories and runner registration live under each app's protected data tree.

## CI contract

Use `builtin:checkout` and explicit Bun commands. Stock JavaScript actions
dispatch to Node and are outside this Bun-only workflow. Keep GitHub origins
and histories; mirror into Gitea without rewriting commits.

The runner accepts one trusted job with a finite timeout and bounded CPU,
memory and logs. Its pinned existing build image receives the qualified native
Linux Bun binary at `/usr/local/bin/bun` as a read-only mount, with
`BUN_EXECUTABLE` set to that path. Jobs use the `aphrody-bun-linux` label.
Runner and Gitea allow at most 720 minutes per job; capacity stays one, with
two CPUs and 8 GiB per job. Library and SDK mirror Actions stay disabled. The
root mirror admits manual source qualification; its factory workflow remains
disabled until native host admission is ready. Native builds additionally
require an explicit dispatch input. Linux and Windows runtime
revisions and artifacts retain separate qualification.

## Qualification

Observed on 2026-10-13:

- Canonical Infra validation: 59 services, 36 routes; Compose configuration valid.
- Gitea 28.1.0 and Komodo 2.3.3 admins authenticated on private origins before ingress.
- Periphery 2.3.3 connected with persisted, explicitly pinned SPKI keys; server state `Ok`.
- Runner 5.0.0 registered and online with the `aphrody-bun-linux` label.
- A 16-domain TLS certificate is valid until 2027-01-11, with scheduled renewal.
- Windows HTTPS probes: Git login and Komodo 200, Git installer 404, staged video 503.

MongoDB 8.0.32 uses its [official Linux rseq configuration](https://github.com/mongodb/mongo/blob/r8.0.32/buildscripts/resmokeconfig/suites/rseq_kernel_check.yml):
`GLIBC_TUNABLES=glibc.pthread.rseq=1`. This selects per-thread allocation on the
VPS Linux 7.0 kernel and retains MongoDB's compatibility guard.

Credentials stay in `~/.aphrody/secrets/control` (directory 0700, files 0600).
The MongoDB password file is 0640 with container group 999 so its unprivileged
process can read the exact mount; the host parent directory stays private.
Runner registration is a private 0600 file in its 0700 data directory.

The [CI receipt](../infra/control/qualification.json) records real Gitea
[run 5](https://git.aphrody.app/aphrody-labs/bun-libraries/actions/runs/5): all
seven source qualification steps passed at `c742e3a50f6880897f2aa55135b2986188f230f0`.
Native types checked 57 files; runtime identity matched the Linux pin, frozen
installation, lint, formatting and the application plan passed. No native
builds or tests ran. Checkout initializes configured first-level submodules.
Only the qualified Bun file is allowed as a read-only host mount; its directory
is selected through `GITHUB_PATH` before the remaining gates.

All 18 Git mirrors are private and populated: the root repository, 16 library
forks and the Bun SDK. GitHub origins and histories remain intact; LFS payloads
were not copied. The large Bun mirror completed server-side after its bounded
client timed out; the receipt reflects the live repository inventory.
Native application builds and authenticated engine operations retain separate
qualification.
The owner's first video build restored its existing sccache temporary directory
`~/build/cache/sccache/control-plane-tmp` before native job admission; the control
plane deployment did not run Cargo or tests.
