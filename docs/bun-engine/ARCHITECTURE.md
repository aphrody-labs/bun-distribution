# Architecture

1. Kernel: `crates/bun-engine-core`; time, lifecycle, one C ABI and deterministic scheduling.
2. World: the pinned `crates/bevy` source in the unified workspace.
3. Render: pinned `crates/wgpu` with DX12, static DXC, WGSL, SPIR-V and GLSL.
4. Platform: pinned `crates/winit` windows, input, displays and event loop.
5. Editor: separate binary using the same public contracts.
6. Tooling: Bun asset graph, packaging, hot reload and compatibility services.
7. Binary ingestion: the dependency-free kernel identifies bounded PE, ELF, Wasm,
   Android packages and runtime formats (APK/AAB/APKS/APEX, DEX/OAT/ART),
   Nintendo DS, archive, virtual-filesystem and firmware headers. Identification
   reports architecture and endianness when the format defines them; decoding,
   mounting, execution and conversion delegate to their unified owners.
8. Reverse engineering: `bun:windows.pe` performs bounded Windows inspection,
   `crates/ghidra-decompiler` owns native decompilation, and the pinned Ghidra plus
   NTRGhidra sources own full analysis and Nintendo loaders. The private
   `aphrody-code/ghidra-suite-plugin` owns Codex/GUI/MCP/headless orchestration. See
   [GHIDRA-PLUGIN-SUITE.md](GHIDRA-PLUGIN-SUITE.md).
9. Linux gaming: `crates/linux-cachyos` and `crates/kernel-patches` own the CachyOS
   kernel layer; `crates/proton-cachyos` and `crates/wine-cachyos` own the Steam Play and
   Win32 compatibility layer. See [CACHYOS-SUITE.md](CACHYOS-SUITE.md).
10. Windows Omarchy: `crates/omarchy-windows` owns the WHPX/QEMU launcher and
    resolves an explicit QEMU, then MSYS2 UCRT64/CLANG64/MINGW64, then stock QEMU.

Physics, animation, audio, networking, scripting, streaming and authoring share
the same distribution contract and may load lazily through their owners.

The repository has one root Cargo workspace, one Bun package workspace, one
CMake project and one vcpkg manifest. `crates/bun-runtime` owns Bun, Buv, PyJS,
Python, CUDA bindings and the shared runtime FFI. Linux/NVIDIA/CUDA/DirectX
sources are pinned under `crates/`; LLVM, QEMU, CMake, vcpkg and Make are pinned
under `toolchains/`. They are required distribution owners with scoped builds.
`crates/pkg-manage-util` owns CachyOS package builds and
`crates/repo-manage-util` is a direct member of the root Cargo workspace for
repository reset, update, synchronization and package movement.

Console runtimes, CPU implementations and free native SDK source trees are
unified catalog entries described in [CONSOLE-PLUGINS.md](CONSOLE-PLUGINS.md).
Their implementations remain owner-routed rather than duplicated in the kernel.
