/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { DatePicker } from "./internal/date-picker.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-date-picker": MdDatePicker;
    }
}
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
export declare class MdDatePicker extends DatePicker {
    static styles: CSSResultOrNative[];
}
