/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { Paginator } from "./internal/paginator.js";
import { styles } from "./internal/paginator-styles.js";
/**
 * @summary Paginators let users navigate a paged collection: choose a page
 * size, read the current item range and move between pages.
 *
 * @description
 * Set `length`, and optionally `page-size`, `page-index` and the
 * `.pageSizeOptions` JS property. Navigation buttons clamp to the bounds and
 * fire `paginator:page` with the new `{pageIndex, pageSize, length}`. Changing
 * the page size keeps the first visible item stable.
 *
 * ```html
 * <md-paginator length="120" page-size="10" page-index="0"></md-paginator>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdPaginator = class MdPaginator extends Paginator {
    static { this.styles = [styles]; }
};
MdPaginator = __decorate([
    customElement("md-paginator")
], MdPaginator);
export { MdPaginator };
//# sourceMappingURL=paginator.js.map