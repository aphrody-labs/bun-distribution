# WSL native source build — Aphrody

Audit date: 2026-10-01. Upstream checkout: `.cache/upstream/WSL` (not in repo) (generated or machine-local artifact; presence depends on the build host), commit `c34e75aea8dcc50c0c2f9e76b2de9b26a58e8b67` (Microsoft/WSL). Read directly: `doc/docs/dev-loop.md`, `.vsconfig`, root `CMakeLists.txt`, `cmake/findNuget.cmake`, `cmake/FindLINUXBUILD.cmake`, `UserConfig.cmake.sample`, `packages.config`.

## Native build contract

- Administrator needed for symbolic links. No need to enable Developer Mode when already elevated.
- Visual Studio 2022 v143 MSVC, MSBuild, ATL, Spectre-mitigated C++ libraries, Clang cross compiler; Windows SDK exactly `10.0.26100.0`.
- CMake >= 3.25; Visual Studio generator x64 or arm64, Release configuration.
- Microsoft public WSL NuGet feed `https://pkgs.dev.azure.com/shine-oss/wsl/_packaging/WslDependencies/nuget/v3/index.json`; NuGet executable v5.10.0 pinned SHA256 by upstream.
- WSL Linux init/helper components are cross-compiled by Windows Clang to `x86_64-unknown-linux-musl` using `Microsoft.WSL.LinuxSdk`, not built by host Ubuntu gcc.
- WSLg `WSLDVCPlugin.vcxproj` requires v143 and Spectre libs, SDK `10.0` (can use installed26100).

## Installed build staging

