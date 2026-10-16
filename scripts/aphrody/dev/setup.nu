#!/usr/bin/env nu

# Idempotent native bootstrap of this Linux/WSL host. Thin wrapper over
# `aphrody-infra dev-env --local`, the single implementation; pins come from
# tools/config/system-packages.json and rust-toolchain.toml. Check-only by default.
def main [
  --target: string = "wsl"  # package set: vps, dbfr or wsl
  --apply                   # install/upgrade instead of reporting
  --developer-cli           # inspect/install optional interactive CLI suite
] {
  if $nu.os-info.name != "linux" { error make {msg: "setup.nu exige un hôte Linux/WSL; depuis Windows: aphrody-infra dev-env --target <id>"} }
  let root = ($env.FILE_PWD | path dirname)
  let args = ["run" "-q" "-p" "aphrody" "--manifest-path" ($root | path join "Cargo.toml") "--bin" "aphrody" "--" "infra" "--root" $root "dev-env" "--local" $target]
  if (which cargo | is-empty) {
    # First boot: no Rust yet. Install rustup only; dev-env then pins the channel.
    if not $apply { print "cargo absent: relancer avec --apply pour installer rustup"; return }
    curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain none
    $env.PATH = ($env.PATH | prepend ($env.HOME | path join ".cargo" "bin"))
  }
  let selected = if $developer_cli { $args | append "--developer-cli" } else { $args }
  if $apply { ^cargo ...$selected "--apply" } else { ^cargo ...$selected }
}
