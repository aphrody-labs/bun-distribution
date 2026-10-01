---
name: cross-platform-cli-toolbelt
description: "Modern cross-platform CLI tools (rg, fd, sd, eza, bat, dust, procs, btm, hyperfine, just, watchexec, jaq) vs grep/find/sed/ls/du/ps: detection, install, bash and PowerShell equivalents. Use when picking shell commands or writing portable scripts."
version: "2.0.0"
source: "crates.io versions verified 2026-10-01; sts10/rust-command-line-utilities"
---

# Cross-platform CLI toolbelt

Single-binary tools that behave the same on Linux, macOS and Windows, respect `.gitignore`
by default, and are usually much faster than the classic tools on large trees.

## Rule 1: detect before using

Never assume a tool is installed, and never ship a script that silently requires one.

```bash
for t in rg fd sd eza bat dust btm procs hyperfine just zoxide delta tokei watchexec xh jaq; do
  command -v "$t" >/dev/null 2>&1 && echo "ok  $t" || echo "--  $t"
done
```

```powershell
'rg','fd','sd','eza','bat','dust','btm','procs','hyperfine','just','zoxide','delta','tokei','watchexec','xh','jaq' |
  ForEach-Object { '{0,-3} {1}' -f ($(if (Get-Command $_ -ErrorAction SilentlyContinue) {'ok'} else {'--'})), $_ }
```

- **Interactive work and agent searches**: prefer `rg` / `fd` when present.
- **Scripts that others run** (CI, installers, Dockerfiles): use POSIX tools, or check for
  the modern tool and fall back, or declare it as a dependency. Note `fd` is `fdfind` and
  `bat` is `batcat` on Debian/Ubuntu packages.
- Do not alias `grep`, `find`, `sed` or `ps` to the replacements in shell rc files: flags
  differ and scripts that source the rc break. Alias only names that are new (`ll`, `z`).

## Install

```bash
cargo binstall --no-confirm ripgrep fd-find sd eza bat du-dust bottom procs hyperfine just \
  zoxide git-delta tokei watchexec-cli xh jaq        # prebuilt binaries; `cargo install cargo-binstall` first
brew install ripgrep fd sd eza bat dust bottom procs hyperfine just zoxide git-delta tokei watchexec xh jaq
winget install BurntSushi.ripgrep.MSVC sharkdp.fd sharkdp.bat ajeetdsouza.zoxide   # or: scoop install ...
sudo apt install ripgrep fd-find bat eza hyperfine just   # Debian/Ubuntu: binaries fdfind, batcat
```

Check winget/scoop IDs with `winget search <name>` before scripting them.

## Reference table (crate versions as of 2026-10-01)

