/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
import { type WindowSizeClass } from "./scaffold.js";
/**
 * Material 3 supporting-pane layout. From the Expanded breakpoint up
 * (>= 840dp), a flexible `main` pane and a fixed ~360px `supporting` pane sit
 * side by side, separated by the 24dp pane spacer (`PANE_SPACER_DP`). Below
 * that, the supporting content stacks beneath the main content — or is hidden
 * entirely when {@link collapsed} is set.
 *
 * The supporting pane is trailing (logical), so the layout mirrors for RTL.
 *
 * @slot main - The primary content pane (flexible, leading).
 * @slot supporting - The supporting content pane (fixed, trailing/stacked).
 */
export declare class SupportingPane extends LitElement {
    /** Width in pixels of the fixed supporting pane in side-by-side mode. */
    supportingWidth: number;
    /**
     * When true, the supporting pane is hidden in compact/medium instead of
     * stacking beneath the main content. Reflected for CSS targeting.
     */
    collapsed: boolean;
    /** The resolved window size class. Reflected to `size-class`. */
    sizeClass: WindowSizeClass;
    private sideBySide;
    private resizeObserver;
    /** Whether the panes are laid out side by side (Expanded breakpoint and up). */
    get isSideBySide(): boolean;
    connectedCallback(): void;
    disconnectedCallback(): void;
    private applyWidth;
    protected render(): import("lit-html").TemplateResult<1>;
}
