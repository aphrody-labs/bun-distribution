<!-- SPDX-License-Identifier: Apache-2.0 -->
# uv/Rust integration contract

`crates/compat/toolchains` owns the stable Rust-side route to
the installed uv runtime. The crate invokes the configured executable directly
and does not merge uv's upstream Cargo workspace into Aphrody OS. The upstream
uv source is optional and is not checked out in this repository.

Use `Toolchain::Uv.run_in(project_root, args)` when invoking project commands.
The explicit working directory is part of the contract: uv discovers
`pyproject.toml`, `uv.lock`, and `.venv` from the working directory and its
parents. Calling `Toolchain::Uv.run(args)` remains appropriate only when the
caller intentionally wants discovery from the process working directory.

Set `APHRODY_UV_BIN` when the uv executable is not on `PATH`. The pinned source
and installed runtime can be checked with:

```powershell
pwsh -NoProfile -File scripts/verify-third-party-runtimes.ps1
```

This check verifies the installed Bun and uv versions. It does not require
upstream source checkouts or modify third-party trees.
