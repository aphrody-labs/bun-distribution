<!-- SPDX-License-Identifier: Apache-2.0 -->

# Ubuntu desktop container

This Dockerfile provides two explicit targets for the Linux desktop app:

- `builder`: Ubuntu 24.04, Rust 1.98.1, Bun 1.4.2, GTK4/CEF native build headers, compiler tools and sccache.
- `runtime`: Ubuntu 24.04 with GTK4, CEF's expected X11/DRM/NSS/audio runtime libraries and fonts; no compiler, Bun, or system WebView.

The app manifest selects `tauri-runtime-cef` with `tauri-winit` and GTK4. The runtime target intentionally does not add WebKitGTK. The image does not fetch or bundle CEF, compile the UI, or contain Aphrody source artifacts. The builder is a ready build environment; build completion and the resulting CEF payload still depend on the current source, frontend assets, network access, and the build host.

Build targets from the monorepo root:

```sh
docker build -f tools/config/container/desktop/Dockerfile --target builder -t aphrody/desktop-builder:local .
docker build -f tools/config/container/desktop/Dockerfile --target runtime -t aphrody/desktop-runtime:local .
```

To compile using a checkout mounted into the non-root builder (the host checkout receives `target/`):

```sh
mkdir -p "${SCCACHE_DIR:-$HOME/.cache/sccache}"
docker run --rm -it -v "$PWD:/workspace" \
  -v "${SCCACHE_DIR:-$HOME/.cache/sccache}:/home/builder/.cache/sccache" \
  -w /workspace aphrody/desktop-builder:local \
  scripts/build/rust/cargo-serial.sh build --locked --release -p aphrody-app --features custom-protocol
```

This is the crate's Cargo build path, not a verified CEF/UI build result. The builder includes the toolchain and native headers but does not run Cargo at image-build time. Follow the project build factory guidance for heavy builds; this image is useful as a reproducible Ubuntu build environment, not evidence that CEF downloads or the full app compile succeed here.

The builder sets `APHRODY_CLOUD=1`: the container is the build host. Cargo runs through the serialized repository wrapper, with `RUSTC_WRAPPER=sccache`; use the factory's global cache and heavy lock when executing on the shared VPS.

Qualify the dependency boundary on the declared factory before using the images:

```sh
scripts/build/container/desktop-qualify.sh
```

This builds both targets, checks their non-root identity, verifies the toolchains against the repository manifests, compiles C and Rust probes through the builder, and loads GTK4/CEF support libraries in the runtime with a read-only root filesystem and dropped capabilities. It also checks that the runtime lacks compilers, Bun and WebKitGTK. The probes do not download CEF or launch a browser; app compilation, the CEF bundle, actual rendering, GPU access and native Windows execution require their own gates.

Run an already-built app against the host Wayland socket:

```sh
docker run --rm -it \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e XDG_CONFIG_HOME=/tmp/.config -e XDG_DATA_HOME=/tmp/.local/share \
  -e XDG_RUNTIME_DIR=/tmp/host-runtime -e WAYLAND_DISPLAY="$WAYLAND_DISPLAY" \
  -v "$XDG_RUNTIME_DIR:/tmp/host-runtime:ro" \
  -v "$PWD:/workspace:ro" -w /workspace \
  aphrody/desktop-runtime:local ./target/release/aphrody-app
```

Use the same UID/GID as the host user so the mounted Wayland socket is accessible. The temporary home keeps the container process non-root; mount an owned profile directory and point `XDG_DATA_HOME` and `XDG_CONFIG_HOME` there if app state must persist. X11 hosts can instead pass `DISPLAY`, mount `/tmp/.X11-unix`, and grant the container user access with the host's normal Xauthority mechanism. GPU acceleration requires passing the host's `/dev/dri` device and appropriate group permissions; otherwise the host compositor/driver may fall back to software rendering. Docker does not create a desktop session or grant display access automatically.

## Factory qualification — 2026-10-07

Docker 29.1.3 on the VPS built both targets from an isolated context under `/home/ubuntu/build/locks/heavy.lock`. The final qualifier used the shared `/home/ubuntu/build/cache/sccache` cache and exited 0. Source checksums were:

- Dockerfile SHA-256: `64a10cec2a3152a6b5aa9f8cb793fc0a05725fe5be9492d345a7e76db78507c6`.
- `scripts/build/container/desktop-qualify.sh` SHA-256: `841dab72d75fc4dc996e73bf6360cb3845a83d833f343001cada0dc76a6b6c66`.

| Target  | Local image ID                                                            | Docker-reported bytes |
| ------- | ------------------------------------------------------------------------- | --------------------- |
| builder | `sha256:80abefbf5b63700d7a96589227b37f41feeb6de96523f5fbc8ccddc7043d6fef` | 858,023,516           |
| runtime | `sha256:957c0aa1732b822968bfa9b1488338dc8fd36b63951e088f63313b53f8e5bd8c` | 144,236,649           |

The run verified Rust 1.98.1, Clippy, rustfmt, Bun 1.4.2, sccache 0.7.7, GTK4 4.14.5 and the native header packages. It compiled and linked a GTK4 C probe, compiled a Rust probe through sccache, and loaded 19 native support libraries in the runtime. Both targets ran as uid 1000. The runtime probe passed with a read-only root filesystem, dropped capabilities and no-new-privileges, without compilers, Bun or WebKitGTK.

These local images were not published or installed as a desktop product. This qualifies the build tools and native dependency boundary; CEF payload acquisition, full application compilation, actual rendering, GPU execution and native Windows remain open. Image sizes are storage observations, not a performance or size-reduction comparison.
