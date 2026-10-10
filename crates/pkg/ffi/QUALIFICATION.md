<!-- SPDX-License-Identifier: Apache-2.0 -->
# Windows native example qualification, 2026-10-09

Actual library: native MSVC debug `aphrody_pkg.dll`, built by the integrating
session through the repository Cargo owner. Each example uses an isolated store
under `C:/tmp/pkg-accept`, with all native and .NET build outputs outside the repo.

| Consumer | Native execution | Result |
| --- | --- | --- |
| C | MSVC 19.51.36260.0, Windows SDK 10.0.26100.0 | Digest below; one blob, 11 bytes |
| C++ | Same native toolchain, C++17 | Same digest; verify passes |
| C# P/Invoke | .NET SDK 10.0.401, net8.0 runtime | Same digest; verify passes |
| Python ctypes | Actual debug DLL, executed by integrating session | Same digest; one blob, 11 bytes |
| Bun bun:ffi | Actual debug DLL, executed by integrating session | Same digest; one blob, 11 bytes |
| Rust | Direct store owner, example executed by integrating session | Same digest; one blob, 11 bytes |

All six isolated stores contain exactly the same one 11-byte blob named
`ed090d23a1d23b45d224e446cfaca77279d26c0b0dd88fd3b6f8c707c9f2985d`.
The C++ compile first exposed a missing `<string>` include; the include was added
and the complete CMake build rerun successfully.

Exact PowerShell commands (paths identify this qualification context, not product
defaults):

```powershell
cmake -S C:/aphrody/crates/pkg/ffi/examples -B C:/tmp/pkg-accept/native-build -DAPHRODY_PKG_LIBRARY=C:/Users/aphro/AppData/Local/aphrody/target/debug/deps/aphrody_pkg.dll.lib
cmake --build C:/tmp/pkg-accept/native-build --config Debug
$env:PATH = 'C:/Users/aphro/AppData/Local/aphrody/target/debug/deps;' + $env:PATH
C:/tmp/pkg-accept/native-build/Debug/pkg_c.exe C:/tmp/pkg-accept/c-store
C:/tmp/pkg-accept/native-build/Debug/pkg_cpp.exe C:/tmp/pkg-accept/cpp-store
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
dotnet run --project C:/aphrody/crates/pkg/ffi/examples/dotnet --artifacts-path C:/tmp/pkg-accept/dotnet-build -- C:/tmp/pkg-accept/dotnet-store
python crates/pkg/ffi/examples/python/smoke.py C:/Users/aphro/AppData/Local/aphrody/target/debug/deps/aphrody_pkg.dll C:/tmp/pkg-accept/python-store
bun crates/pkg/ffi/examples/bun/smoke.ts C:/Users/aphro/AppData/Local/aphrody/target/debug/deps/aphrody_pkg.dll C:/tmp/pkg-accept/bun-store
cargo run --offline -p aphrody-pkg-ffi --example rust -- C:/tmp/pkg-accept/rust-store
```

PATH changes were scoped to the invoking process. Nothing was published, installed
as a product, or configured against protected stores. This proves native ABI calls
for the five foreign consumers and direct Rust owner calls on this Windows target;
it does not prove release packaging, all architectures or remote execution.
Python/Bun/Rust execution results were supplied by the integrating session and
their physical content-addressed stores were checked independently.
