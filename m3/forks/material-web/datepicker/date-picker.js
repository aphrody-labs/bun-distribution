/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { DatePicker } from "./internal/date-picker.js";
import { styles } from "./internal/date-picker-styles.js";
/**
 * @summary A docked Material 3 date picker — a month calendar grid.
 *
 * @description
 * Bind `value` (a `YYYY-MM-DD` string) and optionally `min`/`max`. Listen for
 * `date-picker:change` to react to selection.
 *
 * ```html
 * <md-date-picker value="2026-05-22" min="2026-01-01"></md-date-picker>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdDatePicker = class MdDatePicker extends DatePicker {
    static { this.styles = [styles]; }
};
MdDatePicker = __decorate([
    customElement("md-date-picker")
], MdDatePicker);
export { MdDatePicker };
//# sourceMappingURL=date-picker.js.map