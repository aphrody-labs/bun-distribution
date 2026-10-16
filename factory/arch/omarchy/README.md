# Omarchy reference integration

This directory connects pinned Omarchy package and desktop metadata to the Bun
OS factory. It contains declarative data, not another installer or build runner.
The root registers `integration.json` in its shared Arch/pacman graph; that file
names every catalogue and the existing owners that must qualify its inputs.
Nothing here changes a running host or selects an Omarchy desktop by default.

## Source identities

GitHub MCP verified the complete source trees and commit identities. Context7
`/omacom/omarchy` supplied navigation; pinned source files are authoritative.
Inspected public raw files were checked against their Git blob SHA-1, with
SHA-256 recorded separately.

| Source                | Revision                                   | Meaning                                                                                |
| --------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `omacom/omarchy`      | `51bfd1dbaa1b5f790e19623faf2745945d40c796` | Current default `quattro` architecture reference, version `4.0.0.alpha`                |
| `omacom/omarchy-pkgs` | `a97afe08808ad81290792e9f9823c761be3a5f86` | Complete packaging recipes and build policy                                            |
| `omacom/omarchy`      | `c668141e9c42b13c80c9ca4ea108e11708c5e8a5` | Actual source selected by stable `omarchy`/`omarchy-settings` recipes, version `4.0.4` |

The alpha reference and stable recipe source are distinct. A build must use the
recipe's selected source, never silently substitute the reference checkout.
Former `basecamp/omarchy` and `omacom-io/omarchy-pkgs` URLs occur upstream; the
catalogue preserves their expressions and records current canonical repositories.

## Catalogue coverage

- `packages.json`: all eight upstream package lists, 236 distinct listed names,
  and the six platform compositions described by `omarchy-pkg-defaults`.
- `pkgbuilds.json`: all 185 recipes, package versions, architectures, licenses,
  dependency classes, sources, checksum/signature declarations and build commands.
- `package-metadata.json`: all 185 `.omarchy/package.json` files, the available
  package profile and kernel Rust toolchain declaration.
- `catalog.json`: 530 CLI entries, 735 configuration/session/shell files and
  867 package/build-tool references, including historical migrations.
- `files.json`: both complete upstream Git blob inventories, including metadata
  for assets and excluded provider/session defaults. Their contents are not an
  installed overlay.
- `rust.json`: 25 Rust-evidenced recipes, eight kernel recipe records (seven
  source builds and one selector), plus 87 Cargo manifests and 23 lockfiles from
  17 immutable GitHub upstreams. The 6,714 lock package rows include optional,
  development and target-specific dependencies; they are not an active build
  closure. The `supergfxctl` GitLab recipe is indexed, but its upstream Cargo
  graph remains unacquired.
- `upstreams.json`: source/fork candidates and all recipe source/license/checksum
  evidence. The root Infra owner creates forks and shared source registrations.

Literal shell values are extracted without executing PKGBUILD. Original
expressions and line numbers remain authoritative for conditional assignments,
split packages, parameter operators and command substitutions. A package list
pin does not pin signed repository databases or resolve their dependency closure.

## Capability decisions

Adopt the declarative package/source evidence through the common pacman owner.
Adapt selected hardware, portal, audio and desktop mechanisms only after the
root chooses their target and profile. Keep the native Aphrody Bun runtime and
the root serialized build, artifact, cache and release owners.

Omarchy's desktop combines Hyprland, UWSM, SDDM, Quickshell and Qt. Its compositor,
session, portal and keybinding configuration cannot become a COSMIC session by
renaming files. Desktop dependencies remain outside the server composition.
GTK/Qt applications and shell capabilities are independently selectable.

Kernel recipes include Aurora Silicon and NVIDIA source pins, Linux archives
with BORE/EEVDF/MuQSS/platform patches, and an Arch patch-based PTL variant.
`linux-omarchy` is a selector, not another kernel implementation. No recipe
selects or replaces the Bun OS kernel here; central kernel/Rust owners compare
these inputs with the other distribution references and preserve licenses.

Reject upstream orchestration of Bun OS: do not run `apply-system`, provisioning,
factory reset, installer or migration scripts; copy `/etc/skel` into a live home;
import agent/provider account templates; enable services; or configure boot,
encryption, users or signing keys. Preserve Bun OS branding. Binary/proprietary
applications, firmware and marks require their own redistribution decisions.

## Qualification

Only source identities, blob hashes and declarative parsing were verified.
No repository forks, Git submodules, package installation, builds, tests, boot,
desktop session, deployment or release was performed. Required source/archive,
signed repository, target, build, boot and release receipts are enumerated in
`integration.json`; the component remains disabled and unqualified until then.

The upstream MIT notices are retained in `LICENSE` and `LICENSE-PACKAGING`.
Those notices do not replace the licenses of packages described by the recipes.
