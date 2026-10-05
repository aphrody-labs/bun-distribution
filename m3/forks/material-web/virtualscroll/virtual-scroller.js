/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { VirtualScroller } from "./internal/virtual-scroller.js";
import { styles } from "./internal/virtual-scroller-styles.js";
/**
 * @summary A fixed-size virtual scroller (CDK `virtual-scroll-viewport`
 * equivalent) — renders only the visible rows of a large list.
 *
 * @description
 * ```ts
 * const vs = document.querySelector('md-virtual-scroller')!;
 * vs.items = bigArray;
 * vs.itemHeight = 56;
 * vs.renderItem = (item, i) => html`<md-list-item>${item.name}</md-list-item>`;
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdVirtualScroller = class MdVirtualScroller extends VirtualScroller {
    static { this.styles = [styles]; }
};
MdVirtualScroller = __decorate([
    customElement("md-virtual-scroller")
], MdVirtualScroller);
export { MdVirtualScroller };
//# sourceMappingURL=virtual-scroller.js.map