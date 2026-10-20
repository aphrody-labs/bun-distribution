# Package converter

Read Debian, Ubuntu and COSMIC package metadata and `.deb` archives, ALPM/MSYS2
`.PKGINFO`, `.SRCINFO` and package archives, Cygwin `setup.ini`, and package source
archives. Dependency expressions, versions, source checksums and payload ABI stay
associated with their original ecosystem.

```powershell
bun packages/package-converter/src/cli.ts inspect app.deb --format deb --ecosystem ubuntu --decoder 7z
bun packages/package-converter/src/cli.ts convert Sources --format deb822 --ecosystem debian --package app --out out/app-port --source-base https://deb.debian.org/debian/
bun packages/package-converter/src/cli.ts convert app.src.tar.gz --format source-archive --ecosystem msys2 --package app --out out/app-source --extract-sources
```

For archives without embedded package metadata, supply a companion, for example
`--metadata setup.ini --metadata-format cygwin` or
`--metadata Sources --metadata-format deb822`. Matching archive names are checked
against the companion's declared size and checksum; both input hashes are retained.

Conversion preserves an existing native PE archive as a private Bun package:
DLLs, headers, static/import libraries, data and license files retain their payload
paths and hashes. `native-assets.json` records PE architecture, imports, bundled DLL
paths, external runtime owners and the original dependencies. DLL packages expose
library and asset paths for application loading. Native assets are exported through
`./native-assets` and `./payload/*`; runtime loading remains with the application.

```powershell
bun packages/package-converter/src/cli.ts convert mingw-w64-ucrt-x86_64-zlib.pkg.tar.zst --format alpm-archive --ecosystem msys2 --package mingw-w64-ucrt-x86_64-zlib --out out/zlib-native
```

Metadata, source contracts and foreign ELF inputs produce a Windows port job.
Supply the package owner's actual rebuilt `.exe` to create a private Bun binary
package and, optionally, a WinGet manifest:

```powershell
bun packages/package-converter/src/cli.ts convert .PKGINFO --format pkginfo --ecosystem mingw --package app --out out/app-windows --windows-artifact app.exe --winget-id Example.App --installer-url https://example.org/app.exe --publisher Example --license MIT
```

The converter reads executable headers and imported DLLs. Non-system imports
require explicit `--runtime DLL=Publisher.Package` mappings for WinGet owners or
`--runtime DLL=bun:@scope/package@1.2.3` for a pinned Bun dependency. Bundled DLLs
retain their own import requirements; Cygwin, MSYS2 and VC redistributables are
external runtimes unless present in the payload. WinGet requires a real user-mode
PE executable and WinGet runtime owners; a DLL is never rendered as an installer.
WinGet owner mappings are recorded as system prerequisites; Bun-owned runtime
packages become pinned `package.json` dependencies.
Linux ELF payloads produce Windows rebuild jobs. Existing output directories are refused. Metadata
checksums retain their algorithm; repository signatures belong to native APT,
pacman or Cygwin and are not verified by metadata conversion.
For source versions containing Debian epochs, select `--windows-version` explicitly;
the original version remains in the Bun package contract.

Gzip uses bounded decompression streams. Zstandard uses Bun's native decoder after
checking the declared size, window size, every block's maximum output and the exact
frame boundary. A frame without a declared size is accepted only when the sum of
every block's worst-case output and its window are within the 256 MiB limit.
Dictionary-dependent, skippable, multiple and trailing frames are rejected.
XZ and bzip2 use an
explicitly configured native 7-Zip executable through stdin/stdout, with a
30-second deadline. Source extraction preserves links only within the new source
tree and fails when the host cannot represent a source path or link.

