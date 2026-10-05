/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * A single tile within an `md-grid-list`. It can span multiple columns or rows
 * via `colspan`/`rowspan`, clips its content to a medium corner radius, and
 * exposes a `footer` slot for an overlay strip at the bottom.
 *
 * Slots:
 * - default — the tile content (e.g. an image).
 * - `footer` — an overlay caption strip pinned to the bottom of the tile.
 */
export declare class GridTile extends LitElement {
    /** Number of columns this tile spans. */
    colspan: number;
    /** Number of rows this tile spans. */
    rowspan: number;
    connectedCallback(): void;
    protected updated(): void;
    protected render(): import("lit-html").TemplateResult<1>;
}
