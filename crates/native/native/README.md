<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-native

Host hardware and monotonic clock probes for Rust applications.

`NativePlatform::get_topology()` reports logical CPUs available to the process,
physical and available memory, AVX2 support, CUDA device count and VRAM. CPU and
memory are read from the operating system. CUDA is read from the driver when
available. Unavailable measurements are `0` or `false`.

`NativeLibc` is a compatibility alias for `NativePlatform`; it is not a C
standard library. Rust applications should use the platform's C runtime via
[`libc`](https://docs.rs/libc/latest/libc/) when raw C APIs are required.

## Example

```rust
use aphrody_native::NativePlatform;

let topology = NativePlatform::get_topology();
assert!(topology.cpu_count >= 1);
println!("{}", NativePlatform::status());
```

## Platform support

Topology probing is implemented for Windows and Linux. Other targets build and
report `0` or `false` for values they cannot read.

## License

Apache-2.0.
