/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative, LitElement } from "lit";
import { createValidator, getValidityAnchor } from "../../../behaviors/constraint-validation.js";
import { getFormState, getFormValue } from "../../../behaviors/form-associated.js";
import { CheckboxValidator } from "../../../behaviors/validators/checkbox-validator.js";
declare global {
    interface HTMLElementTagNameMap {
        /** A Material Design switch component. */
        "md-switch": Switch;
    }
}
declare const baseClass: import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<(abstract new (...args: any[]) => import("../../../behaviors/custom-state-set.js").WithCustomStateSet) & (abstract new (...args: any[]) => import("../../../behaviors/element-internals.js").WithElementInternals) & typeof LitElement & import("../../../behaviors/form-associated.js").FormAssociatedConstructor, import("../../../behaviors/form-associated.js").FormAssociated>, import("../../../behaviors/constraint-validation.js").ConstraintValidation>>;
/**
 * A Material Design switch component.
 */
export declare class Switch extends baseClass {
    /** @nocollapse */
    static shadowRootOptions: ShadowRootInit;
    static styles: CSSResultOrNative[];
    /**
     * Puts the switch in the selected state and sets the form submission value to
     * the `value` property.
     */
    get selected(): boolean;
    set selected(value: boolean);
    /**
     * The default selected state of the switch.
     */
    get defaultSelected(): boolean;
    set defaultSelected(value: boolean);
    /**
     * When true, require the switch to be selected when participating in
     * form submission.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/checkbox#validation
     */
    required: boolean;
    /**
     * The value associated with this switch on form submission. `null` is
     * submitted when `selected` is `false`.
     */
    value: string;
    private readonly button;
    /**
     * Mimics the behavior of <input> dirty checkedness, where the `checked`
     * attribute only updates the checked state if the checkbox has not been
     * interacted with.
     *
     * @see https://html.spec.whatwg.org/multipage/input.html#concept-input-checked-dirty-flag
     */
    private dirtyCheckedness;
    protected render(): import("lit-html").TemplateResult<1>;
    private handleChange;
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
    [getFormValue](): string;
    [getFormState](): string;
    formResetCallback(): void;
    formStateRestoreCallback(state: string): void;
    [createValidator](): CheckboxValidator;
    [getValidityAnchor](): HTMLButtonElement;
}
export {};
