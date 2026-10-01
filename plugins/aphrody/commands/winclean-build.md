---
description: Validate the Rust WinClean compatibility surface.
argument-hint: "[check]"
allowed-tools: PowerShell, Read
---

Validate the WinClean compatibility surface owned by `aphrody-kernel` and
`aphrody-winclean`. There is no standalone WinClean build target.

`check` runs the focused Rust gates and the integration probe:

```powershell
cargo test -p aphrody-winclean --locked --offline
pwsh -NoProfile -File scripts/verify-winclean-integration.ps1
```

New features belong to the Rust owners recorded in `docs/WINCLEAN-RUST-CONVERGENCE.md`.

Report the exact failing command and preserve unrelated worktree changes.
