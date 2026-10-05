/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Material 3 adaptive scaffold styles. Consumes the `--md-sys-*` design tokens
 * directly (with hex fallbacks so the component is fully autonomous). The
 * grid template switches on the reflected `size-class` attribute: navigation
 * sits at the bottom in `compact` and at the leading edge from `medium` up.
 *
 * Window margins follow `adaptive.rs`: 16dp in compact, 24dp otherwise.
 */
export declare const styles: import("lit").CSSResult;
