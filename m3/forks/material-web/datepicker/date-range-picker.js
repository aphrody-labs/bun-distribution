/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { DateRangePicker } from "./internal/date-range-picker.js";
import { styles } from "./internal/date-range-picker-styles.js";
/**
 * @summary A docked Material 3 date *range* picker — a month calendar grid with
 * a highlighted start-to-end span.
 *
 * @description
 * Bind `start` and `end` (`YYYY-MM-DD` strings) and optionally `min`/`max` or a
 * `disabledDate` predicate. Set `editable` to show coupled start/end text
 * fields. Listen for `date-range-picker:change` (or the native `change`) to
 * react to selection.
 *
 * ```html
 * <md-date-range-picker
 *   start="2026-05-04"
 *   end="2026-05-12"
 *   editable
 * ></md-date-range-picker>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdDateRangePicker = class MdDateRangePicker extends DateRangePicker {
    static { this.styles = [styles]; }
};
MdDateRangePicker = __decorate([
    customElement("md-date-range-picker")
], MdDateRangePicker);
export { MdDateRangePicker };
//# sourceMappingURL=date-range-picker.js.map