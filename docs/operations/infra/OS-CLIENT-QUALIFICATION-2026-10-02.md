<!-- SPDX-License-Identifier: Apache-2.0 -->
# OS client qualification — 2026-10-02

The `@aphrody/os` kernel client and `@aphrody/winclean` now declare build and
lint commands in addition to their existing typecheck and test commands. All
eight package gates exited 0. The [machine reports](os-client-2026-10-02/)
record each command, duration, exit code, and SHA256 hash of its adjacent full
log. Their hashes were verified after capture.

The kernel client test used `target/debug/aphrody-kernel` built from this
checkout with `scripts/build/rust/cargo-serial.sh build -p aphrody-kernel --bin
aphrody-kernel --locked`. Its [build report](os-client-2026-10-02/kernel-rust-build.json)
records the build log and binary hashes. The client passed four tests and 18
assertions, including subsystem registration and a call through the running
kernel. The WinClean package passed two catalog and facade tests with three
assertions. Its Windows runtime behavior was not exercised on this Linux host.

The regenerated pipeline matches the manifest catalog exactly: 17 stages and
235 steps, with `product-shenron-final` last. Its remaining OS gap is
`packages/os/drive-client`, which lacks lint and build gates. Across the full
monorepo, 72 packages still lack at least one catalog gate. These OS client
results do not qualify the whole OS or monorepo pipeline.
