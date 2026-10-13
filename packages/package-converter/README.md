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
