/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PropertyValues, SVGTemplateResult } from "lit";
import { ChartBase } from "./chart-base.js";
/** A single pie slice descriptor. */
export interface PieDatum {
    value: number;
    label?: string;
    color?: string;
}
/**
 * A Material 3 pie / donut chart. Provide slices via the `data` property (or
 * a single-series `series`). Set `inner-radius` (0–1) for a donut, `show-labels`
 * for inline percentage labels, plus a legend and hover tooltip. Self-contained
 * on the `--md-sys-*` tokens.
 */
export declare class PieChart extends ChartBase {
    /** Slice data. Alternatively the first entry of `series` is used. */
    data: PieDatum[];
    /** Inner radius as a fraction of the outer radius (0 = pie, >0 = donut). */
    innerRadius: number;
    /** Show percentage labels on each slice. */
    showLabels: boolean;
    /** Padding angle between slices, in degrees. */
    padAngle: number;
    private hiddenSeries;
    private hover;
    height: number;
    /** Memoised geometry; recomputed only in `willUpdate`. */
    private layout;
    protected willUpdate(changed: PropertyValues): void;
    private get slices();
    private buildArcs;
    protected render(): SVGTemplateResult;
    private onPointerLeave;
    private renderSliceLabels;
    private renderTooltip;
    private renderLegend;
    private renderTable;
    private toggle;
}
