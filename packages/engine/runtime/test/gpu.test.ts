// SPDX-License-Identifier: Apache-2.0
// Runs against a GPU-enabled artifact: YOLO_RUNTIME_LIB=<path>/libaphrody_ffi.so built with
// `cargo build -p aphrody-ffi --profile runtime --features gpu` (or `cuda`). Skipped otherwise.
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { GpuRuntime } from "../src/gpu";

const library = process.env["YOLO_RUNTIME_LIB"];
const available = library !== undefined && existsSync(library);

const DOUBLE = `
@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < arrayLength(&data)) { data[id.x] = data[id.x] * 2u + 1u; }
}`;

describe.skipIf(!available)("GPU runtime (ABI 1.5)", () => {
  it("reports the process device and runs WGSL on it", async () => {
    using gpu = GpuRuntime.load({ libraryPath: library });
    const info = await gpu.info();
    expect(Array.isArray(info.adapters)).toBe(true);
    if (info.selected === null) return;
    const input = Uint32Array.from({ length: 256 }, (_, i) => i);
    const { data } = await gpu.wgsl({ shader: DOUBLE, workgroups: [4, 1, 1], data: input });
    const output = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    expect([...output]).toEqual([...input].map((v) => v * 2 + 1));
  });

  it("turns GPU errors into rejections without breaking the device", async () => {
    using gpu = GpuRuntime.load({ libraryPath: library });
    if ((await gpu.info()).selected === null) return;
    await expect(
      gpu.wgsl({ shader: "broken", workgroups: [1, 1, 1], data: new Uint32Array(1) }),
    ).rejects.toThrow();
    const { data } = await gpu.wgsl({
      shader: DOUBLE,
      workgroups: [1, 1, 1],
      data: new Uint32Array([1]),
    });
    expect(new Uint32Array(data.buffer, data.byteOffset, 1)[0]).toBe(3);
  });

  it("reports CUDA through the official driver when the artifact has it", async () => {
    using gpu = GpuRuntime.load({ libraryPath: library });
    const { cuda } = await gpu.info();
    if (!gpu.hasCuda) {
      expect(cuda).toBeNull();
      return;
    }
    expect(cuda).not.toBeNull();
    if (cuda?.devices.length === 0) return;
    const { data } = await gpu.cuda({
      source: `extern "C" __global__ void twice(float *d, unsigned int n) {
        unsigned int i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) d[i] *= 2.0f; }`,
      kernel: "twice",
      data: new Float32Array([1, 2, 3.5]),
    });
    expect([...data]).toEqual([2, 4, 7]);
  });
});
