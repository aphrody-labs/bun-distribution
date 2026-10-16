# Steam platform owners

| Owner                                   | Canonical path                          | Upstream branch |
| --------------------------------------- | --------------------------------------- | --------------- |
| `aphrody-labs/steamcmd`                 | `src/platform/steamcmd`                 | `master`        |
| `aphrody-labs/steamcmd-api`             | `src/platform/steamcmd-api`             | `main`          |
| `aphrody-labs/steamos-nvidia-installer` | `src/platform/steamos-nvidia-installer` | `main`          |

The SteamCMD owner provides minimal Debian container definitions for Valve's
SteamCMD client. It owns dedicated-server and SteamPipe provisioning without
embedding Steam credentials or login sessions in Bun Engine. Persistent login
state remains in an explicitly mounted protected volume.

The SteamCMD API owner exposes read-only `app_info` metadata. Its web and job
services remain isolated source owners; Bun Engine consumes the HTTP contract
with native `fetch` and does not duplicate their cache or worker implementation.
Redis and job processing are deployment-scoped and no credentials are committed.

The SteamOS NVIDIA installer remains the separate recovery-image owner. Neither
source is bundled into the Bun Engine executable. Container image builds and
privileged recovery-image assembly require their qualified Linux hosts.
