/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PropertyValues, SVGTemplateResult } from "lit";
import { ChartBase } from "./chart-base.js";
/** A coloured threshold band on the gauge track. */
export interface GaugeBand {
    /** Upper bound of the band (in value units). */
    to: number;
    /** Band colour (CSS value). */
    color: string;
}
/**
 * A Material 3 radial gauge. Renders a 0–100 (configurable) value as an arc
 * with a track, a coloured value arc, optional threshold bands and a centre
 * readout. Self-contained on the `--md-sys-*` tokens.
 */
export declare class Gauge extends ChartBase {
    /** The current value. */
    value: number;
    /** Minimum of the range. */
    min: number;
    /** Maximum of the range. */
    max: number;
    /** Total sweep of the gauge in degrees (e.g. 270 for a 3/4 dial). */
    sweep: number;
    /** Arc thickness in px. */
    thickness: number;
    /** Optional unit suffix shown after the value (e.g. "%"). */
    unit: string;
    /** Hide the centre numeric readout. */
    hideValue: boolean;
    /** Optional coloured threshold bands along the track. */
    bands?: GaugeBand[];
    height: number;
    legend: boolean;
    tooltip: boolean;
    /** Memoised geometry; recomputed only in `willUpdate`. */
    private layout;
    private get fraction();
    protected willUpdate(changed: PropertyValues): void;
    protected render(): SVGTemplateResult;
    private renderBands;
    private bandColor;
    protected describe(): string;
}
