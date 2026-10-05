/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { ListDetail } from "./internal/list-detail.js";
import { styles } from "./internal/list-detail-styles.js";
/**
 * @summary The Material 3 list-detail canonical layout — two panes side by side
 * when there's room, one at a time when there isn't.
 *
 * @description
 * From the Expanded breakpoint (>= 840dp) the list (fixed ~360px, leading) and
 * detail (flexible, trailing) show together, separated by the 24dp pane spacer.
 * Below that, only one pane shows; call `showDetail()` / `showList()` (or set
 * the `showing` attribute) to navigate. RTL-aware: the list always leads.
 *
 * ```html
 * <md-list-detail showing="list">
 *   <nav slot="list">…</nav>
 *   <article slot="detail">…</article>
 * </md-list-detail>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdListDetail = class MdListDetail extends ListDetail {
    static { this.styles = [styles]; }
};
MdListDetail = __decorate([
    customElement("md-list-detail")
], MdListDetail);
export { MdListDetail };
//# sourceMappingURL=md-list-detail.js.map