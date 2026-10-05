/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { GridList } from "./internal/grid-list.js";
import { styles } from "./internal/grid-list-styles.js";
/**
 * @summary A grid list arranges tiles in a uniform CSS grid.
 *
 * @description
 * Set `cols` for the column count, `gap` for the inter-tile spacing (px), and
 * `row-height` as a pixel number, an aspect ratio (`16:9`), or `fit`. Place
 * `md-grid-tile` children in the default slot.
 *
 * ```html
 * <md-grid-list cols="3" gap="12" row-height="16:9">
 *   <md-grid-tile><img src="a.jpg" alt=""></md-grid-tile>
 *   <md-grid-tile colspan="2"><img src="b.jpg" alt=""></md-grid-tile>
 * </md-grid-list>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdGridList = class MdGridList extends GridList {
    static { this.styles = [styles]; }
};
MdGridList = __decorate([
    customElement("md-grid-list")
], MdGridList);
export { MdGridList };
//# sourceMappingURL=grid-list.js.map