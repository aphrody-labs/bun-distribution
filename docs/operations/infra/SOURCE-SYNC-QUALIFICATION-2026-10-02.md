<!-- SPDX-License-Identifier: Apache-2.0 -->
# Source sync and WSL qualification — 2026-10-02

The active source sync scope is `<repo>`,
`../aphrody-py`, and `../iecode`. The script's default
selection is this same set, and `--repo aphrody-ui` exits with an error before
writing a report or contacting a remote. The user service explicitly lists the
same three repositories.

The plan-only JSON run selected three rows: `aphrody` dirty and even with
`workspace/main`, `aphrody-py` dirty and seven commits ahead of `origin/main`,
and `iecode` clean and even with `origin/main`. The first service apply cycle
fetched all three; it preserved both dirty worktrees and found `iecode`
current. Its log contained no fetch, merge, or service error. No push was
requested. A push, if explicitly requested, now checks the current owner
identity and that its push URL resolves to the same owned repository as its
fetch URL.

The `aphrody-source-sync.service` user unit was enabled and active after the
first cycle. Its report is at
`~/.local/state/aphrody/source-sync/source-sync.json` with mode `0600`,
outside the repository's `target` directory. The service runs with a 60 second
interval and preserves dirty or divergent histories. This observation proves
one cycle and the unit state at that time, not future network availability.

WSL2 host checks: the root volume had 609 GiB available (37% used) and 4%
inode use. The `bun`, `cargo`, `rustc`, and `nu` executables resolved under the
home toolchain directories; Nushell reported 0.116.0. Process inspection by
executable name found the Aphrody kernel, rust-analyzer, and the source sync
`bun` process. The state report path and unit symlink resolved under the home
directory and current monorepo respectively. These are host observations, not
a complete package or deployment qualification.

Commands used: `bun scripts/tools/workspace/source-sync.ts --json`, an invalid `--repo` probe,
`systemctl --user status/is-active/is-enabled aphrody-source-sync.service`,
`journalctl --user -u aphrody-source-sync.service`, `df -h`, `df -i`, `uname`,
`command -v`, `nu --version`, and `ps` with executable names only.
