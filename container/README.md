# Bun OS images

Both image profiles use the Linux GNU/glibc runtime and Ubuntu26.04 base.
perf includes the COSMIC session, compositor, panel, settings, launcher,
services, file manager and terminal. full adds the application catalog.
Both retain complete source payloads and licenses.

Build from a factory-staged context. BUN_OS_STAGE identifies the context;
SOURCE_REVISION and DISTRIBUTION_VERSION come from its receipt.

```sh
docker build --target perf --file "$BUN_OS_STAGE/container/Dockerfile" --build-arg SOURCE_REVISION --build-arg DISTRIBUTION_VERSION --tag bun-os:perf "$BUN_OS_STAGE"
docker build --target full --file "$BUN_OS_STAGE/container/Dockerfile" --build-arg SOURCE_REVISION --build-arg DISTRIBUTION_VERSION --tag bun-os:full "$BUN_OS_STAGE"
docker run --rm bun-os:full health
docker run --rm bun-os:perf --version
docker run --rm --entrypoint /usr/local/bin/bun bun-os:perf --revision
```

The context contains runtime/bun, sources/, sources.receipt.json,
distribution.json, container/ and wasm/. The optional bun-cosmic helper belongs
under runtime/. Private stores and live checkout contents must not enter staging.

The runtime receipt identifies repository, source revision, GNU ABI, target,
version, SHA256, bytes and a passed native-runtime gate. The image validates
the actual executable and records the deployed GNU libc version and shared
library resolution.

cosmic-packages.json pins package versions, URLs and checksums. APT uses the
signed official Pop repository and a source-pinned public key. A package lock
is architecture-specific; provide an ARM64 lock before building that target.

## Desktop session

The session runs cosmic-session cosmic-comp on a private D-Bus bus. A Linux
Wayland host supplies an explicitly authorized display socket:

```sh
docker run --rm --init \
  --user "$BUN_OS_UID:$BUN_OS_GID" \
  --security-opt no-new-privileges --cap-drop ALL \
  --tmpfs "/run/bun-os:rw,nosuid,noexec,size=16m,mode=0700,uid=$BUN_OS_UID,gid=$BUN_OS_GID" \
  --tmpfs "/home/bun:rw,nosuid,size=128m,mode=0700,uid=$BUN_OS_UID,gid=$BUN_OS_GID" \
  --mount "type=bind,source=$BUN_OS_WAYLAND_SOCKET,target=/run/host-wayland,readonly" \
  --env XDG_RUNTIME_DIR=/run/bun-os --env WAYLAND_DISPLAY=/run/host-wayland \
  --env COSMIC_BACKEND=winit bun-os:full cosmic
```

Hardware rendering requires authorized render nodes and groups on that host.
KMS requires explicit device and seat configuration. health checks component
availability; graphical qualification requires an actual desktop session.

The entrypoint forwards SIGINT, SIGTERM and exit status. exec runs an executable
with arguments. --entrypoint /usr/local/bin/bun selects the direct native runtime.

References: [COSMIC](https://github.com/pop-os/cosmic-epoch),
[Pop package index](https://apt.pop-os.org/release/dists/resolute/main/binary-amd64/Packages),
[repository key](https://github.com/pop-os/keyring/tree/356a75e405d00a23889998d2e8f2508a9e67b535),
[COSMIC backend](https://github.com/pop-os/cosmic-comp/blob/41497b42d9744d9963c4c6d17e8add49489b45ee/src/backend/mod.rs).
