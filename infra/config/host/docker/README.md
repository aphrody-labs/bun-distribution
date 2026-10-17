# Docker on the VPS: containerd image store and Wasm runtime

`daemon.json` enables the containerd image store (`features.containerd-snapshotter`) and registers
the runwasi `wasmtime` shim as the `io.containerd.wasmtime.v1` runtime. The shim
(`containerd-shim-wasmtime-v1`, runwasi v0.6.1, musl build) lives in `/usr/local/bin`.

Apply without restarting running containers: `sudo systemctl reload docker`.

Status: the shim runs Wasm images through containerd
(`ctr -n moby run --runtime io.containerd.wasmtime.v1 --platform wasi/wasm <image> <id>`).
`docker run --runtime=io.containerd.wasmtime.v1 --platform=wasi/wasm` still fails with
`invalid spec for new user namespace container` on Docker 29.7.2 with runwasi 0.5.0 and 0.6.1.
