/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { Pane } from "./internal/pane.js";
import { styles } from "./internal/pane-styles.js";
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
let MdPane = class MdPane extends Pane {
    static { this.styles = [styles]; }
};
MdPane = __decorate([
    customElement("md-pane")
], MdPane);
export { MdPane };
//# sourceMappingURL=md-pane.js.map