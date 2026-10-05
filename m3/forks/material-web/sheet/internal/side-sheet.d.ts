/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * The edge a side sheet docks to. RTL-aware via logical `inset-inline`.
 *
 * - `end` — the trailing edge (right in LTR).
 * - `start` — the leading edge (left in LTR).
 */
export type SideSheetPosition = "end" | "start";
/**
 * A side sheet anchors supplementary content to the leading or trailing edge of
 * the screen. It slides in horizontally and, when `modal`, dims the rest of the
 * UI with a scrim that closes the sheet when clicked.
 *
 * Implements the Material 3 side-sheet spec on top of the `--md-sys-*` design
 * tokens, painting its own elevation so it carries no dependency on
 * `md-elevation`.
 *
 * @fires side-sheet:opening {Event} Fired when the sheet begins to open.
 * @fires side-sheet:opened {Event} Fired once the open animation finishes.
 * @fires side-sheet:closing {Event} Fired when the sheet begins to close.
 * @fires side-sheet:closed {Event} Fired once the close animation finishes.
 */
export declare class SideSheet extends LitElement {
    /** Whether the sheet is open. Reflected so CSS can target `[open]`. */
    open: boolean;
    /**
     * When true, renders a scrim that dims the rest of the UI and closes the
     * sheet when clicked, and lets Escape dismiss the sheet.
     */
    modal: boolean;
    /**
     * The edge the sheet docks to. Reflected so CSS can target `[position]`.
     */
    position: SideSheetPosition;
    private animating;
    private readonly surface;
    /**
     * Opens the sheet. Resolves when the open animation has finished.
     */
    show(): Promise<void>;
    /**
     * Closes the sheet. Resolves once the close animation has finished.
     */
    close(): Promise<void>;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected render(): import("lit-html").TemplateResult<1>;
    private renderScrim;
    private handleScrimClick;
    private readonly handleKeydown;
    private animateOpen;
}
