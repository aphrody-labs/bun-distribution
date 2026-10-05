/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @fileoverview Minimal WebGPU type surface — only the members used by
 * `<md-webgpu-canvas>`. Avoids a hard dependency on `@webgpu/types` while
 * keeping the rendering code typed. Complex descriptor objects are accepted as
 * `unknown` since their shape is validated by the browser at runtime.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Buffer usage bit flags (from the WebGPU spec). */
export const BUFFER_USAGE_UNIFORM = 0x40;
/** Allows `queue.writeBuffer` into the buffer. */
export const BUFFER_USAGE_COPY_DST = 0x08;
/** Read `navigator.gpu` in a typed way, returning `undefined` when absent. */
export function getGPU() {
    if (typeof navigator === "undefined") {
        return undefined;
    }
    return navigator.gpu;
}
/** Get the WebGPU canvas context, or `null` if unsupported. */
export function getWebGPUContext(canvas) {
    return canvas.getContext("webgpu");
}
//# sourceMappingURL=webgpu-types.js.map