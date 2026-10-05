/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * Material Design 3 window size class (breakpoint), classifying a container
 * **width** in density-independent pixels (dp).
 *
 * Mirrors the canonical Rust source of truth
 * (`crates/ui/m3-tokens/src/adaptive.rs`, `Breakpoint`):
 *
 * | Class         | Width (dp)  | Panes | Navigation         |
 * |---------------|-------------|-------|--------------------|
 * | `compact`     | `< 600`     | 1     | Navigation bar     |
 * | `medium`      | `600–839`   | 1     | Collapsed nav rail |
 * | `expanded`    | `840–1199`  | 2     | Collapsed nav rail |
 * | `large`       | `1200–1599` | 2     | Expanded nav rail  |
 * | `extra-large` | `>= 1600`   | 3     | Expanded nav rail  |
 */
export type WindowSizeClass = "compact" | "medium" | "expanded" | "large" | "extra-large";
/**
 * Classify a container width (dp/px) into its M3 window size class. The
 * boundaries match `Breakpoint::from_width_dp` in `adaptive.rs` byte-for-byte:
 * `600`, `840`, `1200`, `1600`.
 */
export declare function classifyWidth(width: number): WindowSizeClass;
/** Window margin (dp) for a size class — `16` for compact, `24` otherwise. */
export declare function marginFor(sizeClass: WindowSizeClass): number;
/**
 * The detail surfaced on the `scaffold:size-class-change` event.
 */
export interface ScaffoldSizeClassChangeDetail {
    sizeClass: WindowSizeClass;
    width: number;
}
/**
 * Adaptive page scaffold implementing the M3 "parts of layout" model: bars
 * frame the content, the navigation rail/bar fills the perimeter, and the body
 * holds the panes.
 *
 * The component observes its own width with a {@link ResizeObserver} and
 * reflects the current window size class onto the `size-class` attribute, so
 * authors can style the slots responsively. In `compact`, navigation docks at
 * the bottom (navigation bar); in `medium` and up it docks at the leading edge
 * as a rail.
 *
 * @slot top-bar - Top app bar, pinned to the top across the full width.
 * @slot navigation - Navigation surface. Rendered as a bottom bar in compact,
 *     a leading rail otherwise.
 * @slot - (default) The body / pane region. Scrolls independently.
 * @slot bottom-bar - Optional bottom app bar (compact-oriented), below the body.
 * @slot fab - Floating action button, anchored to the bottom-trailing corner.
 *
 * @fires scaffold:size-class-change {CustomEvent<ScaffoldSizeClassChangeDetail>}
 *     Fired whenever the resolved window size class changes.
 */
export declare class Scaffold extends LitElement {
    /**
     * The current window size class. Reflected to the `size-class` attribute so
     * CSS (and descendant components) can adapt. Computed from the host width;
     * setting it manually is overridden on the next resize.
     */
    sizeClass: WindowSizeClass;
    private resizeObserver;
    connectedCallback(): void;
    disconnectedCallback(): void;
    private updateSizeClass;
    private hasSlot;
    private handleSlotChange;
    protected render(): import("lit").TemplateResult<1>;
}
