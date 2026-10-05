/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { Autocomplete } from "./internal/autocomplete.js";
import { styles } from "./internal/autocomplete-styles.js";
/**
 * @summary An outlined text field that suggests options from a filtered,
 * floating list as the user types.
 *
 * @description
 * Provide the candidate options via the `.options` property (an array of
 * `{value, label}`). The list filters in real time (case-insensitive) using the
 * `filter` strategy (`contains` or `startsWith`). Navigate with the arrow keys,
 * select with Enter or a click, and dismiss with Escape. Selection fires
 * `autocomplete:select`; typing re-dispatches `input`.
 *
 * ```html
 * <md-autocomplete
 *   label="Fruit"
 *   .options=${[{value: 'a', label: 'Apple'}, {value: 'b', label: 'Banana'}]}
 * ></md-autocomplete>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdAutocomplete = class MdAutocomplete extends Autocomplete {
    static { this.styles = [styles]; }
};
MdAutocomplete = __decorate([
    customElement("md-autocomplete")
], MdAutocomplete);
export { MdAutocomplete };
//# sourceMappingURL=autocomplete.js.map