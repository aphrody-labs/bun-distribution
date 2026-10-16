// SPDX-License-Identifier: Apache-2.0

import { toArrayBuffer } from "bun:ffi";
import { nativeSymbols as renderLib } from "./library";
import type { Render3dPolicy, Scene, Scene3d } from "./scene-types";

export type * from "./scene-types";

const render3dPolicies: Record<Render3dPolicy, number> = {
  cpu: 0,
  auto: 1,
  gpu: 2,
};

/**
 * Render an M3 [`Scene`] (see `crates/aphrody-render/src/scene.rs`) to a
 * PNG-encoded RGBA8 image using
 * the deterministic CPU rasterizer (`aphrody_render::raster`). This is the
 * pixel-perfect reference used for M3 component snapshots; it never touches
 * a GPU and always produces the same bytes for the same scene.
 *
 * @throws if the scene is rejected (malformed geometry, PNG encoding failure).
 */
export function m3Render(scene: Scene): Uint8Array {
  const json = Buffer.from(JSON.stringify(scene));
  const outLen = new BigUint64Array(1);
  const ptr = renderLib.bun_rs_render_png(json, json.length, outLen);
  if (!ptr) {
    throw new Error(
      "m3Render: bun_rs_render_png returned a null buffer (invalid scene)",
    );
  }
  const len = Number(outLen[0]);
  try {
    // Copy out of the native buffer (`toArrayBuffer` views it in place)
    // before freeing it below.
    return new Uint8Array(toArrayBuffer(ptr, 0, len).slice(0));
  } finally {
    renderLib.bun_rs_render_free(ptr, len);
  }
}

/**
 * Render an M3 3D {@link Scene3d} (see `crates/aphrody-render/src/scene3d.rs`)
 * to a PNG-encoded RGBA8 image through `aphrody_render::pipeline3d::Pipeline3d`.
 *
 * - `"cpu"` (default): the deterministic 4x-MSAA CPU rasterizer, bit-exact
 *   for a given scene — use it for snapshots.
 * - `"auto"`: the persistent GPU renderer when the native library was built
 *   with `--features gpu` and an adapter exists, CPU otherwise.
 * - `"gpu"`: GPU or failure.
 *
 * The native side keeps one pipeline per policy alive across calls, so GPU
 * devices, pipelines and mesh buffers are reused between frames.
 *
 * @throws if the scene is invalid or the GPU policy cannot be satisfied.
 */
export function m3Render3d(
  scene: Scene3d,
  policy: Render3dPolicy = "cpu",
): Uint8Array {
  const json = Buffer.from(JSON.stringify(scene));
  const outLen = new BigUint64Array(1);
  const ptr = renderLib.bun_rs_render3d_png(
    json,
    json.length,
    render3dPolicies[policy],
    outLen,
  );
  if (!ptr) {
    throw new Error(
      `m3Render3d: bun_rs_render3d_png returned a null buffer (invalid scene or unavailable "${policy}" backend)`,
    );
  }
  const len = Number(outLen[0]);
  try {
    return new Uint8Array(toArrayBuffer(ptr, 0, len).slice(0));
  } finally {
    renderLib.bun_rs_render_free(ptr, len);
  }
}
