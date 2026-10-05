/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { FabMenuItem } from "./internal/fab-menu-item.js";
import { styles } from "./internal/fab-menu-item-styles.js";
/**
 * @summary A single action row inside an `md-fab-menu`.
 *
 * @description
 * Provide the visible/accessible text with `label` and slot an icon as the
 * default content.
 *
 * ```html
 * <md-fab-menu-item label="New doc">
 *   <svg viewBox="0 0 24 24"><path d="..."></path></svg>
 * </md-fab-menu-item>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdFabMenuItem = class MdFabMenuItem extends FabMenuItem {
    static { this.styles = [styles]; }
};
MdFabMenuItem = __decorate([
    customElement("md-fab-menu-item")
], MdFabMenuItem);
export { MdFabMenuItem };
//# sourceMappingURL=fab-menu-item.js.map