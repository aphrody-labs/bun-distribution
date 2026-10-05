<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody in a container

Status (2026-10-05): the files below are written and statically checked; **the images were not built** (no Docker
daemon could be started in the cloud container that produced them), so a first `docker build` is the first proof.

| File | Role |
| --- | --- |
| [config/container/Dockerfile](../../../config/container/Dockerfile) | Targets `base` (Ubuntu 24.04, Bun and uv pinned), `deps` (frozen Bun install), `runtime`, `dev` |
| [config/container/entrypoint.sh](../../../config/container/entrypoint.sh) | One command word selects the surface: `mcp`, `m3-mcp`, `api`, `yolo`, `aphrody`, `shell` |
| [config/container/compose.yaml](../../../config/container/compose.yaml) | Services `api` (default), `mcp` (profile `tools`), `dev` (profile `dev`) with named volumes |
| [.devcontainer/devcontainer.json](../../../.devcontainer/devcontainer.json) | Dev container on the `dev` target |
| [.dockerignore](../../../.dockerignore) | Sources only: no `.git`, `node_modules`, `target`, databases, models, credentials or cookies |

## Use

```sh
# Bun-side services (yolo MCP, aphrody-m3 MCP, HTTP API)
docker build -f config/container/Dockerfile --target runtime -t aphrody:runtime .
YOLO_API_TOKEN=<secret> docker compose -f config/container/compose.yaml up --build api
docker run --rm -i aphrody:runtime mcp            # MCP over stdio for a client

# Build host (Rust toolchain, cargo tools, oxlint/oxfmt)
docker compose -f config/container/compose.yaml run --rm dev
#   inside: scripts/build/rust/cargo-serial.sh check --locked -p <crate>
```

## Behaviour

- **Non-root, no secret in the image.** User `aphrody` (uid 1000); `~/.aphrody` is a volume; the HTTP API refuses to bind
  `0.0.0.0` without `YOLO_API_TOKEN` (the entrypoint exits 64), and compose publishes it on the host loopback only, with a
  read-only root filesystem, no capabilities and `no-new-privileges`. Credentials, cookies and databases of the owner
  machine are never copied (`.dockerignore`, [agent home setup](../cloud/AGENT-HOME-SETUP.md)).
- **The container is its own build host.** The `dev` target sets `APHRODY_CLOUD=1`, the profile of a Claude cloud
  session: Cargo runs locally through `scripts/build/rust/cargo-serial.sh` (jobs = CPU count, max 6), the factory
  routing stands down (`heavyBuildStatus` accepts `APHRODY_CLOUD=1`, tested). Scoped `-p <crate>` gates only; full
  workspace and engine builds (V8, Tauri, WebKit) need a larger host or the VPS factory.
- **Pins follow the repository.** Bun and uv versions are build arguments (`BUN_VERSION`, `UV_VERSION`, defaults from
  `package.json` and `config/system-packages.json`); the Rust channel is read from `rust-toolchain.toml`.
- **Verified outside Docker** (same entrypoint, same Bun 1.4.2): `mcp` answers `initialize`; `api` without a token exits 64;
  with a token it binds `0.0.0.0:$PORT` and `/health` answers `ok`.

## Not covered

- The Rust `aphrody` binary and `aphrody-mcp` are not in the `runtime` image: mount a prebuilt binary or install it from
  the download server (`APHRODY_DOWNLOAD_BASE`, see [CLOUD-SYNC](../cloud/CLOUD-SYNC.md)). `entrypoint.sh aphrody` says so
  when it is missing.
- The `runtime` image carries the whole checkout with `node_modules` (simple, not minimal); a slimmer image needs a
  compiled `yolo` and is a separate step.
- Desktop (Tauri/GTK/WebKit) and GPU/model workloads are out of scope for these images.
