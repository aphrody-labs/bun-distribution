/// <reference types="@webgpu/types" />
// WebGPU presenter for libretroarch frames: uploads a frame only when its serial changes and
// draws it letterboxed with a fullscreen triangle. XRGB8888 is already bgra8unorm bytes; RGB565
// and the menu's RGBA4444 go up as r16uint and are unpacked in WGSL.
import type { Frame, PixelFormat } from "./libretroarch";

// PixelFormat values, kept here so a browser bundle never pulls in bun:ffi.
const XRGB8888 = 0 as PixelFormat;
const RGB565 = 1 as PixelFormat;

export type PresentableFrame = Omit<Frame, "data"> & { data: ArrayBufferView };

/** Interleaved stereo float samples at `rate`, as {@link RetroArch.audio} returns them. */
export type RetroArchAudioSink = (samples: Float32Array, rate: number) => void;

const VERTEX = /* wgsl */ `
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return Out(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}
`;

const RGBA = /* wgsl */ `${VERTEX}
@group(0) @binding(0) var frame: texture_2d<f32>;
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(frame));
  let texel = vec2u(min(in.uv * size, size - 1.0));
  return vec4f(textureLoad(frame, texel, 0).rgb, 1.0);
}
`;

const PACKED = /* wgsl */ `${VERTEX}
@group(0) @binding(0) var frame: texture_2d<u32>;
@group(0) @binding(1) var<uniform> format: u32;
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(frame));
  let p = textureLoad(frame, vec2u(min(in.uv * size, size - 1.0)), 0).r;
  if (format == ${RGB565}u) {
    return vec4f(f32(p >> 11u) / 31.0, f32((p >> 5u) & 63u) / 63.0, f32(p & 31u) / 31.0, 1.0);
  }
  // RGBA4444: the menu is drawn opaque.
  return vec4f(f32(p >> 12u) / 15.0, f32((p >> 8u) & 15u) / 15.0, f32((p >> 4u) & 15u) / 15.0, 1.0);
}
`;

export class RetroArchPresenter {
  #texture: GPUTexture | undefined;
  #group: GPUBindGroup | undefined;
  #format = XRGB8888;
  #serial = -1n;
  #uniform: GPUBuffer;
  #rgba: GPURenderPipeline;
  #packed: GPURenderPipeline;

  constructor(
    readonly device: GPUDevice,
    readonly target: GPUTextureFormat,
  ) {
    const pipeline = (code: string) => {
      const module = device.createShaderModule({ code });
      return device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: target }] },
        primitive: { topology: "triangle-list" },
      });
    };
    this.#rgba = pipeline(RGBA);
    this.#packed = pipeline(PACKED);
    this.#uniform = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  get width(): number {
    return this.#texture?.width ?? 0;
  }

  get height(): number {
    return this.#texture?.height ?? 0;
  }

  /** Uploads the frame unless its serial was already uploaded. */
  upload(frame: PresentableFrame): boolean {
    if (frame.serial === this.#serial) return false;
    const { width, height, pitch, format } = frame;
    const texture = this.#texture;
    if (
      !texture ||
      texture.width !== width ||
      texture.height !== height ||
      format !== this.#format
    ) {
      texture?.destroy();
      const packed = format !== XRGB8888;
      this.#texture = this.device.createTexture({
        size: { width, height },
        format: packed ? "r16uint" : "bgra8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.#format = format;
      if (packed)
        this.device.queue.writeBuffer(
          this.#uniform,
          0,
          new Uint32Array([format, 0, 0, 0]),
        );
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: this.#texture.createView() },
      ];
      if (packed)
        entries.push({ binding: 1, resource: { buffer: this.#uniform } });
      this.#group = this.device.createBindGroup({
        layout: (packed ? this.#packed : this.#rgba).getBindGroupLayout(0),
        entries,
      });
    }
    const { data } = frame;
    this.device.queue.writeTexture(
      { texture: this.#texture! },
      data.buffer,
      { offset: data.byteOffset, bytesPerRow: pitch, rowsPerImage: height },
      { width, height },
    );
    this.#serial = frame.serial;
    return true;
  }

  /** Draws the last uploaded frame into `view`, letterboxed to keep the frame's aspect. */
  draw(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    width: number,
    height: number,
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    const texture = this.#texture;
    if (texture && this.#group && width && height) {
      const scale = Math.min(width / texture.width, height / texture.height);
      const w = Math.max(1, Math.round(texture.width * scale));
      const h = Math.max(1, Math.round(texture.height * scale));
      pass.setViewport((width - w) >> 1, (height - h) >> 1, w, h, 0, 1);
      pass.setPipeline(this.#format === XRGB8888 ? this.#rgba : this.#packed);
      pass.setBindGroup(0, this.#group);
      pass.draw(3);
    }
    pass.end();
  }

  /** Uploads if new and presents to a canvas context configured with {@link target}. */
  present(context: GPUCanvasContext, frame?: PresentableFrame): void {
    if (frame) this.upload(frame);
    const current = context.getCurrentTexture();
    const encoder = this.device.createCommandEncoder();
    this.draw(encoder, current.createView(), current.width, current.height);
    this.device.queue.submit([encoder.finish()]);
  }

  /** Renders the last frame offscreen and reads it back as RGBA8 (`target` is rgba8 or bgra8). */
  async capture(width: number, height: number): Promise<Uint8Array> {
    const texture = this.device.createTexture({
      size: { width, height },
      format: this.target,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = this.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    this.draw(encoder, texture.createView(), width, height);
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow },
      { width, height },
    );
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      out.set(
        mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4),
        y * width * 4,
      );
    buffer.unmap();
    buffer.destroy();
    if (this.target.startsWith("bgra8"))
      for (let i = 0; i < out.length; i += 4) {
        const b = out[i]!;
        out[i] = out[i + 2]!;
        out[i + 2] = b;
      }
    texture.destroy();
    return out;
  }

  destroy(): void {
    this.#texture?.destroy();
    this.#uniform.destroy();
  }
}

// Wire format between libretroarch-serve and its page.
export const Message = { Frame: 1, Audio: 2 } as const;

/** Frame: u8 kind, u8 format, u16 0, u32 width, height, pitch, u64 serial, then the pixels. */
export const FRAME_HEADER = 24;
/** Audio: u8 kind, 3 bytes 0, u32 rate, then interleaved float stereo. */
export const AUDIO_HEADER = 8;

export function decodeFrame(message: ArrayBuffer): PresentableFrame {
  const view = new DataView(message);
  const height = view.getUint32(8, true);
  const pitch = view.getUint32(12, true);
  return {
    format: view.getUint8(1) as PixelFormat,
    width: view.getUint32(4, true),
    height,
    pitch,
    serial: view.getBigUint64(16, true),
    data: new Uint8Array(message, FRAME_HEADER, pitch * height),
  };
}
