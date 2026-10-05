/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * The sizing behaviour of a pane within a multi-pane layout, mirroring
 * `PaneKind` in `crates/ui/m3-tokens/src/adaptive.rs`.
 *
 * - `fixed` — fixed-width pane (e.g. a list). Uses {@link Pane.width}.
 * - `flexible` — absorbs the remaining width (e.g. a detail view).
 */
export type PaneVariant = "fixed" | "flexible";
/**
 * A single Material 3 layout pane: a self-contained content surface with
 * padding and independent scrolling. Panes are the only place content lives in
 * the M3 layout model; they are composed by `md-list-detail`,
 * `md-supporting-pane`, or laid out directly in a `md-scaffold` body.
 *
 * A `fixed` pane keeps a constant width ({@link width}); a `flexible` pane
 * grows to fill the remaining space. The host exposes `flex` accordingly so it
 * drops into a flex row without extra wrappers.
 *
 * @slot - The pane content.
 */
export declare class Pane extends LitElement {
    /**
     * Whether the pane is fixed-width or flexible. Reflected so containers and
     * CSS can target `[variant='fixed']` / `[variant='flexible']`.
     */
    variant: PaneVariant;
    /**
     * Width in CSS pixels applied when {@link variant} is `fixed`. Ignored for
     * flexible panes. Defaults to the M3 list-pane width of 360px.
     */
    width: number;
    /** A human-readable name for the pane, exposed as the region's a11y label. */
    paneName: string;
    /**
     * When true, applies an M3 large corner radius to the pane surface (used for
     * explicit containment / emphasis). Reflected for CSS targeting.
     */
    rounded: boolean;
    protected updated(): void;
    protected render(): import("lit-html").TemplateResult<1>;
}
