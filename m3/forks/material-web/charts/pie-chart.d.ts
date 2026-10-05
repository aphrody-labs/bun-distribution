/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { PieChart } from "./internal/pie-chart.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-pie-chart": MdPieChart;
    }
}
/**
 * @summary A Material 3 pie / donut chart.
 *
 * @description
 * Renders slices from the `.data` property (`{value, label, color}[]`) or a
 * single `.series`. Set `inner-radius` (0–1) for a donut, `show-labels` for
 * inline percentages, plus a clickable legend and hover tooltip. Self-contained
 * on the `--md-sys-*` tokens.
 *
 * ```html
 * <md-pie-chart inner-radius="0.6" show-labels></md-pie-chart>
 * <script>
 *   chart.data = [
 *     {label: 'Chrome', value: 64},
 *     {label: 'Safari', value: 19},
 *     {label: 'Edge', value: 5},
 *   ];
 * </script>
 * ```
 *
 * @final
 */
export declare class MdPieChart extends PieChart {
    static styles: CSSResultOrNative[];
}
