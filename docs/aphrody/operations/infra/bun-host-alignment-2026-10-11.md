<!-- SPDX-License-Identifier: Apache-2.0 -->

# Align the installed Bun hosts, 2026-10-11

## Result

The current published Aphrody fork release verified for this rollout is
`aphrody-v1.4.3-aphrody.4` (`41211b56872ca2957e5c037ad1756f56f8f89b7c`). GitHub
release metadata reports a non-draft, non-prerelease release. The current Bun
checkout declares source version 1.4.4, but a matching release was not found;
do not install a local debug executable as a production release.

Windows, DBFR and the VPS now report `1.4.3-aphrody.4+41211b568`. On the VPS,
`/home/ubuntu/.local/bin` preceded the canonical `/home/ubuntu/.bun/bin` in
`PATH` and selected the stale `.3` executable. The `.local/bin/bun` entry is now
an atomic symlink to the already installed and checksum-verified canonical
`.bun/bin/bun`; no release download or engine build was needed.

## VPS install and rollback evidence

Before activation, the stale executable SHA-256 was
`60462d310373ce02e84c60535ed62d0e28edfdef11ed4dd0b16c30623977d2fc`. The
canonical `.4` binary SHA-256 was
`67f0c851c450ac3c51f21232435894b30d06f94645d7e9c6b1a41ed599c1a7cf`.
Both hashes and the exact revisions were checked immediately before switching
the path. The `.3` binary was copied with its mode and ownership retained; the
backup hash was verified before the atomic replacement.

The preserved backup is
`/home/ubuntu/.local/share/aphrody/bun-backups/bun-1.4.3-aphrody.3-20261011T163749Z`.
Its post-install SHA-256 remains
`60462d310373ce02e84c60535ed62d0e28edfdef11ed4dd0b16c30623977d2fc`. If a
future replacement fails its version or hash gate, restore this exact file to
`/home/ubuntu/.local/bin/bun` through a temporary sibling and atomic rename.

After activation, `command -v bun` resolved to `/home/ubuntu/.local/bin/bun`,
`readlink -f` resolved to `/home/ubuntu/.bun/bin/bun`, the full revision and
SHA-256 matched `.4`, and a Bun execution smoke printed
`BUN_VPS_REFRESH_PASS:1.4.3`. Existing services and processes were not restarted;
processes that already mapped the old executable retain it until restarted by a
separate cataloged deployment.

## Other hosts and limits

- The native Windows installation in both `C:\Windows\System32` and the user
  Bun directory reports the same `.4` revision.
- DBFR reports `.4` already. It was left untouched because its root filesystem
  is 97% full (2.9 GiB available).
- Omar's PC could not be reached: the direct SSH alias refused the connection;
  reverse SSH and the Omar WSL reverse tunnel also failed. No command changed
  that host. Re-run `aphrody infra ssh status --host omar` after connectivity is
  restored, then inventory before installing.
- The public 1.4.4 release is not available. The unreleased source checkout and
  its debug build are not substitutes for a checksummed cross-platform release.

Historical VPS activation notes: [2026-10-10 Bun activation](vps-bun-2026-10-10.md).
