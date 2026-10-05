/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative, LitElement } from "lit";
declare global {
    interface HTMLElementTagNameMap {
        /** A Material Design divider component. */
        "md-divider": Divider;
    }
}
/**
 * A Material Design divider component.
 */
export declare class Divider extends LitElement {
    static styles: CSSResultOrNative[];
    /**
     * Whether or not the divider is vertical.
     */
    vertical: boolean;
    protected render(): import("lit-html").TemplateResult<1>;
}
