/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Material 3 backdrop (scrim) styles. The host is a fixed, full-viewport
 * overlay tinted with `--md-sys-color-scrim` at a configurable alpha. It is
 * hidden (and non-interactive) until `[open]`, then fades in. `[invisible]`
 * drops the tint while still catching clicks; `[blur]` frosts the content
 * behind it. Per-instance overrides via `--md-backdrop-*`.
 */
export declare const styles: import("lit").CSSResult;
