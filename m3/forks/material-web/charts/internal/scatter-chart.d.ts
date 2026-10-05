/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PropertyValues, SVGTemplateResult } from "lit";
import { ChartBase } from "./chart-base.js";
/** A single point in a scatter series. */
export interface ScatterPoint {
    /** X coordinate (numeric axis). */
    x: number;
    /** Y coordinate (numeric axis). */
    y: number;
    /** Optional point radius in px, overriding the series / chart default. */
    size?: number;
}
/** A scatter series: a labelled set of {x, y} points. */
export interface ScatterSeries {
    /** Points for the series. */
    data: ScatterPoint[];
    /** Human-readable name shown in the legend / tooltip. */
    label?: string;
    /** Optional explicit colour (CSS value). Defaults to the M3 palette. */
    color?: string;
    /** Default point radius (px) for this series. */
    size?: number;
}
/** Memoised geometry computed once per update in `willUpdate`. */
interface ScatterLayout {
    w: number;
    h: number;
    plotW: number;
    plotH: number;
    xMin: number;
    xMax: number;
    xStep: number;
    xTicks: number[];
    yMin: number;
    yMax: number;
    yStep: number;
    yTicks: number[];
}
/**
 * A Material 3 scatter chart. Renders one or more series of {x, y} points as
 * SVG circles against numeric X/Y axes, with a grid, a clickable legend and a
 * hover tooltip. Point sizes are configurable per chart, per series or per
 * point.
 *
 * Self-contained (no external chart library) — everything is inline SVG so it
 * themes from the `--md-sys-*` tokens inside a shadow root.
 */
export declare class ScatterChart extends ChartBase {
    /** Scatter series. Set via the `.scatterSeries` property. */
    scatterSeries: ScatterSeries[];
    /** Default point radius (px). */
    pointSize: number;
    /** X-axis title. */
    xAxisLabel: string;
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
    protected layout: ScatterLayout;
    protected willUpdate(changed: PropertyValues): void;
    /** Map a data X value to a pixel using the current layout. */
    protected xToPx(v: number): number;
    /** Map a data Y value to a pixel using the current layout. */
    protected yToPx(v: number): number;
    private computeLayout;
    private buildTicks;
    protected render(): SVGTemplateResult;
    private renderGrid;
    private renderAxes;
    private renderPoints;
    private renderTooltip;
    private renderLegend;
    private renderTable;
    protected describe(): string;
    private onPointerMove;
    private onPointerLeave;
    private toggleSeries;
}
export {};
