# Rust systems catalog

Primary-source review: **13 October 2026**. This catalog records package identities,
feature boundaries and potential uses. It adds no dependencies or release pins.
Version-specific links identify the source inspected; integration must use the
capability owner's qualified lockfile and target configuration.

## Architecture fit

The distribution targets the owned Linux kernel and a GNU/glibc userspace
with Bun and COSMIC. Native Windows keeps its Windows/UCRT execution
context. Bun owns runtime and host interfaces; Material owns M3; COSMIC owns its
window/event model. The factory packages those owners. See
[native targets](NATIVE-TARGETS.md) and [upstream conventions](CODING.md).

| Area | Current integration boundary | Future bare-metal boundary |
| --- | --- | --- |
| Boot, CPU, MMIO and drivers | Existing Linux/Windows kernel and driver owners; native factory tools can produce boot artifacts. | A separately qualified firmware/kernel target owns privilege levels, address spaces, interrupts, DMA and hardware discovery. |
| Heaps and synchronization | Reuse Bun/JSC and existing Rust host allocation/threading contracts. | A kernel owner supplies mapped memory, allocator initialization and interrupt-safe locking. |
| WASM | Reuse Bun's existing WebAssembly host; a Rust sandbox can be an optional extension behind the same capability owner. | Interpreter/compiler support also needs allocation and explicit host imports. |
| Graphics | Reuse Material's renderer and the pinned COSMIC backend; backend features belong there. | Hardware/display drivers and graphics API support need independent qualification. |
| Network, formats and CLI | Extend existing Bun/package-conversion/host owners through their APIs. | A device backend, protocol stack and execution environment must be implemented explicitly. |

UEFI or a Rust bootloader does not provide the libc, threads, virtual memory,
signals and platform services required by the present Bun/JSC runtime. A firmware
image therefore does not qualify Bun or COSMIC on bare metal. This is an
architecture inference from the current [native target contract](NATIVE-TARGETS.md).

## Boot, CPU and low-level access

