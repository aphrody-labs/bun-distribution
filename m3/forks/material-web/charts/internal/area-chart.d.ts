/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ChartSeries } from "./chart-base.js";
import { LineChart } from "./line-chart.js";
/**
 * A Material 3 area chart — a {@link LineChart} variant that fills the region
 * beneath each series. Set `stacked` to stack the series cumulatively (each
 * series sits on top of the previous one). Inherits the axes, grid, legend,
 * tooltip and a11y table from the line chart.
 */
export declare class AreaChart extends LineChart {
    /** Stack the series cumulatively rather than overlaying them. */
    stacked: boolean;
    /** Area charts fill by default. */
    area: boolean;
    /**
     * Series with cumulative running totals applied when `stacked`. Derived in
     * `effectiveSeries()`; never mutates the public `series` property (which the
     * old implementation did, double-stacking on every re-render).
     */
    private get stackedSeries();
    /**
     * The series the line-chart renderer should draw — cumulative when stacked,
     * otherwise the raw series.
     */
    protected get renderSeriesData(): ChartSeries[];
}
