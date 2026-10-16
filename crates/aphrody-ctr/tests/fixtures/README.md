# libctru differential fixtures

The function bodies are exact excerpts from devkitPro/libctru revision
36fe1ada5b7ebe53ba4decda36d764a55f8fefb6. They are test reference inputs, not another SDK or build entry point.
The zlib notice is preserved in LICENSE.libctru. Only the separate Rust test
harness supplies host types, constants, compilation and binary stdout setup.

- libctru-gpu-commands.c: gpu.c from u32* gpuCmdBuf through GPUCMD_Split.
  SHA-256: 0b88ee74be3e78de609cfdb6240189d516fe3d93b121c104290b4666be2a0561
- libctru-shader-outmap.c: shbin.c DVLE_GenerateOutmap.
  SHA-256: 3eab32ba354a23a96fa8015fa5fde97e2c27eb807e5e63e5729380a567a63d73

Sources:
https://github.com/devkitPro/libctru/blob/36fe1ada5b7ebe53ba4decda36d764a55f8fefb6/libctru/source/gpu/gpu.c
https://github.com/devkitPro/libctru/blob/36fe1ada5b7ebe53ba4decda36d764a55f8fefb6/libctru/source/gpu/shbin.c
