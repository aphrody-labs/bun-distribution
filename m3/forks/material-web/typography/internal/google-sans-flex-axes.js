/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/** Weight axis (CSS `font-weight`). */
export const WGHT = { tag: "wght", min: 1, default: 400, max: 1000 };
/** Optical-size axis (target render size, points). */
export const OPSZ = { tag: "opsz", min: 6, default: 18, max: 144 };
/** Width axis (relative percentage; 100 = neutral). */
export const WDTH = { tag: "wdth", min: 25, default: 100, max: 151 };
/** Grade axis (weight nudge that does not affect line metrics). */
export const GRAD = { tag: "GRAD", min: 0, default: 0, max: 100 };
/** Slant axis (degrees; -10 = italic lean, 0 = upright). */
export const SLNT = { tag: "slnt", min: -10, default: 0, max: 0 };
/** Roundness axis (0 = sharp terminals, 100 = fully rounded). */
export const ROND = { tag: "ROND", min: 0, default: 0, max: 100 };
/** All six axes in canonical declaration order. */
export const ALL_AXES = [WGHT, OPSZ, WDTH, GRAD, SLNT, ROND];
/** Clamp `value` into `[axis.min, axis.max]`. */
export function clampAxis(axis, value) {
    if (value < axis.min) {
        return axis.min;
    }
    if (value > axis.max) {
        return axis.max;
    }
    return value;
}
/** The font's default axis values (matches the static "Regular" cut). */
export const DEFAULT_AXES = {
    wght: 400,
    opsz: 18,
    wdth: 100,
    grad: 0,
    slnt: 0,
    rond: 0,
};
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
export function fontVariationSettings(settings) {
    const parts = [];
    const push = (axis, value) => {
        if (value !== undefined && !Number.isNaN(value)) {
            parts.push(`"${axis.tag}" ${clampAxis(axis, value)}`);
        }
    };
    push(WGHT, settings.wght);
    push(OPSZ, settings.opsz);
    push(WDTH, settings.wdth);
    push(GRAD, settings.grad);
    push(SLNT, settings.slnt);
    push(ROND, settings.rond);
    return parts.join(", ");
}
//# sourceMappingURL=google-sans-flex-axes.js.map