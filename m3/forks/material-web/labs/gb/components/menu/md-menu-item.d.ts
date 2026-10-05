/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative, LitElement } from "lit";
declare global {
    interface HTMLElementTagNameMap {
        "md-menu-item": MenuItem;
    }
}
declare const baseClass: import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<typeof LitElement, import("../../../behaviors/focusable.js").Focusable>, import("../../../behaviors/element-internals.js").WithElementInternals>;
/**
 * A Material Design menu item component.
 */
export declare class MenuItem extends baseClass {
    static styles: CSSResultOrNative[];
    checked: boolean;
    disabled: boolean;
    get menu(): HTMLElement | null;
    private readonly menuContext?;
    private readonly checkable?;
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected render(): import("lit-html").TemplateResult<1>;
    private renderContent;
    protected updated(): void;
}
export {};
