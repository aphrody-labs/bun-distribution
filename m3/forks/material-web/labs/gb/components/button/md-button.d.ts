/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative, LitElement } from "lit";
declare global {
    interface HTMLElementTagNameMap {
        /** A Material Design button. */
        "md-button": Button;
    }
}
declare const baseClass: import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<(abstract new (...args: any[]) => import("../../../behaviors/element-internals.js").WithElementInternals) & typeof LitElement & import("../../../behaviors/form-associated.js").FormAssociatedConstructor, import("../../../behaviors/form-associated.js").FormAssociated>, import("../../../behaviors/form-submitter.js").FormSubmitter>>;
/**
 * A Material Design button.
 */
export declare class Button extends baseClass {
    /** @nocollapse */
    static shadowRootOptions: ShadowRootInit;
    static styles: CSSResultOrNative[];
    /**
     * The color of the button.
     */
    color: "filled" | "elevated" | "tonal" | "outlined" | "text";
    /**
     * The size of the button.
     */
    size: "xs" | "sm" | "md" | "lg" | "xl";
    /**
     * Changes the shape of the button to be square.
     */
    square: boolean;
    /**
     * A string indicating the behavior of the button.
     *
     * - "submit" (default): A button that submits its associated form.
     * - "reset": A button that resets its associated form.
     * - "button": A normal button.
     * - "toggle": A toggle button using the `selected` property.
     * - "link": An anchor link (`<a>`). Type is always "link" when `href` is set.
     */
    get type(): string;
    set type(type: string);
    /**
     * Whether or not the button is "soft-disabled" (disabled but still
     * focusable).
     *
     * Use this when a button needs increased visibility when disabled. See
     * https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_disabled_controls
     * for more guidance on when this is needed.
     */
    softDisabled: boolean;
    /**
     * Whether or not the button is selected, when `type="toggle"`.
     */
    selected: boolean;
    /**
     * The URL that the link button points to.
     */
    href: string;
    /**
     * The filename to use when downloading the linked resource.
     * If not specified, the browser will determine a filename.
     * This is only applicable when the button is used as a link (`href` is set).
     */
    download: string;
    /**
     * Where to display the linked `href` URL for a link button. Common options
     * include `_blank` to open in a new tab.
     */
    target: "_blank" | "_parent" | "_self" | "_top" | "";
    protected render(): import("lit-html").TemplateResult<1>;
    private handleChange;
}
export {};
