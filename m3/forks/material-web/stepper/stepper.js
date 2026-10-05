/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { Stepper } from "./internal/stepper.js";
import { styles } from "./internal/stepper-styles.js";
/**
 * @summary Steppers guide a user through a sequence of numbered steps, showing
 * progress and (optionally) enforcing a linear order.
 *
 * @description
 * Place `<md-step>` children inside an `<md-stepper>`. The stepper renders the
 * indicator header (horizontal row or vertical stack) and shows the active
 * step's content. Drive it imperatively with `next()`, `previous()` and
 * `select(index)`, or set the `selected-index` attribute. Listen for
 * `stepper:change` to react to selection changes.
 *
 * ```html
 * <md-stepper linear selected-index="0">
 *   <md-step label="Account" completed>…</md-step>
 *   <md-step label="Address">…</md-step>
 *   <md-step label="Review" optional>…</md-step>
 * </md-stepper>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdStepper = class MdStepper extends Stepper {
    static { this.styles = [styles]; }
};
MdStepper = __decorate([
    customElement("md-stepper")
], MdStepper);
export { MdStepper };
//# sourceMappingURL=stepper.js.map