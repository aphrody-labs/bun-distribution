<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody in a container

The `runtime` image installs the published Aphrody and Yolo Linux artifacts with the existing SHA-256-verifying
installer. It has no repository checkout, workspace `node_modules`, Bun/uv developer toolchain, or Rust build tools.
The `dev` image keeps the source workspace and adds Bun, uv, Rust and build tools. Toolchains are installed
before the checkout/dependency layer, so code changes reuse them. The `wasm-toolchain` target installs both
Rust WASM targets, `wasm-bindgen-cli` matching `Cargo.lock`, `wasm-pack`, and Binaryen 132 (`wasm-opt -Oz`).
It selects checksum-verified AMD64 or ARM64 prebuilt tools without compiling cargo-binstall. `wasm-artifacts`
compiles and exports the portable command package without installing Bun workspace or Python ML dependencies.
The opt-in `release-builder` adds the frozen Bun workspace and every locked Python workspace dependency.
The separate Ubuntu desktop image supplies GTK4/CEF build or runtime libraries; the Alpine/COSMIC
image stays independent of GNU binaries.

| File                                                                                      | Role                                                                                      |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [config/container/Dockerfile](../../../config/container/Dockerfile)                       | `runtime`, `dev`, `wasm-toolchain`, portable `wasm-artifacts`, and full `release-builder` |
| [config/container/desktop/Dockerfile](../../../config/container/desktop/Dockerfile)       | Ubuntu GTK4/CEF builder and non-root desktop runtime                                      |
| [config/container/aphrody-os/Dockerfile](../../../config/container/aphrody-os/Dockerfile) | Alpine musl Bun runtime, CLI userland, and COSMIC desktop                                 |
| [config/container/entrypoint.sh](../../../config/container/entrypoint.sh)                 | Selects `mcp`, `api`, `yolo`, `aphrody` or `shell`                                        |
| [config/container/compose.yaml](../../../config/container/compose.yaml)                   | Loopback-only API, stdio MCP, developer shell, and release builder                        |
| [.devcontainer/devcontainer.json](../../../.devcontainer/devcontainer.json)               | VS Code dev container on the `dev` target                                                 |
| [.dockerignore](../../../.dockerignore)                                                   | Excludes caches, outputs, coordination state and protected data                           |

## Run

```sh
docker build -f config/container/Dockerfile --target runtime -t aphrody:runtime .
docker run --rm aphrody:runtime aphrody --version
docker run --rm -i aphrody:runtime mcp
YOLO_API_TOKEN=<secret> docker compose -f config/container/compose.yaml up --build api

docker compose -f config/container/compose.yaml run --rm dev
# inside the source container:
scripts/build/rust/cargo-serial.sh check --locked -p <crate>

# Complete Rust/Bun/Python release toolchain, with all locked Python workspace dependencies
docker compose -f config/container/compose.yaml --profile release run --rm release-builder
# inside: cd packages/infra/cli-wasm && bun run build:wasm

# Export the browser/Bun module, JS glue and TypeScript declarations.
docker buildx build -f config/container/Dockerfile --target wasm-artifacts \
  --output type=local,dest=dist/container-wasm .

# Rebuild from an explicit immutable download release instead of resolving latest.
docker build -f config/container/Dockerfile --target runtime \
  --build-arg APHRODY_RELEASE=<release-id> -t aphrody:runtime .
```

The Ubuntu GTK4/CEF app environment is built separately because its native desktop libraries do not belong in the
compact API/MCP runtime:

```sh
docker build -f config/container/desktop/Dockerfile --target builder -t aphrody:desktop-builder .
docker build -f config/container/desktop/Dockerfile --target runtime -t aphrody:desktop-runtime .
```

`aphrody:desktop-runtime` supplies application/UI libraries for host X11/Wayland display forwarding; it does not
start a virtual desktop or fetch the CEF bundle. See the desktop README for launch wiring. WASM artifacts use the
explicit optimizer feature set already declared by `scripts/build/rust/wasm-package.ts`, which keeps generated glue
compatible with Bun's JavaScriptCore and browser engines.

