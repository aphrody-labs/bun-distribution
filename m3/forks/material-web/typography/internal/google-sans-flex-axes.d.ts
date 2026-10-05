/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @fileoverview Google Sans Flex variable-font axes, mirrored byte-for-byte
 * from the Rust source of truth (`crates/ui/m3-tokens/src/google_sans_flex.rs`),
 * itself distilled from https://design.google/library/google-sans-flex-font.
 *
 * Google Sans Flex ships six interpolation axes in a single variable TTF:
 *
 * | Tag    | Description                                | Min  | Default | Max  |
 * |--------|--------------------------------------------|------|---------|------|
 * | `wght` | Weight (CSS `font-weight`)                 |    1 |   400   | 1000 |
 * | `opsz` | Optical size (target render size, pt)      |    6 |    18   |  144 |
 * | `wdth` | Width (relative percentage)                |   25 |   100   |  151 |
 * | `GRAD` | Grade (weight nudge, line width unchanged) |    0 |     0   |  100 |
 * | `slnt` | Slant (degrees, negative = italic lean)    |  -10 |     0   |    0 |
 * | `ROND` | Roundness (terminal-shape continuum)       |    0 |     0   |  100 |
 */
/** One variable-font axis descriptor. */
export interface Axis {
    /** 4-char OpenType axis tag (case-sensitive: `wght`, `opsz`, `GRAD`, …). */
    readonly tag: string;
    /** Lower bound of the legal range. */
    readonly min: number;
    /** The font's default value for this axis. */
    readonly default: number;
    /** Upper bound of the legal range. */
    readonly max: number;
}
/** Weight axis (CSS `font-weight`). */
export declare const WGHT: Axis;
/** Optical-size axis (target render size, points). */
export declare const OPSZ: Axis;
/** Width axis (relative percentage; 100 = neutral). */
export declare const WDTH: Axis;
/** Grade axis (weight nudge that does not affect line metrics). */
export declare const GRAD: Axis;
/** Slant axis (degrees; -10 = italic lean, 0 = upright). */
export declare const SLNT: Axis;
/** Roundness axis (0 = sharp terminals, 100 = fully rounded). */
export declare const ROND: Axis;
/** All six axes in canonical declaration order. */
export declare const ALL_AXES: readonly Axis[];
/** Clamp `value` into `[axis.min, axis.max]`. */
export declare function clampAxis(axis: Axis, value: number): number;
/** Current value for each variable axis. Partial — unset axes use defaults. */
export interface AxisSettings {
    wght?: number;
    opsz?: number;
    wdth?: number;
    grad?: number;
    slnt?: number;
    rond?: number;
}
/** The font's default axis values (matches the static "Regular" cut). */
export declare const DEFAULT_AXES: Required<AxisSettings>;
/**
 * Build a CSS `font-variation-settings` value from a (partial) {@link
 * AxisSettings}. Only the axes that are provided are emitted, each clamped to
 * its legal range, so callers can override one axis (e.g. just `ROND`) without
 * pinning the others.
 *
 * @example
 * fontVariationSettings({wght: 500, opsz: 24, rond: 60});
 * // => '"wght" 500, "opsz" 24, "ROND" 60'
 */
export declare function fontVariationSettings(settings: AxisSettings): string;
