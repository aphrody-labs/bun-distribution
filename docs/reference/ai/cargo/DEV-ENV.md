<!-- SPDX-License-Identifier: Apache-2.0 -->
# Developer environment

This is the canonical environment and `PATH` reference for the Rust, Bun and
Python surfaces. Version authority stays in configuration files rather than in
shell profiles.

## Version authority

| Surface | Authority | Current contract |
| --- | --- | --- |
| Rust | `rust-toolchain.toml` | Pinned stable release and components (rustfmt, clippy), managed by rustup |
| Bun | `mise.toml`, `package.json` | The two Bun versions must match |
| Python | `mise.toml`, `py/.python-version` | Interpreter managed by mise or uv; dependencies locked by `py/uv.lock` |

Run `mise install` at the repository root to provision Bun, Python and uv.
Rust remains owned by rustup because pinning it in both mise and
`rust-toolchain.toml` would create two authorities.

## PATH

Use default per-user installation roots unless the machine has a documented,
persistent alternative:

| Tool | Windows executable directory | Linux/macOS executable directory |
| --- | --- | --- |
| Rust and Cargo | `%USERPROFILE%\.cargo\bin` | `$HOME/.cargo/bin` |
| Bun | `%USERPROFILE%\.bun\bin` | `$HOME/.bun/bin` |
| Python and uv tools | `%USERPROFILE%\.local\bin` | `$HOME/.local/bin` |

PowerShell session setup:

```powershell
$paths = @(
  "$env:USERPROFILE\.cargo\bin",
  "$env:USERPROFILE\.bun\bin",
  "$env:USERPROFILE\.local\bin"
)
$env:PATH = (($paths + ($env:PATH -split ';')) | Select-Object -Unique) -join ';'
```

POSIX shell setup:

```bash
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"
```

Persist the entries once in the user profile. Do not commit absolute home
paths, drive letters or generated virtual-environment paths.

## Environment variables

`CARGO_HOME`, `RUSTUP_HOME` and `BUN_INSTALL` are optional. Leaving them unset
selects the standard user locations above. If one is set, its directory must
exist and its `bin` directory must agree with `PATH`.

Python commands do not require a repository-wide `PYTHONPATH`. The Python
workspace configures pytest in `py/pyproject.toml`,
including the package path needed by the `aphrody` member.

Credentials, cookies and tokens belong in the operating-system credential
store or ignored runtime configuration. They must not be placed in shell
profiles, tracked `.env` files or command examples.

## Install and verify

```powershell
mise install
rustup show active-toolchain
cargo --version
bun --version
uv --version

bun install --frozen-lockfile
Push-Location py
uv sync --group dev --locked
uv run pytest
Pop-Location
```

Linux and macOS use the same commands, replacing `Push-Location` and
`Pop-Location` with `cd py` and `cd ..`.

For Rust validation, use the repository gates documented in
[`AGENTS.md`](../AGENTS.md). A temporary `RUSTC_WRAPPER=` override may be
used when diagnosing sccache, but it should not be persisted globally.

## Diagnosis

```powershell
Get-Command rustup, cargo, bun, python, uv | Select-Object Name, Source
rustup show active-toolchain
mise current
```

```bash
command -v rustup cargo bun python uv
rustup show active-toolchain
mise current
```

If resolution points to an obsolete disk or deleted directory, remove that
stale user-level variable or profile entry and reopen the shell. Do not add a
second workaround path ahead of it.

## Related documents

- [`PROFILES.md`](./PROFILES.md)
- [`../INSTALL.md`](../../../guides/ai/INSTALL.md)