| Canonical package | Verified contract | Placement |
| --- | --- | --- |
| [uefi](https://docs.rs/crate/uefi/0.41.0/source/src/lib.rs) | no_std firmware interfaces; optional allocation, global allocator and logging helpers. Its Boot Services allocator cannot be used after exit_boot_services. | Firmware utilities and a future boot owner. Keep post-exit memory ownership separate. |
| [bootloader](https://docs.rs/crate/bootloader/0.11.17/source/src/lib.rs) | The published library is a std host-side image builder, with BIOS/UEFI features. It produces x86_64 boot images. | An optional factory tool for experimental boot artifacts; its builder crate is not a no_std kernel library. |
| [x86_64](https://docs.rs/crate/x86_64/0.15.5/source/src/lib.rs) | no_std architecture types/instructions; observed defaults include nightly and instructions. Stable use selects supported features with defaults disabled. | Address types may support tools; privileged instructions remain with the boot/kernel owner. |
| [riscv](https://docs.rs/crate/riscv/0.16.1/source/src/lib.rs) | no_std register/architecture interfaces. critical-section-single-hart implements a single-hart interrupt policy and is unsound for a multi-hart system. | Future RISC-V firmware/kernel work with an explicit hart and interrupt model. |
| [aarch64-cpu](https://docs.rs/crate/aarch64-cpu/11.2.0/source/src/lib.rs) | no_std CPU registers/instructions; access depends on the current exception level. | Future AArch64 firmware/kernel work; normal host applications use OS APIs. |
| [volatile](https://docs.rs/crate/volatile/0.6.1/source/src/lib.rs) | no_std volatile raw-pointer wrappers; optional derive/unstable APIs. Volatile accesses do not supply synchronization or valid mappings. | MMIO through an owner-provided mapping and access contract. |
| [spin](https://docs.rs/crate/spin/0.12.3/source/src/lib.rs) | no_std spin synchronization; optional std yielding and alternative mutex policies. | Low-level contexts that own interrupt/reentrancy rules; ordinary host waits retain their host threading owner. |

## Allocation

| Canonical package | Verified contract | Placement |
| --- | --- | --- |
| [linked_list_allocator](https://docs.rs/crate/linked_list_allocator/0.10.6/source/src/lib.rs) | no_std free-list heap. Default use_spin uses spinning_top and exposes LockedHeap; alloc_ref enables nightly allocator APIs. | A caller-owned heap or future kernel allocator, with an explicitly supplied memory region. |
| [talc](https://docs.rs/crate/talc/5.1.1/source/README.md) | no_std allocator with a memory-source abstraction. TalcLock<R, S> requires the caller's lock_api::RawMutex implementation; TalcCell is single-threaded. There is no bundled default locking feature in the inspected release. | An optional arena/WASM/kernel heap after memory-source, synchronization and growth policy are defined. |
| [buddy_system_allocator](https://docs.rs/crate/buddy_system_allocator/0.13.0/source/src/lib.rs) | no_std buddy allocator; observed defaults are alloc plus use_spin. Frame-allocation and LockedHeap/global-allocator APIs are feature-gated. | Primarily future page/heap management. It does not allocate physical memory from the host by itself. |

The names linked-list-allocator and buddy-allocator are catalog labels; the
verified Cargo identities are linked_list_allocator and buddy_system_allocator.
TalcLock uses a supplied lock implementation; its synchronization properties
depend on that implementation. TalcCell serves single-threaded use. These
contracts are explicit in its [current API](https://docs.rs/talc/5.1.1/talc/).

## Devices and buses

| Canonical package or unresolved name | Verified contract | Placement |
| --- | --- | --- |
| [virtio-drivers](https://docs.rs/crate/virtio-drivers/0.13.0/source/src/lib.rs) | no_std VirtIO drivers; alloc/embedded-io defaults. The caller implements the unsafe Hal DMA/MMIO contract. | Future VirtIO guest drivers. Current native applications use the existing host driver interfaces. |
| [pci_types](https://docs.rs/crate/pci_types/0.10.1/source/src/lib.rs) | no_std configuration-space types; access is provided by ConfigRegionAccess. | A candidate for shared PCI types and a qualified enumeration backend. |
| [pci](https://docs.rs/crate/pci/0.0.1/source/src/lib.rs) | A separate legacy x86 port-I/O scanning crate; its source includes old nightly syntax. It does not provide PCIe ECAM support. | Compiler/target compatibility is unqualified; it is not the default modern PCI candidate. |
| pcie-enumeration | The exact [registry query](https://crates.io/api/v1/crates/pcie-enumeration) returned 404. No canonical package was established under that spelling. | Keep this requested identifier unresolved. |
| [pcie](https://docs.rs/crate/pcie/0.7.1/source/src/lib.rs) | A separately verified rcore-os/tgoskits crate: no_std plus alloc, MMIO interfaces and controller enumeration. | A future PCIe candidate requiring its mapping/allocator contracts. It is not an automatic alias for pcie-enumeration. |
| [embedded-hal](https://docs.rs/crate/embedded-hal/1.0.0/source/src/lib.rs) | no_std delay/GPIO/I2C/SPI/PWM traits without an alloc requirement. | Shared driver interfaces implemented by an explicit platform adapter. |

## Optional WASM execution

| Canonical package | Verified contract | Placement |
| --- | --- | --- |
| [wasmtime](https://docs.rs/wasmtime/49.0.2/wasmtime/) | A configurable runtime/compiler with optional Cranelift, component-model, async, threads and runtime features. Defaults enable a broad host runtime. [Minimal embeddings](https://docs.wasmtime.dev/examples-minimal.html) select their feature and execution-engine closure. | Optional native component/WASI hosting when the existing runtime owner needs that contract. Bare-metal/custom-host use needs its own integration; default host features do not establish it. |
| [wasmi](https://docs.rs/wasmi/2.0.0/wasmi/) | A WebAssembly interpreter that supports no_std **with alloc**. Defaults enable std and WAT; disabling std requires disabling defaults and selecting the release's required execution/validation features. The [source](https://github.com/wasmi-labs/wasmi/blob/main/crates/wasmi/src/lib.rs) explicitly uses alloc. | An optional constrained Rust interpreter host. Allocation, fuel/memory limits and allowed host imports remain explicit. no_std does not mean no heap. |
| [wasmedge-sdk](https://docs.rs/crate/wasmedge-sdk/0.14.0/features) | Rust bindings to the native WasmEdge C API, backed by wasmedge-sys. Linking/downloading features and native-engine compatibility depend on the chosen SDK release. | Optional native WasmEdge integration through one owner and an exact engine/SDK/target contract. It is not a self-contained pure-Rust bare-metal interpreter. |

WasmEdge is the project name; wasmedge-sdk is the Cargo SDK identity. Its
[upstream main README](https://github.com/WasmEdge/wasmedge-rust-sdk) documents
newer examples/features than the registry release inspected here. Resolve the
SDK/sys/native-engine release matrix before selecting features; this catalog
does not turn the main-branch examples into package pins.

## Graphics and window handles

| Canonical package | Verified contract | Placement |
| --- | --- | --- |
| [wgpu](https://docs.rs/wgpu/30.0.1/wgpu/) | Portable graphics API with selectable native and browser backends. Device, surface, driver and target support are separate requirements. | The existing renderer/COSMIC graphics owner selects its backend closure. A WASM Rust compile is not a GPU/browser rendering result. |
| [wgpu-core](https://docs.rs/wgpu-core/30.0.1/wgpu_core/) | wgpu's implementation/validation core; it belongs to the same release family as the public API and backend crates. | Lower-level integration behind that graphics owner when required. It is not a second windowing or OS framework. |
| [raw-window-handle](https://docs.rs/raw-window-handle/0.6.2/raw_window_handle/) | Interoperable platform window/display handles, with borrowing and validity contracts. It does not create windows or run their event loop. | Bridge the existing COSMIC/native window owner to a compatible renderer; preserve handle lifetime and thread ownership. |

## Networking and binary formats

| Canonical package | Verified contract | Placement |
| --- | --- | --- |
| [smoltcp](https://docs.rs/smoltcp/0.14.0/smoltcp/) | Configurable TCP/IP stack for embedded/no_std operation. Defaults enable std; raw-socket/TUN-TAP device features require std. | Optional userspace/embedded stack with an owned device, timing and socket-resource model. Existing Linux/Windows/Bun networking keeps the native host stack. |
| [etherparse](https://docs.rs/etherparse/0.21.0/etherparse/) | Packet parsing/building; default std can be disabled, with alloc separate. | Extend an existing packet-format owner. Parsing a packet does not implement a network driver or full stack. |
| [zerocopy](https://docs.rs/zerocopy/0.8.62/zerocopy/) | no_std by default; optional alloc/std/derive. Typed byte conversions depend on layout, alignment, validity and lifetime traits. | Shared binary/ABI structures where those contracts can be proven. Preserve endian and input-bound checks. |
| [binrw](https://docs.rs/binrw/0.15.2/binrw/) | Declarative binary read/write derives; defaults include std, while no_std is supported with the matching IO/allocation configuration. | An extension to an existing native binary-format owner; retain bounds and actual payload ABI. |
| [nom](https://docs.rs/nom/8.0.0/nom/) | Byte-oriented parser combinators; defaults enable std, which implies alloc; constrained use selects the appropriate feature closure. | Reuse a parser owner for streaming/incremental formats and explicit incomplete-input handling. |

## Shell and command-line tools

| Verified project/package identity | Contract | Placement |
| --- | --- | --- |
| [uutils/coreutils](https://github.com/uutils/coreutils) / [coreutils](https://crates.io/crates/coreutils) / [uucore](https://crates.io/crates/uucore) | coreutils supplies utility programs; uucore supplies their shared Rust plumbing. Utility and platform features are explicit. The exact uutils-coreutils registry name returned 404. | Native userspace tools or existing CLI adapters. uucore alone is not the complete command suite. |
| [Nushell](https://github.com/nushell/nushell) / [nu](https://crates.io/crates/nu) | Structured-data shell with separate parser, engine, protocol and command crates; features select plugin/network/SQLite/etc. The unrelated nushell registry entry is not the canonical upstream package. | Reuse the existing shell owner through its CLI/crate boundary. It requires a qualified native host and is not a firmware shell by declaration. |
| [clap](https://docs.rs/clap/4.6.7/clap/) | Rust command-line parser; default features include std/help/usage/error context, with derive optional. | Existing Rust CLI entrypoints. Bun application CLIs continue through the Bun owner. |

## Selection record

Choose a package only when an existing owner needs the stated contract. Record
its canonical package/library identity, exact source or registry checksum,
license, target ABI, features and transitive owner closure in that owner's
manifest/receipt. no_std, alloc, allocator locking, privileged access and native
engine requirements are separate properties. Compilation, execution, display,
boot and deployment evidence remain separate.

The supplied external reference App-69ef18c674308191a2f952431f91ea61 has no
resolved capability or primary-source URL in this review's exposed tool inventory. It is
not assigned a crate, repository or deployment role by this catalog.
