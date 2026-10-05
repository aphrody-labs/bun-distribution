/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { mixinDelegatesAria } from "../../../../internal/aria/delegate.js";
import { redispatchEvent } from "../../../../internal/events/redispatch-event.js";
import { createValidator, getValidityAnchor, mixinConstraintValidation, } from "../../../behaviors/constraint-validation.js";
import { hasState, mixinCustomStateSet, toggleState } from "../../../behaviors/custom-state-set.js";
import { mixinElementInternals } from "../../../behaviors/element-internals.js";
import { getFormState, getFormValue, mixinFormAssociated, } from "../../../behaviors/form-associated.js";
import { CheckboxValidator } from "../../../behaviors/validators/checkbox-validator.js";
import { hasSlotted } from "../shared/has-slotted.js";
import { styles as focusRingStyles } from "../focus/focus-ring.cssresult.js";
import { styles as rippleStyles } from "../ripple/ripple.cssresult.js";
import { styles as switchStyles } from "./switch.cssresult.js";
import { switchToggle } from "./switch.js";
// Separate variable needed for closure.
const baseClass = mixinDelegatesAria(mixinConstraintValidation(mixinFormAssociated(mixinCustomStateSet(mixinElementInternals(LitElement)))));
/**
 * A Material Design switch component.
 */
let Switch = class Switch extends baseClass {
    constructor() {
        super(...arguments);
        /**
         * When true, require the switch to be selected when participating in
         * form submission.
         *
         * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/checkbox#validation
         */
        this.required = false;
        /**
         * The value associated with this switch on form submission. `null` is
         * submitted when `selected` is `false`.
         */
        this.value = "on";
        /**
         * Mimics the behavior of <input> dirty checkedness, where the `checked`
         * attribute only updates the checked state if the checkbox has not been
         * interacted with.
         *
         * @see https://html.spec.whatwg.org/multipage/input.html#concept-input-checked-dirty-flag
         */
        this.dirtyCheckedness = false;
    }
    /** @nocollapse */
    static { this.shadowRootOptions = {
        mode: "open",
        delegatesFocus: true,
    }; }
    static { this.styles = [
        focusRingStyles,
        rippleStyles,
        switchStyles,
        css `
      :host {
        display: inline-flex;
      }
      .switch {
        flex: 1;
      }
      ::slotted(*) {
        grid-area: handle;
      }
    `,
    ]; }
    /**
     * Puts the switch in the selected state and sets the form submission value to
     * the `value` property.
     */
    get selected() {
        return this[hasState]("selected");
    }
    set selected(value) {
        this[toggleState]("selected", value);
    }
    /**
     * The default selected state of the switch.
     */
    get defaultSelected() {
        return this.hasAttribute("selected");
    }
    set defaultSelected(value) {
        this.toggleAttribute("selected", value || false);
    }
    render() {
        const { ariaLabel } = this;
        return html `
      <button
        role="switch"
        part="switch"
        class="${switchToggle()}"
        aria-checked="${this.selected ? "true" : "false"}"
        aria-label=${ariaLabel || nothing}
        ?disabled=${this.disabled}
        @change=${this.handleChange}
      >
        <slot name="off-icon" class="switch-icon-off" ${hasSlotted()}></slot>
        <slot name="on-icon" class="switch-icon-on"></slot>
      </button>
    `;
    }
    handleChange(event) {
        this.dirtyCheckedness = true;
        this.selected = this.button?.ariaChecked === "true";
        // Change event is not composed, re-dispatch it.
        redispatchEvent(this, event);
    }
    attributeChangedCallback(name, oldValue, newValue) {
        if (name === "selected" && this.dirtyCheckedness) {
            // The 'selected' attribute does not update switches that have been
            // interacted with.
            return;
        }
        super.attributeChangedCallback(name, oldValue, newValue);
    }
    [getFormValue]() {
        return this.selected ? this.value : null;
    }
    [getFormState]() {
        return String(this.selected);
    }
    formResetCallback() {
        this.dirtyCheckedness = false;
        this.selected = this.defaultSelected;
    }
    formStateRestoreCallback(state) {
        this.selected = state === "true";
    }
    [createValidator]() {
        return new CheckboxValidator(() => ({
            checked: this.selected,
            required: this.required,
        }));
    }
    [getValidityAnchor]() {
        return this.button;
    }
};
__decorate([
    property({ type: Boolean })
], Switch.prototype, "selected", null);
__decorate([
    property({ type: Boolean })
], Switch.prototype, "required", void 0);
__decorate([
    property()
], Switch.prototype, "value", void 0);
__decorate([
    query("button", true)
], Switch.prototype, "button", void 0);
Switch = __decorate([
    customElement("md-switch")
], Switch);
export { Switch };
//# sourceMappingURL=md-switch.js.map