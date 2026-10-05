/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { FabMenu } from "./internal/fab-menu.js";
import { styles } from "./internal/fab-menu-styles.js";
/**
 * @summary A FAB menu — a primary FAB that reveals a stack of action items.
 *
 * @description
 * Slot `md-fab-menu-item` children. Toggle the `open` attribute or call
 * `show()`/`close()`/`toggle()`.
 *
 * ```html
 * <md-fab-menu label="Create">
 *   <md-fab-menu-item label="New doc"><svg ...></svg></md-fab-menu-item>
 *   <md-fab-menu-item label="New folder"><svg ...></svg></md-fab-menu-item>
 * </md-fab-menu>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdFabMenu = class MdFabMenu extends FabMenu {
    static { this.styles = [styles]; }
};
MdFabMenu = __decorate([
    customElement("md-fab-menu")
], MdFabMenu);
export { MdFabMenu };
//# sourceMappingURL=fab-menu.js.map