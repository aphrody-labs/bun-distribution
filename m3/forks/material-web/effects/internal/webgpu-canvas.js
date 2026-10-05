/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, isServer, LitElement } from "lit";
import { property, query, state } from "lit/decorators.js";
import { configureBrowserCanvas } from "@aphrody/canvas/site";
import { EFFECT_WGSL } from "./shaders.js";
import { BUFFER_USAGE_COPY_DST, BUFFER_USAGE_UNIFORM, getGPU, getWebGPUContext, } from "./webgpu-types.js";
/** Default Gemini brand stops (blue → purple → pink), as RGBA floats. */
const DEFAULT_COLORS = [
    [0.259, 0.522, 0.957], // #4285F4
    [0.569, 0.408, 0.753], // #9168C0
    [0.925, 0.282, 0.6], // #EC4899
];
/** Parse a `#rrggbb` string to an RGB float triple, or null on failure. */
function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) {
        return null;
    }
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/**
 * Renders an animated Material/Gemini brand effect on a WebGPU canvas, with a
 * CSS-gradient fallback when WebGPU is unavailable. Reproduces the design.google
 * motion language: the spectrum-shift flow, the four-color sparkle, and the
 * transparent-surface glimmer.
 *
 * Honors `prefers-reduced-motion` by painting a single static frame.
 */
export class WebGpuCanvas extends LitElement {
    constructor() {
        super(...arguments);
        /** Which brand effect to render. */
        this.effect = "spectrum";
        /** Overall brightness/opacity multiplier (0–1). */
        this.intensity = 1;
        /**
         * Optional comma-separated list of up to three `#rrggbb` brand stops,
         * overriding the default Gemini blue/purple/pink.
         */
        this.colors = "";
        /** True once running on the GPU; false means the CSS fallback is showing. */
        this.usingGpu = false;
        this.device = null;
        this.context = null;
        this.pipeline = null;
        this.bindGroup = null;
        this.uniformBuffer = null;
        this.uniformData = new Float32Array(16);
        this.format = "bgra8unorm";
        this.rafId = 0;
        this.startTime = 0;
        this.resizeObserver = null;
        this.disposed = false;
        this.loop = () => {
            this.renderFrame();
            if (!this.reducedMotion && !this.disposed) {
                this.rafId = requestAnimationFrame(this.loop);
            }
        };
    }
    firstUpdated() {
        if (!isServer) {
            if (this.canvas)
                configureBrowserCanvas(this.canvas, { width: 1, height: 1 });
            void this.init();
        }
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.teardown();
    }
    updated(changed) {
        if (changed.has("effect") && this.device) {
            // Effect changed: rebuild the pipeline for the new shader.
            void this.buildPipeline();
        }
    }
    get reducedMotion() {
        return (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    parseColors() {
        if (!this.colors) {
            return DEFAULT_COLORS;
        }
        const parsed = this.colors
            .split(",")
            .map((c) => hexToRgb(c))
            .filter((c) => c !== null);
        const out = [];
        for (let i = 0; i < 3; i++) {
            out.push(parsed[i] ?? DEFAULT_COLORS[i]);
        }
        return out;
    }
    async init() {
        const gpu = getGPU();
        const canvas = this.canvas;
        if (!gpu || !canvas) {
            this.usingGpu = false;
            return;
        }
        try {
            const adapter = await gpu.requestAdapter();
            if (!adapter || this.disposed) {
                this.usingGpu = false;
                return;
            }
            this.device = await adapter.requestDevice();
            this.context = getWebGPUContext(canvas);
            if (!this.context || this.disposed) {
                this.usingGpu = false;
                return;
            }
            this.format = gpu.getPreferredCanvasFormat();
            this.context.configure({
                device: this.device,
                format: this.format,
                alphaMode: "premultiplied",
            });
            this.uniformBuffer = this.device.createBuffer({
                size: this.uniformData.byteLength,
                usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
            });
            await this.buildPipeline();
            this.usingGpu = true;
            this.resize();
            this.observeResize();
            this.startTime = performance.now();
            this.loop();
        }
        catch {
            // Adapter/device acquisition failed: stay on the CSS fallback.
            this.usingGpu = false;
            this.teardown();
        }
    }
    async buildPipeline() {
        if (!this.device) {
            return;
        }
        const module = this.device.createShaderModule({
            code: EFFECT_WGSL[this.effect],
        });
        const blend = {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        };
        this.pipeline = this.device.createRenderPipeline({
            layout: "auto",
            vertex: { module, entryPoint: "vs" },
            fragment: {
                module,
                entryPoint: "fs",
                targets: [{ format: this.format, blend }],
            },
            primitive: { topology: "triangle-list" },
        });
        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
        });
    }
    observeResize() {
        if (typeof ResizeObserver === "undefined" || !this.canvas) {
            return;
        }
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.canvas);
    }
    resize() {
        const canvas = this.canvas;
        if (!canvas) {
            return;
        }
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
    }
    renderFrame() {
        const { device, context, pipeline, bindGroup, uniformBuffer, canvas } = this;
        if (!device || !context || !pipeline || !bindGroup || !uniformBuffer || !canvas) {
            return;
        }
        const time = this.reducedMotion ? 0 : (performance.now() - this.startTime) / 1000;
        const [a, b, c] = this.parseColors();
        const d = this.uniformData;
        d[0] = canvas.width;
        d[1] = canvas.height;
        d[2] = time;
        d[3] = Math.max(0, Math.min(1, this.intensity));
        d[4] = a[0];
        d[5] = a[1];
        d[6] = a[2];
        d[7] = 1;
        d[8] = b[0];
        d[9] = b[1];
        d[10] = b[2];
        d[11] = 1;
        d[12] = c[0];
        d[13] = c[1];
        d[14] = c[2];
        d[15] = 1;
        device.queue.writeBuffer(uniformBuffer, 0, d);
        const encoder = device.createCommandEncoder();
        const view = context.getCurrentTexture().createView();
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view,
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
    }
    teardown() {
        this.disposed = true;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.uniformBuffer?.destroy();
        this.uniformBuffer = null;
        this.device?.destroy();
        this.device = null;
        this.context = null;
        this.pipeline = null;
        this.bindGroup = null;
    }
    render() {
        return html `
      <canvas
        part="canvas"
        aria-hidden="true"
        class=${this.usingGpu ? "gpu" : "fallback"}
        data-effect=${this.effect}
      ></canvas>
    `;
    }
}
__decorate([
    property()
], WebGpuCanvas.prototype, "effect", void 0);
__decorate([
    property({ type: Number })
], WebGpuCanvas.prototype, "intensity", void 0);
__decorate([
    property()
], WebGpuCanvas.prototype, "colors", void 0);
__decorate([
    state()
], WebGpuCanvas.prototype, "usingGpu", void 0);
__decorate([
    query("canvas")
], WebGpuCanvas.prototype, "canvas", void 0);
//# sourceMappingURL=webgpu-canvas.js.map