/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative, LitElement } from "lit";
declare global {
    interface HTMLElementTagNameMap {
        /** A Material Design list item component. */
        "md-list-item": ListItem;
    }
}
declare const baseClass: import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<typeof LitElement, import("../../../behaviors/element-internals.js").WithElementInternals>>;
/**
 * A Material Design list item component.
 */
export declare class ListItem extends baseClass {
    /** @nocollapse */
    static shadowRootOptions: {
        clonable?: boolean;
        customElementRegistry?: CustomElementRegistry | null;
        mode: ShadowRootMode;
        serializable?: boolean;
        slotAssignment?: SlotAssignmentMode;
        delegatesFocus: boolean;
    };
    static styles: CSSResultOrNative[];
    constructor();
    /**
     * Whether the list item is selected.
     */
    checked: boolean;
    /**
     * Whether the list item is disabled.
     */
    disabled: boolean;
    /**
     * Whether the list item is non-interactive.
     */
    nonInteractive: boolean;
    protected render(): import("lit-html").TemplateResult<1>;
    private renderContent;
}
export {};
