/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
import { EffectName } from "./shaders.js";
/**
 * Renders an animated Material/Gemini brand effect on a WebGPU canvas, with a
 * CSS-gradient fallback when WebGPU is unavailable. Reproduces the design.google
 * motion language: the spectrum-shift flow, the four-color sparkle, and the
 * transparent-surface glimmer.
 *
 * Honors `prefers-reduced-motion` by painting a single static frame.
 */
export declare class WebGpuCanvas extends LitElement {
    /** Which brand effect to render. */
    effect: EffectName;
    /** Overall brightness/opacity multiplier (0–1). */
    intensity: number;
    /**
     * Optional comma-separated list of up to three `#rrggbb` brand stops,
     * overriding the default Gemini blue/purple/pink.
     */
    colors: string;
    /** True once running on the GPU; false means the CSS fallback is showing. */
    private usingGpu;
    private readonly canvas;
    private device;
    private context;
    private pipeline;
    private bindGroup;
    private uniformBuffer;
    private uniformData;
    private format;
    private rafId;
    private startTime;
    private resizeObserver;
    private disposed;
    firstUpdated(): void;
    disconnectedCallback(): void;
    protected updated(changed: Map<string, unknown>): void;
    private get reducedMotion();
    private parseColors;
    private init;
    private buildPipeline;
    private observeResize;
    private resize;
    private loop;
    private renderFrame;
    private teardown;
    protected render(): import("lit-html").TemplateResult<1>;
}
