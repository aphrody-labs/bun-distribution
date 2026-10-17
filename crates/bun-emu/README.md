# bun-emu

Native multi-system emulation for Bun OS. One `Machine` trait (`run_frame`, `screens`) over
the cores below; no wrapper around external emulator executables.

## Status

| System | Core | State |
| --- | --- | --- |
| Nintendo DS | `aphrody-dust-core` (Rust, interpreter, soft 2D/3D, HLE BIOS) | runs: `bun-emu nds <rom> --frames N --out DIR` |
| PS2 | `vendor/pcsx2` (fork of PCSX2) | pinned, not built |
| 3DS | `vendor/azahar` (fork of Azahar) | pinned, not built |
| GameCube/Wii | `vendor/dolphin` (fork of Dolphin) | pinned, not built |
| DS (reference) | `vendor/melonds` (fork of melonDS) | pinned, not built |
| Wii/GameCube (Rust) | `vendor/gecko` (fork of ioncodes/gecko) | pinned, not built |
| Switch (Rust) | `vendor/oboromi`, `vendor/nexium` (forks) | pinned, not built |
| ARM firmware | `rdynarmic` A64 JIT, QEMU `virt` map (RAM 0x4000_0000, PL011) | runs: `bun-emu arm <image>`; a hand-assembled image prints over the UART and stops on WFI |
| Linux, Windows | WHP/KVM hypervisor (planned) | not started |
| Android | Android SDK emulator (QEMU) | external AVD only |

## Stack decisions

- **Qt 6 front end:** `cxx-qt` (KDAB) for QObject/QML from Rust; it does not wrap QWidgets.
  `qmetaobject-rs` is the direct-API alternative.
- **Rust and C++:** `cxx` for interfaces we own, `autocxx` for large existing C++ trees such
  as the vendored emulators, `bindgen` for C, `cbindgen` for Rust-to-C headers.
- **Android from Rust:** `ndk` and `ndk-context` crates with `cargo-ndk`; JNI directly or
  UniFFI (JNA does not call `JNI_OnLoad`, so initialize `ndk-context` explicitly).
- **Hypervisor guests:** QEMU's Rust support covers device models only; accelerators stay
  C. For an in-process Windows guest use the `whpx` crate (x64 only); on Linux
  `kvm-ioctls` from rust-vmm.
