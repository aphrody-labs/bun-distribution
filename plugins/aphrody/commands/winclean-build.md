---
description: Validate the Rust WinClean compatibility surface (Aphrody workspace on Windows only).
argument-hint: "[check]"
allowed-tools: PowerShell, Read
---

Applies when the Aphrody workspace is present (`crates/os/winclean` exists);
otherwise report that there is nothing to validate and stop.

Validate the WinClean compatibility surface owned by `aphrody-kernel` and
`aphrody-winclean`. There is no standalone WinClean build target.

`check` runs the focused Rust gates and the integration probe:

```powershell
cargo test -p aphrody-winclean --locked --offline
pwsh -NoProfile -File scripts/audit/os/scripts/verify-winclean-integration.ps1
```

New features belong to the Rust owners recorded in `docs/reference/os/WINCLEAN-RUST-CONVERGENCE.md`.

If the probe script fails on a missing input path, report that it needs its
repository-root resolution updated for its new location rather than
working around it.

Report the exact failing command and preserve unrelated worktree changes.
