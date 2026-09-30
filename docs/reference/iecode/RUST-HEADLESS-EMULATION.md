# Rust headless emulation and game SDK contract

Decision date: 2026-09-29. IECODE is the integration sandbox for this target
architecture, not a claim that a
DS/3DS/Wii/Switch game boots in the new Rust lifecycle. `crates/emu::headless`
currently supplies a pure virtual-clock/snapshot contract and synthetic tests.
The platform registry remains metadata until each adapter passes a real legal
homebrew boot fixture. Steam/Proton is a PC compatibility integration, not a
fifth emulated console.

## Runtime ownership and execution flow

```text
CLI / cross-platform GUI / browser-WASM / C ABI consumers
  -> session host (permissions, files, network, persistence, pacing)
    -> bounded input and output ports (typed, versioned, backpressured)
      -> headless Rust session (virtual clock, deterministic lifecycle)
        -> one console core (CPU, bus, RAM, devices, GPU commands, timing)
          -> console-specific firmware/homebrew interfaces
```

The pure core takes explicit input snapshots and virtual-time budgets and emits
typed output. The host owns all nondeterministic operations: wall clock, storage,
network sockets, audio devices, graphics adapters and account state. No
frontend, Steam SDK, AI runtime or `wgpu` type is linked into the pure core.
The console implementation owns its CPU, RAM map, device registers and timing;
sharing a scheduler or codec does not merge incompatible console hardware.

| Layer | Reuse rule | Backpressure / correctness gate |
| --- | --- | --- |
| Input | Shared event timestamping and remapping; per-console button, touch and motion semantics | Bounded queue; replay hash independent of GUI |
| CPU/bus/RAM | Shared bit operations, memory safety helpers and debugger protocol only | No virtual dispatch or allocation in the instruction hot path without a benchmark |
| GPU/video | Console-specific command decoder, shared frame transport and separate `wgpu` renderer | No GPU readback in the emulation tick loop; frame queue can drop presentation, never state |
| Audio | Console-specific mixer, shared sample transport | Bounded ring with explicit underrun/overrun metrics |
| Network | Deterministic virtual device; host adapter owns real sockets | Recorded inputs for replay; no socket access inside the core |
| Save states | Per-console state schema plus shared envelope/version/checksum | Round-trip, version rejection and replay tests before disk persistence |
| Cheats/debugger | Optional host-authorized overlay at deterministic safe points | Disabled for protected online sessions; never patch a third-party protected process |
| UI/CLI/FFI/WASM | Thin consumers of the same session API | No duplicated parser, scheduler or game logic |

The immediate contract is generic over console input and state, so it cannot
silently normalize hardware-specific behavior. A failed or invalid core step
is fail-stop: the host discards that session; it does not retry partially
mutated hardware. Persistent save-state encoding, output ports and ABI stability
are later gates, not implied by the in-memory snapshot test.

Native rendering targets the workspace `wgpu` 30.0.1 dependency, with Vulkan/D3D12/Metal chosen through
capability probing; browser delivery uses WebGPU and an explicit WebGL fallback
only if a measured browser target needs it. The shared output contract must not
expose `wgpu` objects: Aphrody UI currently pins `wgpu` 26, and a typed GPU
handle crossing that version boundary would create incompatible duplicate
stacks. Prove native and `wasm32-unknown-unknown` adapters independently before
adding `wgpu` to the workspace. Headless CPU-only tests stay GPU-free.

The native AI layer is optional and out-of-process or on a bounded worker. It
may inspect consented traces, propose debugger actions and assist game
development, but cannot make the deterministic CPU/GPU tick wait for inference.
Its suggestions require explicit host validation before state mutation. No AI
feature is part of a protected Steam/EAC session or a hidden automation path.

## Steam, Proton, Wine and anti-cheat boundary

An IECODE-owned PC game can use the official Steamworks API with its assigned
AppID, licensed account and publisher-provided SDK. On Linux, the publisher
tests the game under Proton and explicitly enables EAC's supported Linux
client mode for that title. IECODE may expose an opt-in launcher/diagnostic
adapter for that authorized game; it does not impersonate a third-party AppID,
assert a Steam license, inject into a protected process or bypass anti-cheat.
Wine/Proton are external compatibility runtimes, not embedded emulator cores.

