# GPU ownership

`crates/wgpu` is the central portable graphics implementation. Bun Engine enables
its D3D12 backend, static DXC, WGSL, SPIR-V and GLSL inputs for the unified
`render` feature. `crates/bevy` consumes that owner; it does not carry another
wgpu copy. `crates/winit` owns the platform window/event boundary.

Pinned source owners:

- `src/gpu/directx/headers`: DirectX ABI headers.
- `src/gpu/directx/compiler`: DXC/HLSL compiler.
- `src/gpu/directx/samples`: executable D3D12 reference code.
- `src/drivers/nvidia-open`: CachyOS fork of NVIDIA's open Linux kernel modules.
- `src/gpu/cuda/cccl`: CUDA C++ core libraries.
- `src/gpu/cuda/samples`: CUDA runtime and driver API examples.
- `crates/bun-runtime`: Bun GPU, Buv, PyJS, Python/PyCUDA and FFI owners.

The default kernel links none of these. `editor` activates Bevy ECS, wgpu and
winit. CUDA and kernel modules remain target/hardware-qualified extensions.
