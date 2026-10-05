/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { Pane } from "./internal/pane.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-pane": MdPane;
    }
}
/**
 * @summary An individual Material 3 layout pane — a padded, independently
 * scrolling content surface that is either fixed-width or flexible.
 *
 * @description
 * Use `md-pane` as the building block of multi-pane layouts. A `fixed` pane
 * keeps a constant `width` (defaults to the 360px M3 list width); a `flexible`
 * pane fills the remaining space.
 *
 * ```html
 * <div style="display:flex; gap:24px; height:100%;">
 *   <md-pane role="fixed" width="360" pane-name="List">…</md-pane>
 *   <md-pane role="flexible" pane-name="Detail" rounded>…</md-pane>
 * </div>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
export declare class MdPane extends Pane {
    static styles: CSSResultOrNative[];
}
