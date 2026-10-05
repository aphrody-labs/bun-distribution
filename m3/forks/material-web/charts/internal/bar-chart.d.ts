/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PropertyValues, SVGTemplateResult } from "lit";
import { ChartBase } from "./chart-base.js";
/**
 * A Material 3 bar chart. Supports grouped bars (default) and stacked bars
 * (set `stacked`, or give series a shared `stack` id), in vertical (default) or
 * horizontal orientation (`horizontal`). Renders SVG rects with X/Y axes, a
 * grid, a legend and a hover tooltip. Self-contained on the `--md-sys-*` tokens.
 */
export declare class BarChart extends ChartBase {
    /** Stack all series into a single column per category. */
    stacked: boolean;
    /** Render bars horizontally (categories on the Y axis, values on the X). */
    horizontal: boolean;
    /** Y-axis title. */
    yAxisLabel: string;
    private hiddenSeries;
    private hover;
    protected readonly margin: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    /** Memoised geometry; recomputed only in `willUpdate`. */
    private layout;
    private get categoryCount();
    private get activeSeries();
    protected willUpdate(changed: PropertyValues): void;
    /** Compute the value-axis scale, accounting for stacking. */
    private computeScale;
    private computeLayout;
    /** Map a value to a pixel coordinate along the value axis. */
    private vToPx;
    /** Start pixel of category band `ci` along the band axis. */
    private bandStart;
    protected render(): SVGTemplateResult;
    private renderGrid;
    private renderAxes;
    private renderBars;
    /** Rect geometry for a single bar, handling orientation + stacking. */
    private barGeometry;
    private renderLegend;
    private renderTooltip;
    private renderTable;
    private onPointerLeave;
    private toggle;
}
