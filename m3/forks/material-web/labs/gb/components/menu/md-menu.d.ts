/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative, LitElement } from "lit";
import { type MenuColor } from "./menu.js";
declare global {
    interface HTMLElementTagNameMap {
        /** A Material Design menu component. */
        "md-menu": Menu;
    }
}
declare const baseClass: import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<typeof LitElement, import("../../../behaviors/focusable.js").Focusable>, import("../../../behaviors/element-internals.js").WithElementInternals>;
/**
 * A Material Design menu component.
 */
export declare class Menu extends baseClass {
    static styles: CSSResultOrNative[];
    color: MenuColor;
    get items(): HTMLElement[];
    private previouslyFocused?;
    private readonly itemsSet;
    constructor();
    connectedCallback(): void;
    protected render(): import("lit-html").TemplateResult<1>;
}
export {};
