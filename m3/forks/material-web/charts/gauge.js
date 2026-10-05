/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { Gauge } from "./internal/gauge.js";
import { styles } from "./internal/gauge-styles.js";
/**
 * @summary A Material 3 radial gauge (0–100 by default).
 *
 * @description
 * Renders `value` within `[min, max]` as an arc over a track, with an optional
 * centre readout, unit suffix and coloured threshold `bands`. The `sweep`
 * (degrees) controls the dial opening. Self-contained on the `--md-sys-*`
 * tokens and exposed with the `meter` ARIA semantics via `role="img"` plus
 * `aria-valuenow/min/max`.
 *
 * ```html
 * <md-gauge value="72" unit="%"></md-gauge>
 * ```
 *
 * @final
 */
let MdGauge = class MdGauge extends Gauge {
    static { this.styles = styles; }
};
MdGauge = __decorate([
    customElement("md-gauge")
], MdGauge);
export { MdGauge };
//# sourceMappingURL=gauge.js.map