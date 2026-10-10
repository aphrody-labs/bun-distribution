<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-toolchains

A unified runtime layer for the three non-Rust toolchains Aphrody launches: Bun (TypeScript and
JavaScript), uv (Python) and Nushell (scripts). Callers go through the same three steps instead
of calling `Command::new("bun")`:

1. **Discovery** (`Toolchain::discover`): the `APHRODY_<TOOL>_BIN` override, then `PATH` (with
   `PATHEXT` on Windows), then the tool's standard per-user install directory. No shell is ever
   involved.
2. **Version pin** (`Toolchain::pinned_version`): read from the nearest repository file
   (`.bun-version`, `package.json#packageManager`, `uv.toml` or
   `pyproject.toml#tool.uv.required-version`, `.nu-version`, `mise.toml#tools`), walking up from
   the project directory.
3. **Launch** (`Runtime::command`): a `Command` rooted at the project directory with the resolved
   binary directory first on `PATH` and `APHRODY_<TOOL>_BIN` exported, so nested launches resolve
   the same executable.

`Toolchain::resolve` combines the three and fails when the installed version does not satisfy
the pin; `resolve_unchecked` skips that check.

## Install

```toml
[dependencies]
aphrody-toolchains = "1.0.0-canary"
```

## Example

```rust,no_run
use aphrody_toolchains::Toolchain;

let bun = Toolchain::Bun.resolve(std::path::Path::new("."))?;
let status = bun.command(["--version"]).status()?;
assert!(status.success());
# Ok::<(), Box<dyn std::error::Error>>(())
```

## License

Apache-2.0.
