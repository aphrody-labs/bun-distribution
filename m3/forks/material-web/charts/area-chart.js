/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { AreaChart } from "./internal/area-chart.js";
import { styles } from "./internal/area-chart-styles.js";
/**
 * @summary A Material 3 area chart — a filled line chart, optionally stacked.
 *
 * @description
 * A {@link MdLineChart} variant that fills the area beneath each series. Set
 * `stacked` to stack the series cumulatively. Inherits axes, grid, legend,
 * tooltip and the a11y table.
 *
 * ```html
 * <md-area-chart stacked></md-area-chart>
 * ```
 *
 * @final
 */
let MdAreaChart = class MdAreaChart extends AreaChart {
    static { this.styles = styles; }
};
MdAreaChart = __decorate([
    customElement("md-area-chart")
], MdAreaChart);
export { MdAreaChart };
//# sourceMappingURL=area-chart.js.map