Format references: [Debian binary archives](https://manpages.debian.org/unstable/dpkg-dev/deb.5.en.html),
[PKGINFO](https://man.archlinux.org/man/PKGINFO.5.en),
[SRCINFO](https://man.archlinux.org/man/SRCINFO.5.en),
[Cygwin package hints](https://cygwin.com/packaging-hint-files.html),
[WinGet manifests](https://learn.microsoft.com/en-us/windows/package-manager/package/manifest).

## pacman2apt

`pacman2apt` converts Arch-family binary packages (CachyOS `cachyos-v3`,
`cachyos-core-v3`, `cachyos-extra-v3` and `cachyos`, Arch `core`, `extra` and
`multilib`, and the Omarchy repository) into Ubuntu `.deb` packages and serves
them from a flat local APT repository. Repository names, mirror templates, the
x86-64 level and signing keys come from the factory catalogs
(`factory/arch/cachyos/integration.json`, `factory/arch/omarchy/integration.json`
and `pacmanRepositories()` in `factory/arch/index.ts`). The order is the
pacman.conf order, so the first repository that has a name wins. Omarchy's
catalog remains inert until its integration is enabled, qualified, and marked
executable; it is currently omitted from sync. The Arch lock resolver remains
restricted to dated official Arch archive repositories.

```sh
pacman2apt sync                       # pacman .files databases + Ubuntu index into bun:sqlite
pacman2apt resolve gamescope          # show the dependency mapping only
pacman2apt convert gamescope --prefix /opt/pacman2apt/{name}
pacman2apt convert proton-cachyos-slr --out /var/lib/aphrody-apt/pacman2apt
pacman2apt repo /var/lib/aphrody-apt/pacman2apt
pacman2apt install mise-bin crush-bin # convert + publish + apt-get install --no-remove
```

The same commands are available as `package-converter pacman2apt ...`. State
(index, downloaded packages, Ubuntu indices) lives in `--state DIR`, default
`$PACMAN2APT_STATE` or `~/.cache/pacman2apt`.

**sync** downloads `<repo>.files` (a superset of `<repo>.db`) from the catalog
mirrors and indexes name, version, filename, SHA-256, sizes, depends, provides
(including automatic soname provides such as `libfoo.so=1-64`), conflicts,
replaces, executables and shared-library file names. x86-64-v3 repositories are
skipped on hosts without AVX2/BMI2/FMA/MOVBE unless `--isa x86-64-v3` is given.
It then indexes the Ubuntu series reported by `/etc/os-release`
(`VERSION_CODENAME`, or `--series` on another host): `InRelease` of the release,
`-updates` and `-security` suites (verified with `gpgv` and the Ubuntu archive
keyring when present; 26.10 publishes SHA512 checksums only), `Packages.gz` for
amd64 and i386, and `Contents-amd64.gz`/`Contents-i386.gz`. Every path is folded
to its merged-`/usr` form; shared-library names are indexed by directory class
(multiarch, `lib`, `lib64`, `lib32`, i386 multiarch).

**convert** downloads the package from its repository, verifies the database
SHA-256 and every payload file against the package's own `.MTREE`, and streams
the payload into a root-owned `data.tar.zst` (Zstandard streams; no in-memory
size limit for large trees such as Proton). ELF objects are analysed for
`DT_NEEDED`, `DT_SONAME`, run paths and `GLIBC_`/`GLIBCXX_`/`CXXABI_` version
requirements; conversion is refused when a requirement exceeds the target (probed
from the host's `libc.so.6` and `libstdc++.so.6`, otherwise `data/pacman2apt.json`).
Libraries shipped by the package itself are internal and do not create
dependencies or ABI requirements.

Dependencies are mapped in this order: curated `override` entries, soname
provides (`libfoo.so=1-64`), curated `map` entries for non-library and virtual
names (`data/pacman2apt.json`), then the Arch package that owns or provides the
name: the sonames of it that the payload actually links (precise runtime
packages), otherwise all of its shared libraries resolved against Ubuntu
Contents plus the Ubuntu owner of its executables; finally an Ubuntu package or
virtual package of the same name. Remaining dependencies that exist in a pacman database are converted
recursively with `--with-deps`; otherwise conversion stops and lists them
(`--skip-dep NAME` or `--allow-unresolved` drop them explicitly). Protected names
(glibc, gcc-libs, mesa, systemd, kernels, pacman, …) are never converted. Sonames
linked by the payload but not covered by a mapped dependency are added as
`Depends` (`--elf-deps recommends|none` relaxes this for self-contained trees).

Versions map `[epoch:]pkgver-pkgrel` to `[epoch:]pkgver-pkgrel+pacman2apt`. The
Debian name is the pacman name; when Ubuntu already has that name the repository
family suffix is appended (`gamescope-cachyos`), so the conversion never
upgrades or replaces an Ubuntu package. `Provides`, `Conflicts` and `Replaces`
are kept only for names outside the Ubuntu archive. Files under `etc/` become
conffiles; non-root owners and extended attributes (file capabilities) are not
representable in dpkg and are reported.

Every shipped path is checked against Ubuntu Contents, the installed dpkg file
lists and the live filesystem. Any overlap stops the conversion with a report;
`--prefix /opt/pacman2apt/{name}` relocates a self-contained tree (absolute
symlinks into the tree are rewritten, scripts and hooks are disabled).

`.INSTALL` functions become maintainer scripts when they are plain shell
(pacman-specific tools such as `pacman`, `mkinitcpio` or `pacman-key` disable the
translation): `pre_install`/`pre_upgrade` in `preinst`, `post_install`/
`post_upgrade` in `postinst`, `pre_remove` in `prerm`, `post_remove` in `postrm`;
failures are reported but ignored, like pacman. libalpm hook effects map to dpkg
triggers (`ldconfig`, `/usr/share/icons/hicolor`, `/usr/share/applications`,
`/usr/share/glib-2.0/schemas`, `/usr/share/mime/packages`, `/usr/share/fonts`,
`/usr/lib/udev/hwdb.d`, `/usr/lib/sysctl.d`, `/usr/lib/binfmt.d`) and to
`postinst` snippets for systemd `daemon-reload`, `systemd-sysusers`,
`systemd-tmpfiles --create` and `udevadm control --reload`. Units are never
enabled or started. Each `.deb` has a `.pacman2apt.json` report beside it.

**repo DIR** writes `Packages`, `Packages.zst` and `Release` (MD5/SHA256) for the
`.deb` files in `DIR`. **install** (Linux target) converts into the repository
(default `/var/lib/aphrody-apt/pacman2apt`), writes
`/etc/apt/sources.list.d/pacman2apt.sources` (`Trusted: yes` local file
repository), updates only that source, simulates `apt-get install --no-remove`
and refuses plans that remove packages or upgrade glibc, Mesa, systemd or udev,
then installs. Privileged steps use `sudo -n` when not run as root.

Limits: pacman database signatures (`.sig`) are not verified (package SHA-256
from the database and `.MTREE` digests are); xz-compressed packages need
recompression; dependency version constraints are kept only between converted
packages; Arch and Ubuntu library ABIs with the same soname are assumed
compatible; kernel modules are shipped without `depmod`.
