# Private submodule transport in CI

The existing `aphrody-gitea-runner` 5.0.0 uses the `aphrody_default` network
and the same Gitea instance as the public forge. Jobs on `aphrody-bun-linux`
resolve `bun-forge` to `gitea:22`; port `127.0.0.1:29022` belongs to the VPS
host, not the job container.

## Owner and files

The Infra source of truth is
`tools/config/host/apps/vps/gitea-runner/{config.yaml,ssh/config,ssh/known_hosts}`
in the Aphrody repository. The existing runner deployment is
`/home/ubuntu/apps/gitea-runner`. Install the two public SSH files there under
`ssh/`, preserving their source contents, before admitting a job that uses this
configuration. Reinstalling them is idempotent. Keep the existing Compose
definition, runner image and registration.

Keep the key only at
`/home/ubuntu/.aphrody/secrets/gitea/bun-os-crate-runner`, owned by `ubuntu`,
with mode `0600` and a `0700` parent directory. Mount it read-only into jobs at
`/run/aphrody/git-ssh/identity`. Never put key contents in Git, workflow
variables, process arguments or logs. The VPS Docker daemon resolves bind-mount
source paths; the key does not need to be copied into or mounted in the runner
container.

The SSH configuration selects one identity, requires ED25519 and verifies the
host strictly. `GIT_SSH_COMMAND` selects this configuration before
`builtin:checkout`. Allow only the required files as read-only volumes. The
alias is generic; each private repository's deploy key grants access, so adding
private gitlinks does not require changing the transport.

## Qualification performed

On 2026-10-13, the public key presented by VPS loopback port 29022 and by the
Gitea container at `aphrody_default:22` produced the same fingerprint:

```text
SHA256:M48ORSUT/TU1sYsWPunaXwQliH0bUVRviGx7m4gWOAs
```

The `known_hosts` file contains that public key under the `bun-forge` alias.
The existing secret's permissions were checked without reading its contents.
The installed `gitea-runner` binary reported version 5.0.0 and supplied the
configuration schema used here.

This change prepares the source configuration only. The runner was not
restarted, Compose was not activated, and no job was launched. Private-repository
checkout from an actual job remains unqualified until Infra installs these
files. Qualification must confirm `git` and `ssh` in the pinned job image,
read-only key access from the job, and authorization for every private gitlink,
without displaying the key.

## Live deployment status

A read-only check through Aphrody Infra on 2026-10-13 found no deployed `ssh/`
directory or public SSH files under `/home/ubuntu/apps/gitea-runner`. The
deployed runner configuration also lacks the three job mount paths declared by
the source configuration. The expected secret file and directory permissions
were present. Source changes have not been installed or reloaded, so a
successful local plan or source check does not qualify private submodule access
from the runner.

## Product workflow

Pushes to `main` and `os` run source checks. Checkout uses direct submodules and
retains their pinned revisions. Use the root setup owner: it prepares the pinned
Material Web archive with its public types before `bun install --frozen-lockfile`,
then invokes the shared-install owner `scripts/node-modules.ts`. Bare frozen
installation requires that archive to have already been assembled. Native builds
remain limited to an explicit dispatch with `build=true`, after host admission.
This preparation does not qualify a complete job or a native build.
