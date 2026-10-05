/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { button } from "../button/button.js";
import { styles as focusRingStyles } from "../focus/focus-ring.cssresult.js";
import { styles as rippleStyles } from "../ripple/ripple.cssresult.js";
import { styles as buttonStyles } from "../button/button.cssresult.js";
import { styles as splitButtonStyles } from "./split-button.cssresult.js"; // github-only
// import {styles as splitButtonStyles} from './split-button.cssresult.js'; // google3-only
import { splitButton } from "./split-button.js";
/**
 * A Material Design split button component.
 */
let SplitButton = class SplitButton extends LitElement {
    constructor() {
        super(...arguments);
        this.color = "filled";
        this.size = "sm";
        this.selected = false;
    }
    static { this.styles = [
        focusRingStyles,
        rippleStyles,
        buttonStyles,
        splitButtonStyles,
        css `
      :host {
        display: inline-flex;
      }
      .split-btn {
        flex: 1;
      }
      [name="leading"] {
        display: contents;
        &::slotted(button) {
          all: inherit;
          display: flex;
        }
      }
      [name="trailing"] {
        position: relative;
        &::slotted(button) {
          position: absolute;
          inset: 0;
          appearance: none;
          background: none;
          border: none;
          outline: none;
        }
      }
    `,
    ]; }
    render() {
        const buttonConfig = {
            color: this.color,
            size: this.size,
        };
        return html `<div part="split-btn" class="${splitButton(this)}">
      <slot
        name="leading"
        part="leading-btn"
        class="${button(buttonConfig)}"
        @focusin=${this.updateSlotFocusVisible}
        @focusout=${this.updateSlotFocusVisible}
      >
      </slot>
      <slot
        name="trailing"
        part="trailing-btn"
        class="${button(buttonConfig)}"
        @focusin=${this.updateSlotFocusVisible}
        @focusout=${this.updateSlotFocusVisible}
        @slotchange=${this.handleTrailingSlotchange}
      >
      </slot>
      <slot></slot>
    </div>`;
    }
    updateSlotFocusVisible(event) {
        const slot = event.currentTarget;
        const hasFocusVisible = slot
            .assignedElements()
            .some((el) => el.matches(":focus-visible,:has(:focus-visible)"));
        slot.classList.toggle("focus-visible", hasFocusVisible);
    }
    handleTrailingSlotchange(event) {
        this.cleanupToggleListener?.abort();
        this.cleanupToggleListener = new AbortController();
        const slot = event.target;
        const trailingButton = slot
            .assignedElements()
            .find((el) => el.matches("button"));
        if (!trailingButton?.popoverTargetElement)
            return;
        trailingButton.popoverTargetElement.addEventListener("toggle", (event) => {
            this.selected = event.newState === "open";
        }, { signal: this.cleanupToggleListener.signal });
    }
};
__decorate([
    property()
], SplitButton.prototype, "color", void 0);
__decorate([
    property()
], SplitButton.prototype, "size", void 0);
__decorate([
    property({ type: Boolean })
], SplitButton.prototype, "selected", void 0);
SplitButton = __decorate([
    customElement("md-split-button")
], SplitButton);
export { SplitButton };
//# sourceMappingURL=md-split-button.js.map