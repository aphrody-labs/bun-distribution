<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Native

Rust host probes used by Aphrody applications. The crate has no sibling
dependencies and is built with the pinned toolchain.

| Path | Role |
| --- | --- |
| `crates/native/native` | CPU, memory, CUDA and monotonic clock probes |
| `docs/reference/native/libc.md` | Host C runtime and Rust libc choices |

`NativePlatform` reads CPU and memory information from the host operating system.
Its CUDA probe loads the driver at runtime, so the crate also runs without CUDA.
`NativeLibc` remains a compatibility alias for existing consumers; it has never
been a complete libc.

## Inference ownership

Llama inference belongs to
[`aphrody-llama-server`](https://github.com/aphrody-labs/aphrody/blob/main/crates/ai/llama-server/src/lib.rs),
which drives upstream [`llama-server`](https://github.com/ggml-org/llama.cpp/tree/master/tools/server).
Whisper transcription belongs to
[`aphrody-voice`](https://github.com/aphrody-labs/aphrody/blob/main/crates/ai/voice/src/stt/local_whisper.rs): it drives upstream
[`whisper.cpp`](https://github.com/ggml-org/whisper.cpp) by default and can use
[`whisper-rs`](https://docs.rs/whisper-rs/latest/whisper_rs/) in process.
The official [OpenAI Whisper](https://github.com/openai/whisper) repository is the
Python/PyTorch reference implementation.

## Build and documentation

`just ci` runs the Rust checks. The exact gates are in [AGENTS.md](../../reference/native/AGENTS.md).
See [Rust API](../../../crates/native/native/README.md) and
[C library choice](../../reference/native/libc.md).

Apache-2.0.
