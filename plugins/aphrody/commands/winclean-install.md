---
description: Install a package, module, plugin or CLI via an approved channel without confirmation.
argument-hint: <package-name> [--scope user|machine]
allowed-tools: PowerShell, Bash, Read, Write, Edit, WebFetch
---

Install **$ARGUMENTS** using the appropriate **approved** channel. Auto-detect from the target name or context, install silently, report result.

## Approved channels (in detection order)

| Priority | Channel                                  | When                                                              | Silent command                                                                                                     |
| :------- | :--------------------------------------- | :---------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| 1        | **Claude plugin**                        | request mentions `plugin:` or a known Claude plugin               | `claude plugin install <name>[@<marketplace>]`                                                                     |
| 2        | **PowerShell module** (PSResourceGet v3) | module targets `.Management`, `Az.*`, `Microsoft.*`, or PSGallery | `Install-PSResource -Name <Name> -Scope CurrentUser -TrustRepository -Quiet`                                       |
| 3        | **bun**                                  | JavaScript / TypeScript packages, Node deps                       | `bun add -g <pkg>` (global) or `bun add <pkg>` (project)                                                           |
| 4        | **uv** (Python libs and envs)            | `uv` is the canonical Python tool on this machine                 | `uv pip install <pkg>` (in active env) or `uv tool install <pkg>` (global CLI)                                     |
| 5        | **pipx**                                 | Python CLI tools that want isolation                              | `pipx install <pkg>`                                                                                               |
| 6        | **pip**                                  | Python libraries when uv is not applicable                        | `pip install --user <pkg>`                                                                                         |
| 7        | **cargo**                                | Rust crates / binaries                                            | `cargo install <crate>`                                                                                            |
| 8        | **dotnet tool / NuGet**                  | .NET CLI tools and libraries                                      | `dotnet tool install --global <pkg>` or `dotnet add package <pkg>` for a project; `nuget install <pkg>` for legacy |
| 9        | **code --install-extension**             | VS Code extensions                                                | `code --install-extension <publisher.name> --force`                                                                |
| 10       | **winget**                               | Windows apps and system CLIs (fallback)                           | `winget install --id=<Id> --silent --accept-source-agreements --accept-package-agreements --disable-interactivity` |
| 11       | **choco / scoop**                        | only if the target is not on winget                               | `choco install <pkg> -y` / `scoop install <pkg>`                                                                   |

If `winget` is not on PATH:

```powershell
$winget = (Get-AppxPackage Microsoft.DesktopAppInstaller).InstallLocation + '\winget.exe'
```

## Forbidden channels (never use)

- **`bun`**, **`bun`**, **`pnpm`**, **`yarn`**, **`bunx`** — all denied at the permissions layer. Use **`bun`** for everything JavaScript/TypeScript:
  - Runtime: `bun <file>` (not `bun <file>`)
  - Scripts: `bun run <script>` (not `bun run <script>`)
  - CLI execution: `bun x <cli>` (not `bunx`)
  - Install deps: `bun install` / `bun add` (not `bun add`)
  - Prefer Windows-native installers and the approved channels listed above.
- **`apt`**, **`apt-get`**, **`dnf`**, **`brew`** — Linux/Mac package managers. On Windows use winget.

## Rules

- **Silent by default** — always pass `--silent`, `--accept-source-agreements`, `--accept-package-agreements`, `--disable-interactivity` (winget), `-Quiet -TrustRepository` (PSResourceGet), `-y` (choco), `--force` (code extensions).
- **Elevate if the installer requires system-scope** — `Start-Process -Verb RunAs -Wait` via the `/elevate` pattern. UAC is silent on this machine.
- **Prefer user scope** — `--scope user` (winget), `-Scope CurrentUser` (PSResourceGet), `--user` (pip) — before going machine-wide.
- **Report** the version installed and the install location. Note any post-install PATH update the user needs to pick up (hint: open a new shell).
- **Never ask** which channel. Pick one and execute.
