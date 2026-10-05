/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Material 3 popover styles. The `.surface` is a top-layer popover with an M3
 * elevation-level-3 surface, large corner shape, and a fade/scale in-out
 * animation via `@starting-style` + `transition-behavior: allow-discrete`.
 *
 * Positioning has two paths:
 * - When CSS Anchor Positioning is supported, the `@supports` block binds the
 *   surface to the anchor's `anchor-name` via `position-area`, switching by the
 *   reflected `placement` attribute. The host exposes `--md-popover-anchor` for
 *   the consumer to set the `anchor-name` on the trigger.
 * - Otherwise the JS fallback in the element sets `position: fixed` + top/left.
 *
 * Per-instance overrides via `--md-popover-*`.
 */
export declare const styles: import("lit").CSSResult;
