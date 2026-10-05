/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { BottomSheet } from "./internal/bottom-sheet.js";
import { styles } from "./internal/bottom-sheet-styles.js";
/**
 * @summary Bottom sheets show supplementary content anchored to the bottom of
 * the screen.
 *
 * @description
 * Use `show()`/`close()` or toggle the `open` attribute. Set `modal` to dim the
 * rest of the UI with a scrim that dismisses the sheet on click; the sheet can
 * also be swiped down via its drag handle.
 *
 * ```html
 * <md-bottom-sheet modal>
 *   <p>Sheet content</p>
 * </md-bottom-sheet>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdBottomSheet = class MdBottomSheet extends BottomSheet {
    static { this.styles = [styles]; }
};
MdBottomSheet = __decorate([
    customElement("md-bottom-sheet")
], MdBottomSheet);
export { MdBottomSheet };
//# sourceMappingURL=bottom-sheet.js.map