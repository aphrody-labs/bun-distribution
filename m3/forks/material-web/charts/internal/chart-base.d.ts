/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/** A single data series passed declaratively to a chart. */
export interface ChartSeries {
    /** Numeric data points for the series. */
    data: number[];
    /** Human-readable name shown in the legend / tooltip. */
    label?: string;
    /** Optional explicit colour (CSS value). Defaults to the M3 palette. */
    color?: string;
    /**
     * Stack id. Series sharing a stack id are stacked on top of each other
     * (bar / area charts). Omit for grouped / overlaid rendering.
     */
    stack?: string;
    /** Render the line as a smooth curve rather than straight segments. */
    curve?: boolean;
    /** Show point markers (line / area charts). */
    showMarkers?: boolean;
}
/** The default Material 3 tonal palette used when a series has no colour. */
export declare const M3_PALETTE: string[];
/** Resolve a colour for series index `i`, honouring overrides. */
export declare function colorAt(colors: string[] | undefined, series: ChartSeries | undefined, i: number): string;
/** "Nice" axis bounds + tick count for a numeric range. */
export declare function niceScale(min: number, max: number, ticks?: number): {
    min: number;
    max: number;
    step: number;
};
/** Build an SVG path `d` for a polyline / smooth curve through points. */
export declare function linePath(points: ReadonlyArray<readonly [number, number]>, smooth?: boolean): string;
/** Format a number compactly for axis ticks / labels. */
export declare function fmt(n: number): string;
/**
 * Base class for all charts. Provides declarative sizing, a ResizeObserver for
 * responsive width, the shared `series`/`colors`/`legend`/`tooltip` API and an
 * a11y label. Subclasses implement `renderChart()`.
 */
export declare abstract class ChartBase extends LitElement {
    /** Data series. Set via the `.series` property (not an attribute). */
    series: ChartSeries[];
    /** Category labels for the X axis (bar / line / area). */
    categories: string[];
    /** Explicit colour palette (CSS values), overriding the M3 default. */
    colors?: string[];
    /** Chart height in px. */
    height: number;
    /**
     * Chart width in px. When unset (0), the chart fills its container width and
     * tracks it with a ResizeObserver.
     */
    width: number;
    /** Show the legend. */
    legend: boolean;
    /** Enable the hover tooltip. */
    tooltip: boolean;
    /** Accessible label describing the chart. */
    ariaLabelText: string;
    /** Measured container width (px) used when `width` is 0. */
    protected measuredWidth: number;
    private resizeObserver?;
    /** Effective render width. */
    protected get renderWidth(): number;
    connectedCallback(): void;
    disconnectedCallback(): void;
    /** A11y description built from the series / categories. */
    protected describe(): string;
}
