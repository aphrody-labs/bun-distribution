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
import focusRingStyles from "../focus/focus-ring.cssresult.js";
import rippleStyles from "../ripple/ripple.cssresult.js";
import iconButtonStyles from "./icon-button.cssresult.js";
import { iconButton } from "./icon-button.js";
const baseClass = mixinDelegatesAria(mixinFormSubmitter(mixinFormAssociated(mixinElementInternals(LitElement))));
/**
 * A Material Design icon button component.
 */
let IconButton = class IconButton extends baseClass {
    constructor() {
        super(...arguments);
        /**
         * The color of the button.
         */
        this.color = "standard";
        /**
         * The size of the button.
         */
        this.size = "sm";
        /**
         * Changes the shape of the button to be square.
         */
        this.square = false;
        /**
         * Changes the width of the button.
         */
        this.width = "";
        /**
         * Whether or not the button is "soft-disabled" (disabled but still
         * focusable).
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
         */
        this.download = "";
        /**
         * Where to display the linked `href` URL for a link button.
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
        iconButtonStyles,
        css `
      :host {
        display: inline-flex;
      }
      .icon-btn {
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
        const classes = iconButton({
            color: this.color,
            size: this.size,
            width: this.width,
            square: this.square,
            disabled: this.softDisabled,
        });
        const { ariaLabel, ariaHasPopup, ariaExpanded } = this;
        if (this.type === "link") {
            return html `<a
        part="icon-btn"
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
      part="icon-btn"
      class=${classes}
      type="button"
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
], IconButton.prototype, "color", void 0);
__decorate([
    property()
], IconButton.prototype, "size", void 0);
__decorate([
    property({ type: Boolean })
], IconButton.prototype, "square", void 0);
__decorate([
    property()
], IconButton.prototype, "width", void 0);
__decorate([
    property({ noAccessor: true })
], IconButton.prototype, "type", null);
__decorate([
    property({ type: Boolean, attribute: "soft-disabled", reflect: true })
], IconButton.prototype, "softDisabled", void 0);
__decorate([
    property({ type: Boolean })
], IconButton.prototype, "selected", void 0);
__decorate([
    property()
], IconButton.prototype, "href", void 0);
__decorate([
    property()
], IconButton.prototype, "download", void 0);
__decorate([
    property()
], IconButton.prototype, "target", void 0);
IconButton = __decorate([
    customElement("md-icon-button")
], IconButton);
export { IconButton };
//# sourceMappingURL=md-icon-button.js.map