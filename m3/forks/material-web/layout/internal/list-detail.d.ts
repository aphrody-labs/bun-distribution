/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
import { type WindowSizeClass } from "./scaffold.js";
/** Which pane is shown when the layout is single-pane (compact / medium). */
export type ListDetailPane = "list" | "detail";
/** The detail surfaced on the `list-detail:showing-change` event. */
export interface ListDetailShowingChangeDetail {
    showing: ListDetailPane;
    sizeClass: WindowSizeClass;
}
/**
 * Material 3 list-detail canonical layout. From the Expanded breakpoint up
 * (>= 840dp), the list and detail panes appear side by side — a fixed ~360px
 * list leading, a flexible detail trailing — separated by the 24dp pane spacer
 * (`PANE_SPACER_DP` in `adaptive.rs`). In Compact / Medium (< 840dp) only one
 * pane shows at a time; {@link showDetail} / {@link showList} navigate between
 * them.
 *
 * The leading edge is logical (`list` leads), so the layout mirrors correctly
 * for right-to-left languages without extra work.
 *
 * @slot list - The list / index pane (leading).
 * @slot detail - The detail pane (trailing, flexible).
 *
 * @fires list-detail:showing-change {CustomEvent<ListDetailShowingChangeDetail>}
 *     Fired when the visible pane changes in single-pane mode.
 */
export declare class ListDetail extends LitElement {
    /**
     * Which pane is visible in single-pane mode. Reflected so CSS can target
     * `[showing='list']` / `[showing='detail']`. Ignored when both panes are
     * shown (expanded and up).
     */
    showing: ListDetailPane;
    /** Width in pixels of the fixed list pane in dual-pane mode (M3 ~360px). */
    listWidth: number;
    /**
     * The resolved window size class. Reflected to `size-class`. `true` dual-pane
     * threshold is Expanded (>= 840dp) per the M3 list-detail guidance.
     */
    sizeClass: WindowSizeClass;
    private dual;
    private resizeObserver;
    /** Whether both panes are visible side by side (Expanded breakpoint and up). */
    get isDualPane(): boolean;
    /** Shows the detail pane (single-pane mode); no-op in dual-pane mode. */
    showDetail(): void;
    /** Shows the list pane (single-pane mode); no-op in dual-pane mode. */
    showList(): void;
    private setShowing;
    connectedCallback(): void;
    disconnectedCallback(): void;
    private applyWidth;
    protected render(): import("lit-html").TemplateResult<1>;
}
