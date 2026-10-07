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
whole matrix and exports the compiled WASM package as a workflow artifact. Pull requests and normal pushes build
without publication. A manual workflow dispatch with `publish=true` publishes revision-tagged images to
`ghcr.io/aphrody-labs/aphrody:<matrix-cache>-<git-sha>` using the job-scoped GitHub token. Its optional `release`
input selects and verifies an explicit existing immutable downloads release. No floating image tag or package
visibility change is performed; repository and package access remain authoritative. Registry publication still
requires a successful workflow run, and is not established by the workflow source or Actionlint.

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

## Factory qualification — 2026-10-07

Docker 29.1.3 and Buildx 0.30.1 built `runtime` and exported `wasm-artifacts` on the VPS under the factory's
heavy-build and Cargo locks. The context was commit `41b54d557a84` with the Dockerfile's `cargo-binstall -V`
correction; the resulting Dockerfile SHA-256 was
`045b47e9426e27277d3f4dcf77d68cb5889c9f7f113e4130f5c398340ea90663`.

- Runtime used immutable downloads release `20261007T090053Z-41b54d557a84-assets-10b78047`. Its image digest was
  `sha256:e6ee5489b8853cd6802889afa09821349e0bd3545ca72f8780002f95cbf8b8dd`; Docker reported 199,902,869 bytes.
  This storage metric is not directly comparable with the earlier Podman size. An actual API health probe passed
  with a read-only root filesystem, dropped capabilities, `no-new-privileges`, and a read-only token file mount.
  The token value was absent from Docker's configured environment. Stop completed with exit 143 (SIGTERM).
- The Docker-built command module was 4,232,122 bytes after `wasm-opt -Oz`, from 5,598,005 bytes before optimization.
  Its SHA-256 was `c200ead00262f165d46539f4df7d48bfb6283a6bcd30296b71773ef2a24ba0df`. Instantiation under Bun,
  command help, JSON repair, HTML conversion using named input, invalid-input rejection, and 100 repeated calls passed.
  The four exported files were fetched through native SFTP and their SHA-256 hashes verified locally. The existing
  CLI-WASM, packaging, and entrypoint suites passed 26 tests with one native-parity test skipped.
  Browser execution and the rest of the native workspace still require their own qualification.
- GitHub Actions run `37598733049` did not start: its check annotation reports failed account payments or a spending
  limit. Factory builds above succeeded independently; no registry publication is established by that Actions run.

## Published one-click installers — 2026-10-07

Downloads release `20261007T092640Z-8081351f06e8-kits-e68aaa55` contains the nine inherited native/plugin artifacts
with unchanged hashes and four new installer artifacts built from clean commit `81cd80a3e8fdce199abae732a350578c0bc833bc`.
The publisher's existing immutable snapshot path now accepts qualified prebuilt stages:

```sh
bun scripts/release/publish-downloads.ts assets \
  --staged <setup-stage-directory> --staged <omar-stage-directory> \
  --staged-revision <full-build-commit>
```

It validates configured manifests, target, regular files, sizes, hashes and secret patterns, then preserves unrelated
artifacts and their build revision. New artifacts record their independent source revision. Installer scripts use
`latest.json`'s `assetChecksums`; `SHA256SUMS` continues to describe artifact payloads. Snapshot publication keeps
the existing reservation, checksum checks and atomic current-release selection.

All 13 host payload checksums, the four public installer hashes/sizes and six public asset hashes passed. Both
`aphrody.com` and `downloads.aphrody.com` link their Download Aphrody button to the immutable Setup EXE. Setup and
Omar passed PE32+/AMD64 checks and Wine 10 launch/version/simulation checks. These executables are unsigned;
execution on native Windows and the unavailable CEF desktop installer remain separate qualification items.

## Published container images — 2026-10-07

The existing organization package remains private. Authenticate through the existing GitHub account before pulling.

| Image                                                   | Immutable digest                                                          | Qualified scope                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ghcr.io/aphrody-labs/aphrody:runtime-81cd80a3e`        | `sha256:9584253e39340758b4efcb1d11e86aa48f165a3e045759f75bb4a600559c3031` | GNU x86_64 Aphrody/Yolo runtime; registry pull, API health, UID 1000, secret file and SIGTERM |
| `ghcr.io/aphrody-labs/aphrody:alpine-runtime-41b54d557` | `sha256:7506e634d1ab1acfadaaceb6a59d52629a02b62bd59ec1507c334816e7b55aad` | Official musl Bun 1.4.2 on AMD64 and ARM64; registry pulls, UID 1000, JS, WASM and SHA-256    |

The Alpine manifest retains both architecture images and their attestations. ARM64 ran through Ubuntu's QEMU 10.2.1;
existing LLVM/Python binfmt handlers were preserved. This qualifies the minimal Bun image; the Aphrody fork and Rust
CLI still need musl/ARM64 artifacts. Registry authentication used temporary private Docker configuration that was
removed after publication and smoke checks.

Compose reuses one runtime definition for API and MCP. `APHRODY_RELEASE` pins source builds; `APHRODY_RUNTIME_IMAGE`
selects a published image. To run the qualified GNU image without rebuilding, after preparing the private token:

```sh
bun scripts/tools/secrets/vault.ts runtime
APHRODY_RUNTIME_IMAGE=ghcr.io/aphrody-labs/aphrody@sha256:9584253e39340758b4efcb1d11e86aa48f165a3e045759f75bb4a600559c3031 \
  docker compose --env-file "$HOME/.aphrody/private/container-vault/compose.env" \
  -f config/container/compose.yaml -f config/container/compose.secrets.yaml up --no-build --pull always -d api
```

The mounted token stays outside the image and repository. Compose 2.40.3 validated the selected image/release,
read-only filesystem, init process, dropped capabilities, security option and loopback API port.
