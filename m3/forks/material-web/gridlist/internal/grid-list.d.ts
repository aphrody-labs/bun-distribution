/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * A grid list lays out a collection of `md-grid-tile` children in a uniform
 * CSS grid. The number of columns, the inter-tile gap, and the row height are
 * all configurable.
 *
 * The `row-height` attribute accepts three forms:
 * - a pixel number (e.g. `120`) — every row is that tall;
 * - an aspect ratio (e.g. `16:9`) — each row's height tracks the column width;
 * - `fit` — rows share the host's height equally.
 *
 * Slot:
 * - default — the `md-grid-tile` children.
 */
export declare class GridList extends LitElement {
    /** Number of equal-width columns. */
    cols: number;
    /** Gap between tiles, in pixels. */
    gap: number;
    /**
     * Row sizing. A bare number is treated as pixels; `'fit'` distributes the
     * host height across rows; a `'W:H'` string sets the row aspect ratio.
     */
    rowHeight: string;
    connectedCallback(): void;
    protected updated(): void;
    protected firstUpdated(): void;
    private applyLayout;
    protected render(): import("lit-html").TemplateResult<1>;
}
