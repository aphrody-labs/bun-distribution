/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { mixinDelegatesAria } from "../../../../internal/aria/delegate.js";
import { redispatchEvent } from "../../../../internal/events/redispatch-event.js";
import { mixinElementInternals } from "../../../behaviors/element-internals.js";
import { mixinFormAssociated } from "../../../behaviors/form-associated.js";
import { mixinFormSubmitter } from "../../../behaviors/form-submitter.js";
import { styles as focusRingStyles } from "../focus/focus-ring.cssresult.js";
import { styles as rippleStyles } from "../ripple/ripple.cssresult.js";
import { styles as buttonStyles } from "./button.cssresult.js";
import { button } from "./button.js";
// Separate variable needed for closure.
const baseClass = mixinDelegatesAria(mixinFormSubmitter(mixinFormAssociated(mixinElementInternals(LitElement))));
/**
 * A Material Design button.
 */
let Button = class Button extends baseClass {
    constructor() {
        super(...arguments);
        /**
         * The color of the button.
         */
        this.color = "text";
        /**
         * The size of the button.
         */
        this.size = "sm";
        /**
         * Changes the shape of the button to be square.
         */
        this.square = false;
        /**
         * Whether or not the button is "soft-disabled" (disabled but still
         * focusable).
         *
         * Use this when a button needs increased visibility when disabled. See
         * https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_disabled_controls
         * for more guidance on when this is needed.
         */
        this.softDisabled = false;
        /**
         * Whether or not the button is selected, when `type="toggle"`.
         */
        this.selected = false;
        /**
         * The URL that the link button points to.
         */
        this.href = "";
        /**
         * The filename to use when downloading the linked resource.
         * If not specified, the browser will determine a filename.
         * This is only applicable when the button is used as a link (`href` is set).
         */
        this.download = "";
        /**
         * Where to display the linked `href` URL for a link button. Common options
         * include `_blank` to open in a new tab.
         */
        this.target = "";
    }
    /** @nocollapse */
    static { this.shadowRootOptions = {
        mode: "open",
        delegatesFocus: true,
    }; }
    static { this.styles = [
        focusRingStyles,
        rippleStyles,
        buttonStyles,
        css `
      :host {
        display: inline-flex;
      }
      .btn {
        flex: 1;
      }
    `,
    ]; }
    /**
     * A string indicating the behavior of the button.
     *
     * - "submit" (default): A button that submits its associated form.
     * - "reset": A button that resets its associated form.
     * - "button": A normal button.
     * - "toggle": A toggle button using the `selected` property.
     * - "link": An anchor link (`<a>`). Type is always "link" when `href` is set.
     */
    get type() {
        return this.href ? "link" : super.type;
    }
    set type(type) {
        if (this.href && type !== "link") {
            return;
        }
        super.type = type;
    }
    render() {
        const classes = button({
            color: this.color,
            size: this.size,
            square: this.square,
            // Emulate `:disabled` when soft-disabled
            disabled: this.softDisabled,
        });
        // Needed for closure conformance
        const { ariaLabel, ariaHasPopup, ariaExpanded } = this;
        if (this.type === "link") {
            return html `<a
        part="btn"
        class=${classes}
        href=${this.href}
        download=${this.download || nothing}
        target=${this.target || nothing}
        aria-label=${ariaLabel || nothing}
        aria-haspopup=${ariaHasPopup || nothing}
        aria-expanded=${ariaExpanded || nothing}
        aria-disabled=${this.disabled || this.softDisabled || nothing}
        tabindex=${this.disabled && !this.softDisabled ? -1 : nothing}
      >
        <slot></slot>
      </a>`;
        }
        return html `<button
      part="btn"
      class=${classes}
      ?disabled=${this.disabled}
      aria-disabled=${this.softDisabled || nothing}
      aria-label=${ariaLabel || nothing}
      aria-pressed=${this.type === "toggle" ? this.selected : nothing}
      aria-haspopup=${ariaHasPopup || nothing}
      aria-expanded=${ariaExpanded || nothing}
      @change=${this.handleChange}
    >
      <slot></slot>
    </button>`;
    }
    handleChange(event) {
        this.selected = event.target.ariaPressed === "true";
        redispatchEvent(this, event);
    }
};
__decorate([
    property()
], Button.prototype, "color", void 0);
__decorate([
    property()
], Button.prototype, "size", void 0);
__decorate([
    property({ type: Boolean })
], Button.prototype, "square", void 0);
__decorate([
    property({ noAccessor: true })
], Button.prototype, "type", null);
__decorate([
    property({ type: Boolean, attribute: "soft-disabled", reflect: true })
], Button.prototype, "softDisabled", void 0);
__decorate([
    property({ type: Boolean })
], Button.prototype, "selected", void 0);
__decorate([
    property()
], Button.prototype, "href", void 0);
__decorate([
    property()
], Button.prototype, "download", void 0);
__decorate([
    property()
], Button.prototype, "target", void 0);
Button = __decorate([
    customElement("md-button")
], Button);
export { Button };
//# sourceMappingURL=md-button.js.map