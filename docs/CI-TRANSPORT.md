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

## Submodule mirrors

`builtin:checkout` runs `git submodule update --init --force` inside each job
container, in a fresh `gitea-work/<task>` workspace. Without a local source it
re-cloned every submodule from the network on each job, and it could not read
the private `aphrody-labs` submodules over HTTPS.

The VPS host keeps bare mirrors of every submodule URL of `aphrody-dev/bun-os`
`os` (nested submodules included) under `/home/ubuntu/build/git-mirrors/<host>/<path>.git`.
`infra/config/host/apps/vps/gitea-runner/git-mirrors.sh` (installed as
`~/apps/gitea-runner/git-mirrors.sh`) creates and refreshes them; the user
units `infra/config/host/systemd/aphrody/aphrody-git-mirrors.{service,timer}`
run it five minutes after each pass ends. It reads `.gitmodules` and the gitlinks
directly from Gitea's bare repository, seeds new mirrors with reflink copies of
existing clones (`~/src/bun-os/.git/modules`, finished job workspaces), keeps
complete mirrors for ordinary entries and depth-1 mirrors for `shallow = true`
and nested entries, and pins every referenced commit under `refs/pinned/`.

The host GitHub credential (`gh auth git-credential`) is passed on the command
line of the refresh process only. It is not stored in a mirror and never
reaches a job container.

The runner mounts the mirror root read-only into jobs at the same path and sets
`GIT_CONFIG_SYSTEM` to `/home/ubuntu/build/git-mirrors/jobs.gitconfig`, which the
refresh regenerates:

- one `url."file://<mirror>".insteadOf <url>` rule per mirrored URL;
- `protocol.file.allow = always` (submodule clones refuse local transports
  otherwise) and `safe.directory = *` (the mirrors belong to `ubuntu`, jobs run
  as root);
- `init.templateDir` pointing at a template whose `objects/info/alternates`
  names the empty bare repository `.reference`, plus
  `submodule.alternateLocation = superproject`. Every submodule clone then
  passes `--reference .reference/modules/<name>`, a link to its complete
  mirror: the clone transfers and copies no objects, which stay in the
  read-only mirror. Job workspaces therefore depend on the mount; do not ship a
  job's `.git` to another machine or image.

Depth-1 mirrors (`shallow = true` entries, nested submodules) cannot be
references; they are served through upload-pack, and each one's `HEAD` is the
newest pinned commit so `clone --depth=1` receives exactly that commit. A URL
without a mirror keeps its network URL; a new private submodule is served once
the next refresh has mirrored it.
