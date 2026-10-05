/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/** Spectrum-shift: flowing blue→purple→pink aurora bands. */
export declare const SPECTRUM_WGSL: string;
/** Sparkle: four-color radial twinkle echoing the Google dots. */
export declare const SPARKLE_WGSL: string;
/** Glimmer: faint moving sheen for dark/transparent surfaces. */
export declare const GLIMMER_WGSL: string;
/** Available fragment effects. */
export declare const EFFECT_WGSL: {
    readonly spectrum: string;
    readonly sparkle: string;
    readonly glimmer: string;
};
/** Name of a WebGPU brand effect. */
export type EffectName = keyof typeof EFFECT_WGSL;
