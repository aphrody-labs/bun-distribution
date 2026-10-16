# Ubuntu OS factory

Run the Bun owner on the selected Linux, SSH or Docker host. An explicit
factory root owns source jobs, temporary files, isolated APT state, logs,
Docker data, execution state, socket and receipts.

## Source retrieval

Source jobs authenticate each Ubuntu InRelease with the archive keyring,
then compare every DSC and archive size/SHA256 with the authenticated
Sources record before extraction. dpkg-source retains its default signature
checks and requires strong checksums. Uploader signature messages are
recorded separately from archive authentication.

```sh
bun factory/ubuntu.ts status --root /ABSOLUTE/FACTORY
bun factory/ubuntu.ts sources apt dpkg livecd-rootfs --root /ABSOLUTE/FACTORY
```

Each mutation creates a fresh job directory and records live child PIDs,
logs, finite deadlines and a receipt. The factory has an exclusive lock
and requires 50 GiB free. Existing locks are preserved. All APT configuration,
lists, cache and temporary files stay in the job; source retrieval installs
no packages. Ubuntu source package versions and the Salsa APT fork revisions
have independent provenance.

## Isolated toolchain

After the cleanup owner releases its build slot, request the dedicated
Docker engine. Its data root, execution root, socket, PID file, logs and
temporary files are on the factory filesystem. Bridge, forwarding and
iptables management are disabled; containerd has factory namespaces.

```sh
bun factory/ubuntu.ts engine --root /ABSOLUTE/FACTORY
bun factory/ubuntu.ts status --root /ABSOLUTE/FACTORY
bun factory/ubuntu.ts toolchain --root /ABSOLUTE/FACTORY
```

The toolchain owner verifies the Docker endpoint and filesystem, acquires
the configured shared heavy lock, resolves an immutable official Ubuntu
base digest, and installs sbuild, live-build, livecd-rootfs, germinate,
debian-cd and image utilities through Ubuntu APT. The receipt records the
image identity, package versions, OS and libc. Installed tools do not prove
a clean sbuild chroot, built rootfs, ISO or complete Bun OS image.

## Package and rootfs builds

Native package builds use the Ubuntu-recommended unshare backend with mmdebstrap
and uidmap. Each build owns its sbuild configuration, HOME, cache, chroot
tarball, temporary paths and hashed binary artifacts. The configured Ubuntu
image user supplies its namespace ID maps; only verified source files and
the fresh job are mounted into each package build. Package builds use
`DEB_BUILD_OPTIONS=parallel=2 nocheck`. Receipts record native namespace
mount diagnostics separately from package and chroot archive hashes. The optional --chroot
selects a pre-provisioned schroot for cross-building. Rootfs builds
require prepared live-build configuration, livecd-rootfs customizations,
seeds, package selection and kernel artifacts. Inputs reside inside the
mounted factory root. Container commands bound CPU, memory, PIDs and time.

```sh
bun factory/ubuntu.ts package /ABSOLUTE/FACTORY/sources/apt.dsc --root /ABSOLUTE/FACTORY
bun factory/ubuntu.ts rootfs --root /ABSOLUTE/FACTORY --config /ABSOLUTE/FACTORY/live-build
```

Inspect and hash produced artifacts before product qualification. WSLg's
Azure Linux system distro remains a separate target.

Primary guidance: [Ubuntu source retrieval](https://documentation.ubuntu.com/project/contributors/setup/get-the-source-of-a-package/),
[Ubuntu local package builds](https://ubuntu.com/project/docs/contributors/building/build-packages-locally),
[Ubuntu image process](https://ubuntu.com/project/docs/how-ubuntu-is-made/processes/image-builds/),
and [separate Docker daemons](https://docs.docker.com/reference/cli/dockerd/#run-multiple-daemons).