| Tool | Replaces | Crate | Notable |
|---|---|---|---|
| `rg` ripgrep 15 | `grep -r`, `Select-String` | `ripgrep` | gitignore-aware, `-t rust`, `--json`, multiline |
| `fd` 10 | `find`, `Get-ChildItem -Recurse` | `fd-find` | `-e ext`, `-t d`, `--changed-within`, parallel `-x` |
| `sd` 1.0 | `sed -i` substitutions | `sd` | normal regex syntax, in place by default |
| `eza` 0.23 | `ls` | `eza` | `--git`, `-T` tree, icons |
| `bat` 0.26 | `cat`, `less` | `bat` | highlighting, `-l lang`, `-p` plain |
| `dust` 1.2 | `du -sh` | `du-dust` | sorted tree, `-d N` |
| `procs` 0.14 | `ps` | `procs` | tree, ports, `--watch` |
| `btm` bottom 0.14 | `top`, `htop` | `bottom` | works on Windows, GPU stats (`--disable_gpu` to hide) |
| `hyperfine` 1.20 | `time`, `Measure-Command` | `hyperfine` | warmup, stats, `--export-json` |
| `just` 1.58 | `make` as a task runner | `just` | recipes, `.env` loading, cross-platform shells |
| `zoxide` 0.10 | `cd` | `zoxide` | frecency `z`, init for bash/zsh/fish/pwsh/nu |
| `delta` 0.19 | git pager | `git-delta` | side-by-side, syntax highlight |
| `tokei` 15 | `cloc`, `wc -l` | `tokei` | per-language counts, JSON |
| `watchexec` 2.7 | `inotifywait`, `entr` | `watchexec-cli` | cross-platform, debounce, `-e rs` |
| `xh` 0.26 | `curl`, `httpie` | `xh` | `xh post url key=value` |
| `jaq` 3 | `jq` | `jaq` | jq-compatible, faster start |
| `qsv` 16 / `xan` 0.61 | `csvkit`, `xsv` | `qsv`, `xan` | streaming CSV; `xsv` itself is archived |
| `broot` 1.60 | `tree` + `cd` | `broot` | fuzzy TUI navigator |
| `gitui` 0.28 | `tig`, lazygit | `gitui` | TUI git |
| `mprocs` 0.9 | ad-hoc tmux panes | `mprocs` | run several commands in panes |
| `gping` 1.21 | `ping` | `gping` | latency graph, multiple hosts |
| `xcp` 0.24 | `cp` | `xcp` | progress, parallel copy |
| `trash` (trashy 2) | `rm` | `trashy` | moves to the OS trash (no release since 2022) |
| `choose` 1.3 | `cut`, simple `awk` | `choose` | `choose 0:2` field ranges |

## Equivalents

```text
grep -rn TODO .                 rg -n TODO                    Select-String -Path ** -Pattern TODO
grep -r --include='*.rs' x .    rg -t rust x                  Get-ChildItem -Recurse -Filter *.rs | Select-String x
find . -name '*.rs'             fd -e rs                      Get-ChildItem -Recurse -Filter *.rs
find . -type d -name build      fd -t d build                 Get-ChildItem -Recurse -Directory -Filter build
find . -mmin -60                fd --changed-within 1h        Get-ChildItem -Recurse | ? LastWriteTime -gt (Get-Date).AddHours(-1)
sed -i 's/foo/bar/g' f          sd foo bar f                  (Get-Content f) -replace 'foo','bar' | Set-Content f
du -sh */ | sort -h             dust -d 1                     -
ps aux | grep cargo             procs cargo                   Get-Process *cargo*
time ./bin                      hyperfine ./bin               Measure-Command { ./bin }
inotifywait -m src              watchexec -w src 'cargo check' -
curl -X POST -d '{"x":1}' URL   xh post URL x:=1              Invoke-RestMethod -Method Post -Body '{"x":1}' URL
jq '.items[]' f.json            jaq '.items[]' f.json         Get-Content f.json | ConvertFrom-Json | % items
```

Differences that bite:

- `rg` and `fd` skip hidden and gitignored files: add `--hidden` / `-u` (`-uu` for
  everything) when searching build outputs, `.env` files or vendored code.
- `sd` uses Rust regex: capture groups are `$1` / `${name}`, not `\1`; use `-F` for literals.
- `rg` regex has no look-around by default; use `rg -P` (PCRE2) when needed.

## Shell setup (optional, interactive only)

```bash
eval "$(zoxide init bash)"         # zsh/fish analogous; nu: zoxide init nushell
git config --global core.pager delta
git config --global interactive.diffFilter 'delta --color-only'
alias ll='eza -la --git'
```

```powershell
Invoke-Expression (& { (zoxide init powershell | Out-String) })
function ll { eza -la --git @args }
```

## Platform notes

- Recent Ubuntu releases (25.10, 26.04 LTS) ship the Rust `uutils` coreutils
  (`rust-coreutils`) by default. Scripts should rely on POSIX behaviour rather than
  GNU-only flags, and test on the target distro.
- Windows system administration (registry, services, scheduled tasks, event log) is not a
  job for these tools; use PowerShell cmdlets (see `powershell-expert`).
- Structured pipelines are often clearer in Nushell (`nushell-pro`) than chaining text tools.
