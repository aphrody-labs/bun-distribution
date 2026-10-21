# Browser qualification fixture

This fixture is intended to be copied to the `qualification/` directory beside the staged `pkg/`, `adapter.js`, and `webx/` artifacts. Compile its real shader inputs on the VPS with:

```sh
glslc --target-env=vulkan1.1 -o triangle.vert.spv triangle.vert
glslc --target-env=vulkan1.1 -o triangle.frag.spv triangle.frag
```

Start the receipt collector on the VPS from the Bun OS checkout:

```sh
bun packages/bun-engine/webgpu/qualification/receipt-server.ts
```

Forward the VPS collector's loopback port 4540 to an available client port, for example 14540. Then open `http://127.0.0.1:4538/_qualification/vkwebgpu/bfaa08e234/qualification/index.html?receipt=http%3A%2F%2F127.0.0.1%3A14540%2Freceipt` in Chrome. These ports belong to the existing qualification host, not the public product. The HTML imports the staged pinned WebX plugin and actual Naga WASM binding through `../webx/harness/vkwebgpu-plugin.mjs`, `../pkg/gpu.js`, and `../adapter.js`. It rejects dispatch, translation, module-compilation, validation-scope, queue, readback, and receipt errors. The receipt server must accept the POST for a run to qualify.

The fixture requests `loadPlugin({shaderTranslator, capturePresentedFrames: true})`. This optional mode adds `COPY_SRC` to the presentation texture and copies its actual GPU pixels to a padded readback buffer in the presentation command encoder. `await plugin.readbackPresentedFrame()` returns `{width, height, data}` with packed RGBA bytes, then unmaps and destroys the buffer. Normal operation leaves capture disabled and allocates no readback buffer. Do not use a delayed canvas bitmap as evidence: browsers may discard the presented backing texture before capture.

Chrome qualification passed on 2026-10-21 at 00:13:57 UTC: a 128×128 frame had center RGBA `[255,0,0,255]`, background `[0,0,0,255]`, and no uncaptured WebGPU errors. The real Naga WASM SHA256 was `d1433557ebd58176855b6bff0f40de9c4aa7cd120668110a3570fc2c5987ec48`; the receipt also records both compiled SPIR-V hashes. The Rust ICD producer patch applies to its pinned source but still requires its own build and guest transport qualification.

The success receipt is scoped to this real vertex/fragment triangle path and pixel-readback assertion. It does not establish general Vulkan conformance or DXVK compatibility. See the adjacent `../README.md` for the explicitly supported baseline and unsupported features.
