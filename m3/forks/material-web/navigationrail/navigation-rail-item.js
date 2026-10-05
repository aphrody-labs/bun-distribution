/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { NavigationRailItem } from "./internal/navigation-rail-item.js";
import { itemStyles } from "./internal/navigation-rail-styles.js";
/**
 * @summary A single destination inside an `<md-navigation-rail>`.
 *
 * @final
 * @suppress {visibility}
 */
let MdNavigationRailItem = class MdNavigationRailItem extends NavigationRailItem {
    static { this.styles = [itemStyles]; }
};
MdNavigationRailItem = __decorate([
    customElement("md-navigation-rail-item")
], MdNavigationRailItem);
export { MdNavigationRailItem };
//# sourceMappingURL=navigation-rail-item.js.map