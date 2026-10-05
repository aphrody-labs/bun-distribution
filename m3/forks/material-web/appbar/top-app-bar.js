/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { TopAppBar } from "./internal/top-app-bar.js";
import { styles } from "./internal/top-app-bar-styles.js";
/**
 * @summary A top app bar with the four Material 3 variants and on-scroll fill.
 *
 * @description
 * ```html
 * <md-top-app-bar variant="large">
 *   <md-icon-button slot="leading"><md-icon>menu</md-icon></md-icon-button>
 *   Inbox
 *   <md-icon-button slot="trailing"><md-icon>search</md-icon></md-icon-button>
 * </md-top-app-bar>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdTopAppBar = class MdTopAppBar extends TopAppBar {
    static { this.styles = [styles]; }
};
MdTopAppBar = __decorate([
    customElement("md-top-app-bar")
], MdTopAppBar);
export { MdTopAppBar };
//# sourceMappingURL=top-app-bar.js.map