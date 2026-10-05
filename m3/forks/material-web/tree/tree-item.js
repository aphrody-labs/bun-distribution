/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { TreeItem } from "./internal/tree-item.js";
import { styles } from "./internal/tree-item-styles.js";
/**
 * @summary A single node within an `<md-tree>`.
 *
 * @description
 * Renders an indented row with an expand/collapse chevron (when it has child
 * items), an optional leading icon (slot `icon`) and the `label`. Nested
 * `<md-tree-item>` children live in the default slot and appear only when the
 * node is `expanded`.
 *
 * ```html
 * <md-tree-item label="Documents" value="docs">
 *   <md-icon slot="icon">folder</md-icon>
 *   <md-tree-item label="Resume.pdf" value="resume"></md-tree-item>
 * </md-tree-item>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdTreeItem = class MdTreeItem extends TreeItem {
    static { this.styles = [styles]; }
};
MdTreeItem = __decorate([
    customElement("md-tree-item")
], MdTreeItem);
export { MdTreeItem };
//# sourceMappingURL=tree-item.js.map