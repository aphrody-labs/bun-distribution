/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PropertyValues, SVGTemplateResult } from "lit";
import { ChartBase } from "./chart-base.js";
/** A radar (spider) series: one polygon over the shared categories. */
export interface RadarSeries {
    /** One value per category, in `categories` order. */
    data: number[];
    /** Human-readable name shown in the legend / tooltip. */
    label?: string;
    /** Optional explicit colour (CSS value). Defaults to the M3 palette. */
    color?: string;
}
/** Memoised geometry computed once per update in `willUpdate`. */
interface RadarLayout {
    w: number;
    h: number;
    cx: number;
    cy: number;
    radius: number;
    axisCount: number;
    min: number;
    max: number;
    step: number;
    rings: number[];
}
/**
 * A Material 3 radar (spider / web) chart. Each category becomes a spoke laid
 * out evenly around a circle; each series is drawn as a closed polygon over the
 * spokes. Includes a concentric grid, spoke axes, value tick labels, a
 * clickable legend and a hover tooltip.
 *
 * Self-contained (no external chart library) — everything is inline SVG so it
 * themes from the `--md-sys-*` tokens inside a shadow root.
 */
export declare class RadarChart extends ChartBase {
    /** Radar series. Set via the `.radarSeries` property. */
    radarSeries: RadarSeries[];
    /** Fill opacity for each polygon (0 disables the fill). */
    fillOpacity: number;
    /** Show value markers at every vertex. */
    showMarkers: boolean;
    /** Hidden series indices (toggled via the legend). */
    private hiddenSeries;
    private hover;
    height: number;
    /**
     * Memoised geometry. Recomputed in `willUpdate` whenever inputs change so
     * `render()` stays pure and free of scale math.
     */
    protected layout: RadarLayout;
    protected willUpdate(changed: PropertyValues): void;
    private computeLayout;
    private maxAxisCount;
    /** Angle (radians, clockwise from 12 o'clock) for axis index `i`. */
    private angleAt;
    /** Cartesian point for a value along axis `i`. */
    private pointAt;
    protected render(): SVGTemplateResult;
    private ringPath;
    private renderGrid;
    private renderSpokes;
    private renderAxisLabels;
    private renderSeries;
    private renderTooltip;
    private renderLegend;
    private renderTable;
    protected describe(): string;
    private onPointerLeave;
    private toggleSeries;
}
export {};
