/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { LoadingIndicator } from "./internal/loading-indicator.js";
import { styles } from "./internal/loading-indicator-styles.js";
/**
 * @summary A Material 3 Expressive loading indicator — an active shape that
 * rotates and morphs while content loads.
 *
 * @description
 * Leave `value` unset for an indeterminate indicator, or set it to a number in
 * the range 0..1 for determinate progress (exposes `aria-valuenow`). Honors the
 * user's reduced-motion preference by falling back to a static shape.
 *
 * ```html
 * <md-loading-indicator aria-label="Loading"></md-loading-indicator>
 * <md-loading-indicator value="0.5"></md-loading-indicator>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdLoadingIndicator = class MdLoadingIndicator extends LoadingIndicator {
    static { this.styles = [styles]; }
};
MdLoadingIndicator = __decorate([
    customElement("md-loading-indicator")
], MdLoadingIndicator);
export { MdLoadingIndicator };
//# sourceMappingURL=loading-indicator.js.map