<!-- SPDX-License-Identifier: Apache-2.0 -->

# Ubuntu desktop container

This Dockerfile provides two explicit targets for the Linux desktop app:

- `builder`: Ubuntu 24.04, Rust 1.98.1, Bun 1.4.2, GTK4/CEF native build headers and compiler tools.
- `runtime`: Ubuntu 24.04 with GTK4, CEF's expected X11/DRM/NSS/audio runtime libraries and fonts; no compiler, Bun, or system WebView.

The app manifest selects `tauri-runtime-cef` with `tauri-winit` and GTK4. The runtime target intentionally does not add WebKitGTK. The image does not fetch or bundle CEF, compile the UI, or contain Aphrody source artifacts. The builder is a ready build environment; build completion and the resulting CEF payload still depend on the current source, frontend assets, network access, and the build host.

Build targets from the monorepo root:

```sh
docker build -f config/container/desktop/Dockerfile --target builder -t aphrody/desktop-builder:local .
docker build -f config/container/desktop/Dockerfile --target runtime -t aphrody/desktop-runtime:local .
```

To compile using a checkout mounted into the non-root builder (the host checkout receives `target/`):

```sh
docker run --rm -it -v "$PWD:/workspace" -w /workspace aphrody/desktop-builder:local \
  cargo build --locked --release -p aphrody-app --features custom-protocol
```

This is the crate's Cargo build path, not a verified CEF/UI build result. The builder includes the toolchain and native headers but does not run Cargo at image-build time. Follow the project build factory guidance for heavy builds; this image is useful as a reproducible Ubuntu build environment, not evidence that CEF downloads or the full app compile succeed here.

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
