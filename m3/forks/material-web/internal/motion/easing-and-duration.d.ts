/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @fileoverview The full Material Design 3 motion system — the seven canonical
 * easing curves and the sixteen duration tokens — exposed as typed constants,
 * CSS custom-property maps, and small composable helpers.
 *
 * Values are aligned byte-for-byte with the Rust source of truth
 * (`crates/ui/m3-tokens/src/motion.rs`) so that a component animated in TypeScript
 * matches one painted by the native (mui-rs) renderer.
 *
 * Reference:
 * https://m3.material.io/styles/motion/easing-and-duration/tokens-specs
 */
/**
 * The seven M3 easing curves as CSS `cubic-bezier(...)` strings.
 *
 * Unlike the legacy {@link ./animation.js#EASING} table (kept for backwards
 * compatibility with the upstream components), `EMPHASIZED` here uses the exact
 * spec curve rather than an approximation.
 */
export declare const EASING: {
    /** Default easing for most transitions (decelerate-in). */
    readonly EMPHASIZED: "cubic-bezier(0.2, 0, 0, 1)";
    /** Elements entering the screen. */
    readonly EMPHASIZED_DECELERATE: "cubic-bezier(0.05, 0.7, 0.1, 1)";
    /** Elements leaving the screen. */
    readonly EMPHASIZED_ACCELERATE: "cubic-bezier(0.3, 0, 0.8, 0.15)";
    /** General-purpose easing for elements that stay on screen. */
    readonly STANDARD: "cubic-bezier(0.2, 0, 0, 1)";
    /** Entering/expanding element with the standard curve. */
    readonly STANDARD_DECELERATE: "cubic-bezier(0, 0, 0, 1)";
    /** Exiting/collapsing element with the standard curve. */
    readonly STANDARD_ACCELERATE: "cubic-bezier(0.3, 0, 1, 1)";
    /** Constant rate, for continuous indicators (progress, scrubbing). */
    readonly LINEAR: "cubic-bezier(0, 0, 1, 1)";
};
/** Name of an easing curve in {@link EASING}. */
export type EasingName = keyof typeof EASING;
/**
 * The sixteen M3 duration tokens, in milliseconds, ascending from `short1`
 * (50 ms) to `extraLong4` (1000 ms).
 */
export declare const DURATION: {
    readonly SHORT1: 50;
    readonly SHORT2: 100;
    readonly SHORT3: 150;
    readonly SHORT4: 200;
    readonly MEDIUM1: 250;
    readonly MEDIUM2: 300;
    readonly MEDIUM3: 350;
    readonly MEDIUM4: 400;
    readonly LONG1: 450;
    readonly LONG2: 500;
    readonly LONG3: 550;
    readonly LONG4: 600;
    readonly EXTRA_LONG1: 700;
    readonly EXTRA_LONG2: 800;
    readonly EXTRA_LONG3: 900;
    readonly EXTRA_LONG4: 1000;
};
/** Name of a duration token in {@link DURATION}. */
export type DurationName = keyof typeof DURATION;
/**
 * The `--md-sys-motion-*` custom properties as a `name: value` record, ready to
 * be serialized into a `:root` block or applied to an element's style.
 *
 * Token names follow the M3 spec (`emphasized`, `short-1`, `extra-long-4`, …)
 * so authored CSS can read `var(--md-sys-motion-easing-emphasized)` and
 * `var(--md-sys-motion-duration-medium-2)`.
 */
export declare function motionTokenVars(): Record<string, string>;
/**
 * Builds a CSS `transition` shorthand from one or more properties using an M3
 * duration and easing. Defaults to `medium2` / `standard`, the canonical
 * navigation-transition pairing.
 *
 * @example
 * // "opacity 300ms cubic-bezier(0.2, 0, 0, 1), transform 300ms cubic-bezier(0.2, 0, 0, 1)"
 * transition(['opacity', 'transform']);
 */
export declare function transition(properties: string | readonly string[], duration?: DurationName, easing?: EasingName, delayMs?: number): string;
/**
 * Honors the user's reduced-motion preference. Returns `true` when the user has
 * requested reduced motion, in which case callers should skip or shorten
 * non-essential animation. Safe to call in non-browser (SSR) contexts.
 */
export declare function prefersReducedMotion(): boolean;
/**
 * Resolves an M3 `KeyframeAnimationOptions` object for `Element.animate()`,
 * collapsing to a near-instant duration when reduced motion is requested.
 */
export declare function animationOptions(duration?: DurationName, easing?: EasingName, extra?: KeyframeAnimationOptions): KeyframeAnimationOptions;
