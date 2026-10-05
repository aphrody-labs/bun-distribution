/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative, LitElement } from "lit";
declare global {
    interface HTMLElementTagNameMap {
        /** A Material Design list component. */
        "md-list": List;
    }
}
declare const baseClass: import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<typeof LitElement, import("../../../behaviors/element-internals.js").WithElementInternals>;
/**
 * A Material Design list component.
 */
export declare class List extends baseClass {
    static styles: CSSResultOrNative[];
    constructor();
    /**
     * Whether to render the list with segmented items.
     */
    segmented: boolean;
    protected render(): import("lit-html").TemplateResult<1>;
}
export {};
