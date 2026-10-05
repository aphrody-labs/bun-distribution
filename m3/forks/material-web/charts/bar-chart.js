/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { BarChart } from "./internal/bar-chart.js";
import { styles } from "./internal/bar-chart-styles.js";
/**
 * @summary A Material 3 bar chart with grouped or stacked bars.
 *
 * @description
 * Renders one or more numeric series as SVG bars. Bars are grouped per category
 * by default; set `stacked` to stack them. Includes X/Y axes, a grid, a
 * clickable legend and a hover tooltip. Self-contained on the `--md-sys-*`
 * tokens and accessible via `role="img"` plus a hidden data table.
 *
 * ```html
 * <md-bar-chart stacked></md-bar-chart>
 * <script>
 *   chart.categories = ['Q1', 'Q2', 'Q3'];
 *   chart.series = [
 *     {label: 'A', data: [4, 7, 5], stack: 's'},
 *     {label: 'B', data: [3, 2, 6], stack: 's'},
 *   ];
 * </script>
 * ```
 *
 * @final
 */
let MdBarChart = class MdBarChart extends BarChart {
    static { this.styles = styles; }
};
MdBarChart = __decorate([
    customElement("md-bar-chart")
], MdBarChart);
export { MdBarChart };
//# sourceMappingURL=bar-chart.js.map