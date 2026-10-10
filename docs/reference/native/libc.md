<!-- SPDX-License-Identifier: Apache-2.0 -->
# C library choice

`aphrody-native` does not implement a C standard library. Its former `aphrody_libc`
provided a few wrappers around the host runtime and was removed because it was
neither a complete libc nor used by an application consumer. C and C++ code should
link the platform's supported C runtime.

For Rust applications, use [`std`](https://doc.rust-lang.org/std/) for portable
filesystem, memory, time and threading operations. The Rust
[`libc`](https://github.com/rust-lang/libc) crate supplies raw declarations for
the host's C library; it does not implement that library. Use
[`rustix`](https://github.com/bytecodealliance/rustix) when safe Unix-style
system interfaces are needed, and [`windows-sys`](https://github.com/microsoft/windows-rs)
for Windows APIs.

[`relibc`](https://github.com/redox-os/relibc) is an actual C standard library
written in Rust. Its upstream currently supports Redox and Linux and describes
it as under heavy development. Replacing a process's C runtime is a target and
toolchain decision, not an ordinary Cargo dependency. It cannot replace the
Windows runtime used by this workspace.
