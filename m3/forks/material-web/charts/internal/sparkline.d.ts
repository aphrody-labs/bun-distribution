/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PropertyValues, SVGTemplateResult } from "lit";
import { ChartBase } from "./chart-base.js";
/**
 * A Material 3 sparkline: a compact, axis-free inline trend line for a single
 * data set. Renders an SVG polyline (optionally smooth / filled) with an
 * optional end-point marker. Inherits `data` from the first series or the
 * `values` property. Self-contained on the `--md-sys-*` tokens.
 */
export declare class Sparkline extends ChartBase {
    /** Data values (alternative to `series`). */
    values: number[];
    /** Render as a smooth curve. */
    smooth: boolean;
    /** Fill the area beneath the line. */
    area: boolean;
    /** Render as bars rather than a line. */
    bars: boolean;
    /** Show a marker on the last point. */
    showEndpoint: boolean;
    /** Sparklines are compact by default. */
    height: number;
    width: number;
    legend: boolean;
    tooltip: boolean;
    /** Memoised geometry; recomputed only in `willUpdate`. */
    private layout;
    private get points();
    protected willUpdate(changed: PropertyValues): void;
    /** Map a data index to an X pixel. */
    private xAt;
    /** Map a value to a Y pixel. */
    private yAt;
    protected render(): SVGTemplateResult;
    private renderLine;
    private renderBars;
    protected describe(): string;
}
