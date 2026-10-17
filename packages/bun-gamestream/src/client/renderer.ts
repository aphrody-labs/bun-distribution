/**
 * WebGPU presenter: imports each decoded frame as an external texture (zero-copy where the
 * browser allows it), upscales with FSR1 EASU to the canvas size and sharpens with RCAS.
 */
import { bilinearWgsl, easuWgsl, rcasWgsl } from "./fsr.ts";

export type UpscaleMode = "fsr" | "bilinear";
export type FrameSource = VideoFrame | HTMLVideoElement;

export class WebGpuPresenter {
  readonly adapterInfo: string;
  private readonly params: GPUBuffer;
  private readonly sampler: GPUSampler;
  private intermediate: GPUTexture | null = null;
  private rcasGroup: GPUBindGroup | null = null;
  private readonly paramData = new Float32Array(4);

  private constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    private readonly easu: GPURenderPipeline,
    private readonly rcas: GPURenderPipeline,
    private readonly bilinear: GPURenderPipeline,
    adapter: GPUAdapter,
    public mode: UpscaleMode,
    public sharpness: number,
  ) {
    const info = adapter.info;
    this.adapterInfo = [info.vendor, info.architecture, info.description]
      .filter(Boolean)
      .join(" ");
    this.params = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
  }

  static async create(
    canvas: HTMLCanvasElement,
    mode: UpscaleMode,
    sharpness: number,
  ): Promise<WebGpuPresenter> {
    if (!("gpu" in navigator)) throw new Error("WebGPU unavailable");
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) throw new Error("no WebGPU adapter");
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("no WebGPU canvas context");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    const pipeline = (code: string, target: GPUTextureFormat) => {
      const module = device.createShaderModule({ code });
      return device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: target }] },
        primitive: { topology: "triangle-list" },
      });
    };
    return new WebGpuPresenter(
      device,
      context,
      format,
      pipeline(easuWgsl, "rgba8unorm"),
      pipeline(rcasWgsl, format),
      pipeline(bilinearWgsl, format),
      adapter,
      mode,
      sharpness,
    );
  }

  private ensureIntermediate(width: number, height: number): GPUTexture {
    const current = this.intermediate;
    if (current && current.width === width && current.height === height)
      return current;
    current?.destroy();
    const texture = this.device.createTexture({
      size: { width, height },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.intermediate = texture;
    this.rcasGroup = this.device.createBindGroup({
      layout: this.rcas.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: { buffer: this.params } },
      ],
    });
    return texture;
  }

  /** Draws one frame; the caller keeps ownership of VideoFrame sources and closes them after. */
  draw(source: FrameSource): void {
    const canvas = this.context.canvas as HTMLCanvasElement;
    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return;
    const external = this.device.importExternalTexture({ source });
    const encoder = this.device.createCommandEncoder();
    const target = this.context.getCurrentTexture().createView();

    if (this.mode === "bilinear") {
      const group = this.device.createBindGroup({
        layout: this.bilinear.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: external },
          { binding: 2, resource: this.sampler },
        ],
      });
      this.pass(encoder, target, this.bilinear, group);
    } else {
      this.paramData.set([width, height, this.sharpness, 0]);
      this.device.queue.writeBuffer(this.params, 0, this.paramData);
      const intermediate = this.ensureIntermediate(width, height);
      const easuGroup = this.device.createBindGroup({
        layout: this.easu.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: external },
          { binding: 1, resource: { buffer: this.params } },
        ],
      });
      this.pass(encoder, intermediate.createView(), this.easu, easuGroup);
      this.pass(encoder, target, this.rcas, this.rcasGroup as GPUBindGroup);
    }
    this.device.queue.submit([encoder.finish()]);
  }

  private pass(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    pipeline: GPURenderPipeline,
    group: GPUBindGroup,
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
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  }

  /** GPU cost of one presentation (import + EASU + RCAS), averaged over `iterations` draws. */
  async benchmark(source: FrameSource, iterations = 120): Promise<number> {
    await this.device.queue.onSubmittedWorkDone();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) this.draw(source);
    await this.device.queue.onSubmittedWorkDone();
    return (performance.now() - start) / iterations;
  }

  get canvasFormat(): GPUTextureFormat {
    return this.format;
  }
}