The existing `EacService::disable_eac()` in native IECODE is a legacy offline
modding path and is **not** a protected multiplayer integration. It must never
be invoked from the Steam/EAC integration mode. Before shipping such a mode,
replace the ambiguous API with explicit offline-only policy and add an
integration test that protected launch rejects the bypass path. Access to
Level-5 test files does not by itself grant Steamworks/EAC publisher authority.

## Game-creation SDK and engine selection

IECODE's public game SDK should have one portable Rust API for assets, input,
audio, save formats, scene/tooling and test harnesses, with C ABI bindings for
C/C++, C#, Bun and Python. Target packages are independent adapters for DS,
3DS, Wii and Switch. The public homebrew path evaluates libnds, libctru,
libogc and libnx with exact-source license audits and toolchain smoke tests.
Official Nintendo SDK material is **external**, configured only by an
individually authorized developer installation; it must not be copied,
combined into the public SDK, documented with private details or committed.
Community adapters and official adapters must never be conflated.

Bevy is the selected Rust game-engine upstream: its modular ECS, renderer and
web support fit the Rust-first SDK better than a GUI-coupled engine. The full
upstream-history fork is now
[`aphrody-code/bevy`](https://github.com/aphrody-code/bevy), with an
`aphrody/stable-0.19.1` branch rooted at the stable `v0.19.1` tag. Its
`aphrody/engine-host` package is the first functional, manually driven
headless *game* host (2 tests pass); upstream Bevy crates remain untouched.
Build the game-engine extensions in that fork, not by copying Bevy into
IECODE. The emulator scheduler and console hardware cores remain independent
of Bevy ECS. Their IECODE prototypes move to the appropriate Aphrody Rust
owner only after fixture-based parity, API stability, deduplication and a
cross-platform gate; the current `crates/emu` contract has not reached that
promotion gate.

Bevy 0.19.1 uses `wgpu` 29.0.3, while 0.20.0-rc.2 is prerelease. The fork
therefore does not force Bevy to `wgpu` 30 or claim a production WebGPU 30
adapter. `main` remains an upstream-following branch; Aphrody changes stay
on the stable product branch for reviewable rebases.

## Acceptance sequence

1. Keep the pure `HeadlessSession` tests green; add synthetic input replay,
   invalid-step, virtual-clock and snapshot version tests.
2. Implement one console adapter behind the contract and boot independently
   redistributable homebrew; compare output and timing against its upstream
   reference before claiming support. Repeat separately for DS, 3DS, Wii and
   Switch; never merge different hardware models to increase code reuse.
3. Add bounded frame/audio/network ports, load tests and profiler evidence for
   allocation, latency and throughput. Add GPU and WASM adapters only after
   their independent capability tests pass.
4. Expose the same session through CLI, GUI, C ABI and browser. Test lifecycle,
   state ownership, error paths and deterministic replay through each binding.
5. Develop the public homebrew SDK in independent target adapters and the
   Bevy-derived game engine in its Aphrody fork. Promote IECODE Rust prototypes
   only after provenance, licenses, toolchain, native/browser build and
   examples pass; never make a console hot loop depend on Bevy ECS.
6. Test Steam/Proton/EAC only with an IECODE-owned or explicitly authorized
   title and publisher configuration; keep offline modding tests separate.

Sources checked on 2026-09-29: [wgpu releases](https://github.com/gfx-rs/wgpu/releases),
[Bevy releases](https://github.com/bevyengine/bevy/releases),
[Bevy 0.19.1 renderer manifest](https://github.com/bevyengine/bevy/blob/v0.19.1/crates/bevy_render/Cargo.toml),
[Steamworks API](https://partner.steamgames.com/doc/sdk/api),
[Proton anti-cheat requirements](https://partner.steamgames.com/doc/steamhardware/proton),
and [Nintendo developer process](https://developer.nintendo.com/the-process).