## WASM, browser and native FFI

The release builder covers the repository's existing Rust-to-WASM package path (`wasm32-unknown-unknown` plus
`wasm32-wasip1`); it does not compile Bun itself to WASM. The browser bundle is a separate output: use Bun's browser
target and ship the generated JS/WASM module with the application. A native `bun:ffi` library follows the host C ABI
and cannot be loaded by a browser or WASI module. Share Rust logic across targets and expose separate host adapters
(native C ABI/Node-API for Bun, generated WASM bindings for browser or WASI), with explicit ownership and error
contracts.

`container2wasm` wraps a Linux image in an emulated machine and is a compatibility/testing route, not the default
for small Aphrody services. New portable services should compile directly to a supported WASI target. WASI Preview 1
does not provide general networking; select the WASI version and host capabilities deliberately. Use x86 emulation
such as v86 only when browser-based hardware/OS compatibility is the goal.

`APHRODY_DOWNLOAD_URL` is a Docker build argument for a release mirror. The installer resolves `latest.json` once
(or uses `APHRODY_RELEASE`) and fetches checksums and artifacts under `/releases/<id>/`. It verifies archives before
activation and installs Yolo without its Rust scaffold sources. The GitHub workflow selects one release for the
whole matrix and exports the compiled WASM package as a workflow artifact. No registry publication is configured.

The runtime runs as uid 1000, keeps `~/.aphrody` in a volume, and requires `YOLO_API_TOKEN` before binding the API to
`0.0.0.0`. Compose publishes the API on host loopback and drops capabilities. The `.dockerignore` excludes `.coord`,
`.codex`, `.git`, build outputs, local databases, model weights and credential files. Fetched `vendor/bun` and
`vendor/deno` trees are excluded; native engine source acquisition follows `config/vendor.json`. Integrated sources
under `crates/` remain available. Python's venv lives outside `/app`, so mounting a checkout keeps it available.
Cargo target/registry/git, sccache and uv caches are mounted during builds and do not become image payloads.

## Current limits

- Docker CLI is absent in this WSL session; the factory runs Docker 29.1.3 and Buildx 0.30.1. The pinned runtime
  was built there and passed native CLI/Yolo/MCP launch, UID 1000 and missing-token checks. Podman 4.9.3 previously
  built the Alpine CLI and Ubuntu desktop runtime. Full release-builder and ARM64 builds remain to qualify.
- The published Aphrody and Yolo artifacts currently cover Linux x86_64; native ARM64 images require both artifacts
  for that target. The portable toolchain supports AMD64 and ARM64 tool downloads; the workflow declares both for
  the minimal Alpine runtime. Windows `yolo` and macOS native release artifacts remain unavailable.
- The separate Alpine/COSMIC image remains in `config/container/aphrody-os`. CEF desktop, GPU drivers and model weights
  are not part of the compact CLI runtime image.
- The `dev` image uses the full checkout and installs workspace dependencies. It is intentionally separate from the
  compact runtime image.
- The `release-builder` image is a disposable build environment: Rust and Bun remain pinned to repository manifests,
  and the Python workspace syncs with `uv.lock`. Use repository release scripts and build factories for native engines;
  this image does not silently bypass them or publish artifacts.
- The stripped Aphrody runtime image measured 475,484,521 bytes in Podman versus 1,050,639,821 bytes for the first
  smoke-build iteration. This is a measured reduction against that initial image iteration, not a comparable
  before/after release benchmark or a claim that all builds or binaries are 50% smaller.
- On 2026-10-07 the new packaging script generated a valid, runnable 4,231,918-byte command WASM module from a
  checksum-fetched factory artifact (5,597,813 bytes before `wasm-opt`). Its SHA-256 is
  `8656c5295cae81b0123b87c69f0452f3311ee00846419c4f9f3c0ce08238d977`. This qualifies the packaging path; it does
  not establish a full-workspace Docker build or the target build-time reduction.
