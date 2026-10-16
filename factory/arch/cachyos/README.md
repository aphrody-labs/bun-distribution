# CachyOS inputs for the root factory

This directory contributes pinned source, recipe and native build inputs to the
existing Bun OS factory. It implements no installer, runner, package manager,
host registry or competing build queue. Pacman/libalpm belongs to the common
root capability. Fork provisioning and root source locks belong to the root
owner.

`integration.json` records source revisions, license boundaries, kernel inputs
and root builder hooks. `catalog.json` enumerates every PKGBUILD from two
complete upstream Git trees: 183 package recipes and ten kernel variants.
`rust-crates.json` inventories actual optional Rust tools and their declared
dependencies. No Rust crate or dependency is added to the root workspace.

The pinned repositories preserve the entire package catalog, including SDKs,
compilers, libraries, patches, split-package metadata and notices. Recipe
directory names are not resolved binary package names. Six package recipes
lack tracked `.SRCINFO`; the root `.SRCINFO` is orphaned. These entries remain
visible and unresolved. The existing ALPM parser can read tracked metadata
without evaluating PKGBUILD shell code.

The 183 custom recipes do not represent all binary packages in CachyOS's
optimized core/extra repositories. The common Pacman owner must separately
authenticate and pin complete repository databases, signatures, package hashes
and the selected CPU tier before an install or release.

The [kernel recipe](https://github.com/CachyOS/linux-cachyos/blob/4a8d2ec8509d0da7d5fd5293f42251ea99d5ea3c/linux-cachyos/PKGBUILD)
selects the signed `cachyos-7.2.11-1` release, dereferenced to
`b0ce79ee33ddd93d513f77341167956e1355758e`. The upstream default branch is
not this release. GitHub reports the annotated tag signature as verified;
archive signature/checksum verification has not run. The existing Bun
acceleration kernel and CachyOS Linux have different GitHub fork networks.
Their pinned sources remain distinct inputs to one root kernel composition;
no existing kernel pin or Bun acceleration source was changed here.

Kernel Rust belongs to Kbuild, not a new Cargo workspace. CPU ISA, scheduler,
configuration, LTO, source epoch and any AutoFDO/Propeller workload/profile
hashes must be explicit inputs. Upstream defaults that inspect the running
kernel, loaded modules or native CPU do not establish reproducible distribution
artifacts. The server variant remains a separate recipe with its own flags.

Reuse the existing [devtools clean-chroot owner](https://github.com/CachyOS/devtools/blob/8f0d146f8aaeba77a52fbe5db48f1e21b28d8551/src/makechrootpkg.in)
through the root host admission and process owners. It verifies sources before
the internal chroot build; its internal `--skipinteg` is not permission to skip
that earlier verification. The optional `pkg-manage-util` is a Rust frontend
for those builds. `repo-manage-util` has a nonoptional local PostgreSQL crate
and must not be treated as a minimal replacement for the common repository
publisher.

The official [docker-makepkg reference](https://github.com/CachyOS/docker-makepkg/blob/9b0259d98e535487de07b44d7e0e7d73b7a6be29/docker-makepkg/run.sh)
is not admitted as an execution recipe: it uses mutable repository state,
skips integrity directly and masks makepkg failure. Its dashboard is an API
client; no public Cachybuilder backend source was located. Neither is a reason
to implement a second builder.

License obligations remain source-specific. The kernel recipe repository
contains a GPLv3 license text; its kernel packages declare GPL-2.0-only, while
the kernel source includes the Linux syscall exception and per-file licenses.
The broad package catalog has per-package licenses rather than one root license.
Preserve every original notice and source offer through acquisition and release.

GitHub MCP pinned primary sources and Context7's official CachyOS wiki index
were inspected on 2026-10-16. No source checkout, archive, package installation,
build, test, kernel boot, publication or host mutation was performed.
