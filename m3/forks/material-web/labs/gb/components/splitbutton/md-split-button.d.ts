/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative, LitElement } from "lit";
import { type SplitButtonColor, type SplitButtonSize } from "./split-button.js";
declare global {
    interface HTMLElementTagNameMap {
        /** A Material Design split button component. */
        "md-split-button": SplitButton;
    }
}
/**
 * A Material Design split button component.
 */
export declare class SplitButton extends LitElement {
    static styles: CSSResultOrNative[];
    color: SplitButtonColor;
    size: SplitButtonSize;
    selected: boolean;
    protected render(): import("lit-html").TemplateResult<1>;
    private updateSlotFocusVisible;
    private cleanupToggleListener?;
    private handleTrailingSlotchange;
}
