/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PropertyValues, SVGTemplateResult } from "lit";
import type { ChartSeries } from "./chart-base.js";
import { ChartBase } from "./chart-base.js";
/** Memoised geometry computed once per update in `willUpdate`. */
interface LineLayout {
    w: number;
    h: number;
    plotW: number;
    plotH: number;
    n: number;
    min: number;
    max: number;
    step: number;
    ticks: number[];
}
/**
 * A Material 3 line chart. Renders multiple series as SVG polylines (straight
 * or smooth), with X/Y axes, a grid, optional point markers, a legend and a
 * hover tooltip. Subclassed by the area chart.
 *
 * The chart is self-contained (no external chart library) and draws everything
 * with inline SVG so it can live inside a shadow root and theme from the
 * `--md-sys-*` tokens.
 */
export declare class LineChart extends ChartBase {
    /** Render every series as a smooth curve unless the series overrides it. */
    smooth: boolean;
    /** Show point markers on every series unless the series overrides it. */
    showMarkers: boolean;
    /** Fill the area beneath each line (area-chart behaviour). */
    area: boolean;
    /** Y-axis title. */
    yAxisLabel: string;
    /** Hidden series indices (toggled via the legend). */
    private hiddenSeries;
    private hover;
    /** Layout margins. */
    protected readonly margin: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    /**
     * Memoised geometry. Recomputed in `willUpdate` whenever inputs change so
     * `render()` stays pure and free of scale math.
     */
    protected layout: LineLayout;
    /**
     * The series actually drawn. Subclasses (area chart) override this to supply
     * transformed data (e.g. cumulative stacks) without mutating `series`.
     */
    protected get renderSeriesData(): ChartSeries[];
    protected willUpdate(changed: PropertyValues): void;
    /** Map a value to a Y pixel using the current layout. */
    protected yToPx(v: number): number;
    /** Map a category index to an X pixel using the current layout. */
    protected xToPx(i: number): number;
    private computeLayout;
    protected render(): SVGTemplateResult;
    protected maxCategoryCount(): number;
    protected computeYScale(): {
        min: number;
        max: number;
        step: number;
    };
    private renderGrid;
    private renderAxes;
    private renderXLabels;
    private renderSeries;
    private renderMarkers;
    private renderLegend;
    private renderTooltip;
    private renderTable;
    private onPointerMove;
    private onPointerLeave;
    private toggleSeries;
}
export {};