Independent source copy and build outputs: `C:\ProgramData\Aphrody\WslBuild`. Dedicated VS installation: `C:\ProgramData\Aphrody\WslBuild\VS`.
Reusable recipe: `.cache/upstream/build/aphrody/wsl/build-native.ps1` (not in repo) (generated or machine-local artifact; presence depends on the build host); Windows copy in staging. Syntax parsed successfully by Windows PowerShell.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\Aphrody\WslBuild\build-native.ps1 -Source C:\ProgramData\Aphrody\WslBuild\source -Configuration Release -Jobs 4
```

The recipe stages source without editing the canonical checkout, builds into `build-x64`, records a transcript and JSON artifact inventory. `-InstallDependencies` installs documented BuildTools components; `-WslgSource <Windows-path>` optionally builds the plugin. No WSL installation, shutdown or Windows reboot is performed.

## Initial observations

The legacy `C:\BuildTools` contained only compiler-directory fragments: both Linux `ls` and Windows `Test-Path` confirmed `cl.exe` absent. First WinGet install exited1; installer setup log ended during existing-package inventory and did not identify a specific exception. Retried into a dedicated path after closing the idle Visual Studio Installer window.

Dedicated installation successfully restored real `cl.exe` (executed: MSVC19.44.35229), MSBuild, CMake and ATL. Clang's signed official payload is 2,231,986,345 bytes; the lengthy download is progress rather than an inferred deadlock. Initial plugin attempt before completion failed MSB8040 because Spectre libraries had not yet been installed. Final results below will supersede these provisional observations.

## Scope of “all from source”

The open WSL repository depends on redistributable Windows components (`Microsoft.WSL.DeviceHost`, `Microsoft.WSL.Dependencies`, MSRDC, DXCore, Direct3D). The published repository does not contain Windows or GPU-vendor driver source. A full WSL build can consume independently compiled kernel and WSLg artifacts by overriding `KERNEL_SOURCE_DIR` and `WSLG_SOURCE_DIR` through its local UserConfig; default builds fetch Microsoft kernel/WSLg NuGets. This is a measurable source-boundary, not complete Windows OS reconstruction.

## Out-of-source NuGet correction

Upstream documentation uses in-source `cmake .`. In a staged out-of-source build, upstream `nuget restore -SolutionDirectory <build>` resolves its config from the build folder, not source cwd. The first attempt consequently consulted nuget.org and failed to find private-to-feed WSL redistributables. The recipe now copies the upstream `nuget.config` into `build-x64/NuGet.Config`; explicit `-ConfigFile <source>/nuget.config` restoration verified that the WSL official feed supplies those packages (WSL.Dependencies x64/arm64 restored successfully). No modification to the canonical upstream source was needed.

## Final build results

Visual Studio Build Tools install completed exit0, vswhere reports isComplete=1; MSVC19.44.35229, LLVM/Clang19.1.5, SDK26100 and CMake available. NuGet restore against the official feed completed exit0;16 WSL-feed packages added after public NuGet cache packages.

The upstream `.vsconfig` names `Microsoft.VisualStudio.Component.VC.Tools.x86.x64.Spectre` and its ARM64 equivalent, absent from the installed signed VS17.14.41 catalog. Valid IDs are `Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre` and `Microsoft.VisualStudio.Component.VC.Runtimes.ARM64.Spectre`. A modify install with the x64 valid ID completed exit0 and provided `lib/spectre/x64/libcmt.lib`. First modify was blocked8006 by our own leftover CMake/MSBuild processes; those exact build children were stopped before retry. The active installed WSL was not stopped.

**WSLg Windows plugin built successfully** Release|x64,0warnings0errors; DLL/PDB+log/hash inventory under `.cache/upstream/build/aphrody/wslg/plugin` (not in repo) (generated or machine-local artifact; presence depends on the build host). DLL SHA256 `f68452311343c0615ddbce1a5c4aed954f286994f16f236b2c75b3a81a837d25`. Upstream `UpdateRCVersion.ps1` must stamp the resource placeholders before MSBuild. For Windows PowerShell5.1 the staged script's Windows1252 read/write calls were replaced with equivalent .NET ReadAllText/WriteAllText; canonical upstream remained clean. Metadata reflects tag1.0.79. No generic weakening of Spectre flags was applied.

Integrated x64 Release native executables, Linux init/initrd, glue MSIX and WSL MSI built from the staged upstream source and locally compiled kernel/WSLg images. MSI size 476,839,936 bytes; initial SHA256 `f667e8e2a971bdb09222d027b7377b798920c531ba01c996741205755e2bfdbe`. Artifact inventory: `.cache/upstream/build/aphrody/wsl/artifacts.json` (not in repo) (generated or machine-local artifact; presence depends on the build host). Built `wsl.exe --help` succeeds and prints full French help. No installation or runtime parity claimed. Final ALL_BUILD status is recorded below.

Root-owned versioned recipe is `scripts/build/os/build-native-wsl.ps1` (not in repo); the independently tested staging recipe is `.cache/upstream/build/aphrody/wsl/build-native-integrated-tested.ps1` (not in repo) (generated or machine-local artifact; presence depends on the build host). Necessary fixes: use package/wslg.rdp paths, copy only WSLDVCPlugin/devops/.git (never ignored vendor), stamp Windows resource version with PowerShell5.1-compatible encoding, add Windows Git to PATH, use local KERNEL_SOURCE_DIR/WSLG_SOURCE_DIR without WSL_DEV_BINARY_PATH. Kernel image and module VHDX consumed from `.cache/upstream/build/aphrody/kernel` (not in repo) (generated or machine-local artifact; presence depends on the build host); WSLg system image from `.cache/upstream/build/aphrody/wslg` (not in repo) (generated or machine-local artifact; presence depends on the build host). WSLg Linux image has upstream baked VERSION=dev although the checkout/native plugin are release1.0.79; preserve this distinction.

## Windows SDK repair evidence

The host SDK installation lacked AppxPackaging/OpcServices XML manifests and supporting DLLs, signing tools and WinRT metadata. MakeAppx failed14001, then missing OpcServices.dll, then absent SignTool.exe; last ALL_BUILD failed MIDL1001/MIDL5157 for missing UnionMetadata/10.0.26100.0/Windows.winmd. Restored absent files only from official Microsoft NuGet packages, both successfully verified by `nuget verify -Signatures` with Microsoft author/NuGet repository signatures and timestamps:

- Microsoft.Windows.SDK.BuildTools10.0.26100.9169, SHA256 `6000c971fc9155052a8359779b30b6682c39e091664d83b3852c4702ab6d238e`; eight manifests, eleven missing DLLs and four missing EXEs restored under SDKbin/x64. Existing DLLs/EXEs not overwritten. MakeAppx and SignTool help probes pass.
- Microsoft.Windows.SDK.CPP10.0.26100.9169, SHA256 `475269434dcd808a67853773272f972c3229c0e10c3ddc821290e70cc0f6904d`; missing UnionMetadata and References files restored under Windows Kits10. No existing files overwritten.

Native staging receipts: sdk-signature.log, sdk-cpp-signature.log, native-build-complete.log. Signed package payloads retained to reproduce the host repair. Upstream development signing is used; production signing/deployment remain outside this validation. Full Windows/GPU drivers remain upstream redistributables rather than reconstructed source.


## Final validation and maintenance handoff

WSL x64 Release host executables, cross-built Linux init/initrd, WSL MSI, glue MSIX, complete installer MSIX and Microsoft.WSL.Containers WinRT metadata were generated. Full help from the newly built wsl.exe succeeds. The final ALL_BUILD reached test compilation and failed only on wsltests C2065/C2131 because the recipe passed literal OFF as WSL_BUILD_WSL_SETTINGS, while upstream embeds this value as a C++ macro and defaults to false. Both staging recipe and CMake cache now use false/true; CMake reconfiguration succeeds. The remaining test compilation, already known failed, was stopped to release Windows/WSL for requested disk maintenance. No claim of a green ALL_BUILD or passing tests; wsltests must be rebuilt after maintenance, and runtime integration tests require deliberate deployment. Optional Settings UI and C# SDK were disabled.

All own cmake/MSBuild/cl/link/vctip/mspdbsrv processes under the dedicated staging toolchain were stopped and a follow-up process query returned none. Accidental WSLg vendor staging, redundant portable CMake distribution/archive and SDK extraction directory were removed. Official signed SDK NuGet packages and dependency/toolchain installations are retained. Source WSL and WSLg checkouts remain clean. No installed WSL shutdown, distro restart, service replacement, deployment or Windows reboot was performed. Final inventory and logs are saved under source/build/aphrody/wsl.
