/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { LineChart } from "./internal/line-chart.js";
import { styles } from "./internal/line-chart-styles.js";
/**
 * @summary A Material 3 line chart for one or more numeric series.
 *
 * @description
 * Renders multiple series as SVG lines (straight or smooth curves) with X/Y
 * axes, a grid, optional point markers, a clickable legend and a hover tooltip.
 * Set data via the `.series` property and X labels via `.categories`. Colours
 * default to the M3 tonal palette; override with `.colors`. Responsive via a
 * ResizeObserver, accessible via `role="img"` plus a hidden data table.
 *
 * ```html
 * <md-line-chart smooth show-markers></md-line-chart>
 * <script>
 *   chart.categories = ['Jan', 'Feb', 'Mar', 'Apr'];
 *   chart.series = [
 *     {label: 'Revenue', data: [12, 19, 8, 25]},
 *     {label: 'Cost', data: [7, 11, 9, 14]},
 *   ];
 * </script>
 * ```
 *
 * @final
 */
let MdLineChart = class MdLineChart extends LineChart {
    static { this.styles = styles; }
};
MdLineChart = __decorate([
    customElement("md-line-chart")
], MdLineChart);
export { MdLineChart };
//# sourceMappingURL=line-chart.js.map