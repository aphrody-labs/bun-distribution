/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * A bottom sheet anchors supplementary content to the bottom edge of the
 * screen. It slides up from the bottom and, when `modal`, dims the rest of the
 * UI with a scrim that closes the sheet when clicked.
 *
 * Implements the Material 3 bottom-sheet spec (drag handle, modal scrim,
 * swipe-down to dismiss) on top of the `--md-sys-*` design tokens, painting its
 * own elevation so it carries no dependency on `md-elevation`.
 *
 * @fires bottom-sheet:opening {Event} Fired when the sheet begins to open.
 * @fires bottom-sheet:opened {Event} Fired once the open animation finishes.
 * @fires bottom-sheet:closing {Event} Fired when the sheet begins to close.
 * @fires bottom-sheet:closed {Event} Fired once the close animation finishes.
 */
export declare class BottomSheet extends LitElement {
    /** Whether the sheet is open. Reflected so CSS can target `[open]`. */
    open: boolean;
    /**
     * When true, renders a scrim that dims the rest of the UI and closes the
     * sheet when clicked, and lets Escape dismiss the sheet.
     */
    modal: boolean;
    private animating;
    private readonly surface;
    private dragStartY;
    private dragDelta;
    private dragging;
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
    private handleDragStart;
    private handleDragMove;
    private handleDragEnd;
    private animateOpen;
}
