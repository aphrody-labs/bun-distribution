// SPDX-License-Identifier: Apache-2.0
// WebGPU drawer for the pet atlas. The 2d mode draws one textured quad; the 3d mode stacks
// `slices` quads of the same frame along depth, rotates them about the vertical axis and shades
// each slice from the alpha gradient of the silhouette, which reads as a lit volume.
import { fitRect, type DrawOptions, type PetDrawer, type PetPose } from "./frames.ts";

const SHADER_2D = /* wgsl */ `
struct Quad {
  dst: vec4<f32>,
  uv: vec4<f32>,
  canvas: vec2<f32>,
  pad: vec2<f32>,
};

@group(0) @binding(0) var<uniform> q: Quad;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let corner = vec2<f32>(f32(vi & 1u), f32(vi >> 1u));
  let px = q.dst.xy + corner * q.dst.zw;
  let ndc = vec2<f32>(px.x / q.canvas.x * 2.0 - 1.0, 1.0 - px.y / q.canvas.y * 2.0);
  var o: VOut;
  o.pos = vec4<f32>(ndc, 0.0, 1.0);
  o.uv = mix(q.uv.xy, q.uv.zw, corner);
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4<f32> {
  let c = textureSample(atlas, samp, i.uv);
  return vec4<f32>(c.rgb * c.a, c.a);
}
`;

const SHADER_3D = /* wgsl */ `
struct Volume {
  dst: vec4<f32>,
  uv: vec4<f32>,
  canvas: vec2<f32>,
  yaw: f32,
  depth: f32,
  slices: vec4<f32>,
};

@group(0) @binding(0) var<uniform> v: Volume;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) t: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let corner = vec2<f32>(f32(vi & 1u), f32(vi >> 1u));
  let count = v.slices.x;
  let t = f32(ii) / max(count - 1.0, 1.0);
  let z = (t - 0.5) * v.depth;
  let centre = v.dst.xy + v.dst.zw * 0.5;
  let local = v.dst.xy + corner * v.dst.zw - centre;
  let cs = cos(v.yaw);
  let sn = sin(v.yaw);
  let xr = local.x * cs + z * sn;
  let zr = -local.x * sn + z * cs;
  let focal = 4.0 * max(v.dst.z, v.dst.w);
  let s = focal / (focal - zr);
  var o: VOut;
  let screen = v.canvas * 0.5 + vec2<f32>(xr, local.y) * s;
  o.pos = vec4<f32>(screen.x / v.canvas.x * 2.0 - 1.0, 1.0 - screen.y / v.canvas.y * 2.0, 0.0, 1.0);
  o.uv = mix(v.uv.xy, v.uv.zw, corner);
  o.t = t;
  return o;
}

fn alphaAt(uv: vec2<f32>) -> f32 {
  return textureSampleLevel(atlas, samp, uv, 0.0).a;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4<f32> {
  let c = textureSampleLevel(atlas, samp, i.uv, 0.0);
  if (c.a < 0.5) {
    discard;
  }
  let tx = vec2<f32>(v.slices.z, 0.0);
  let ty = vec2<f32>(0.0, v.slices.w);
  let gx = alphaAt(i.uv + tx) - alphaAt(i.uv - tx);
  let gy = alphaAt(i.uv + ty) - alphaAt(i.uv - ty);
  let n = normalize(vec3<f32>(-gx * 4.0, -gy * 4.0, 1.0));
  let light = normalize(vec3<f32>(-0.5, -0.6, 0.8));
  let lambert = max(dot(n, light), 0.0);
  let shade = (0.6 + 0.4 * lambert) * (0.8 + 0.2 * i.t);
  return vec4<f32>(c.rgb * shade, 1.0);
}
`;

const UNIFORM_2D_BYTES = 48;
const UNIFORM_3D_BYTES = 64;
const TEXTURE_BINDING = 0x04;
const TEXTURE_COPY_DST = 0x02;
const TEXTURE_RENDER_ATTACHMENT = 0x10;
const BUFFER_UNIFORM = 0x40;
const BUFFER_COPY_DST = 0x08;

export interface WebGpuEnvironment {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
}

/** Acquires a WebGPU device for `canvas`, or null when the platform has no usable adapter. */
export async function acquireWebGpu(canvas: HTMLCanvasElement): Promise<WebGpuEnvironment | null> {
  const gpu = (globalThis as { navigator?: { gpu?: GPU } }).navigator?.gpu;
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
  if (!context) {
    device.destroy();
    return null;
  }
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });
  return { device, context, format };
}

export function createWebGpuDrawer(env: WebGpuEnvironment, atlas: ImageBitmap): PetDrawer {
  const { device, context, format } = env;
  const texture = device.createTexture({
    size: [atlas.width, atlas.height],
    format: "rgba8unorm",
    usage: TEXTURE_BINDING | TEXTURE_COPY_DST | TEXTURE_RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: atlas }, { texture }, [atlas.width, atlas.height]);
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  const view = texture.createView();

  const pipelines = {
    "2d": makePipeline(device, SHADER_2D, format, "triangle-strip"),
    "3d": makePipeline(device, SHADER_3D, format, "triangle-strip"),
  };
  const uniforms = {
    "2d": device.createBuffer({ size: UNIFORM_2D_BYTES, usage: BUFFER_UNIFORM | BUFFER_COPY_DST }),
    "3d": device.createBuffer({ size: UNIFORM_3D_BYTES, usage: BUFFER_UNIFORM | BUFFER_COPY_DST }),
  };
  const bindGroups = {
    "2d": device.createBindGroup({
      layout: pipelines["2d"].getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniforms["2d"] } },
        { binding: 1, resource: view },
        { binding: 2, resource: sampler },
      ],
    }),
    "3d": device.createBindGroup({
      layout: pipelines["3d"].getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniforms["3d"] } },
        { binding: 1, resource: view },
        { binding: 2, resource: sampler },
      ],
    }),
  };
  const texel = { u: 1 / atlas.width, v: 1 / atlas.height };

  return {
    backend: "webgpu",
    draw(pose: PetPose, options: DrawOptions) {
      const width = context.canvas.width;
      const height = context.canvas.height;
      const rect = fitRect(pose.frame, width, height, Math.round(Math.min(width, height) * 0.04));
      const { u0, v0, u1, v1 } = pose.uv;
      const mode = options.mode;
      if (mode === "2d") {
        device.queue.writeBuffer(
          uniforms["2d"],
          0,
          new Float32Array([rect.x, rect.y, rect.w, rect.h, u0, v0, u1, v1, width, height, 0, 0]),
        );
      } else {
        const depth = options.depth * (rect.h / pose.frame.h);
        device.queue.writeBuffer(
          uniforms["3d"],
          0,
          new Float32Array([
            rect.x,
            rect.y,
            rect.w,
            rect.h,
            u0,
            v0,
            u1,
            v1,
            width,
            height,
            options.yaw,
            depth,
            options.slices,
            0,
            texel.u,
            texel.v,
          ]),
        );
      }
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(pipelines[mode]);
      pass.setBindGroup(0, bindGroups[mode]);
      if (mode === "2d") pass.draw(4);
      else pass.draw(4, options.slices);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    dispose() {
      texture.destroy();
      uniforms["2d"].destroy();
      uniforms["3d"].destroy();
      device.destroy();
    },
  };
}

function makePipeline(
  device: GPUDevice,
  code: string,
  format: GPUTextureFormat,
  topology: GPUPrimitiveTopology,
): GPURenderPipeline {
  const module = device.createShaderModule({ code });
  return device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology },
  });
}
