/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative, LitElement } from "lit";
import { type MenuItemCheckable } from "./menu.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-menu-group": MenuGroup;
    }
}
declare const baseClass: import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<typeof LitElement, import("../../../behaviors/element-internals.js").WithElementInternals>;
/**
 * A Material Design menu group component.
 */
export declare class MenuGroup extends baseClass {
    static styles: CSSResultOrNative[];
    checkable: MenuItemCheckable | null;
    get menu(): HTMLElement | null;
    get items(): HTMLElement[];
    private readonly menuContext;
    constructor();
    protected render(): import("lit-html").TemplateResult<1>;
}
export {};
