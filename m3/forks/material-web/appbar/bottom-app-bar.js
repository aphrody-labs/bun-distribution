/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { BottomAppBar } from "./internal/bottom-app-bar.js";
import { styles } from "./internal/bottom-app-bar-styles.js";
/**
 * @summary A bottom app bar for navigation and key actions on compact windows.
 *
 * @final
 * @suppress {visibility}
 */
let MdBottomAppBar = class MdBottomAppBar extends BottomAppBar {
    static { this.styles = [styles]; }
};
MdBottomAppBar = __decorate([
    customElement("md-bottom-app-bar")
], MdBottomAppBar);
export { MdBottomAppBar };
//# sourceMappingURL=bottom-app-bar.js.map