/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { afterDispatch, setupDispatchHooks } from "../../../../internal/events/dispatch-hooks.js";
import { internals, mixinElementInternals } from "../../../behaviors/element-internals.js";
import { isFocusable, mixinFocusable } from "../../../behaviors/focusable.js";
import { hasSlotted } from "../shared/has-slotted.js";
import { styles as focusRingStyles } from "../focus/focus-ring.cssresult.js";
import { styles as rippleStyles } from "../ripple/ripple.cssresult.js";
import { styles as menuStyles } from "./menu.cssresult.js"; // github-only
// import {styles as menuStyles} from './menu.cssresult.js'; // google3-only
import { menuContext, menuItem, menuItemCheckable, } from "./menu.js";
// Separate variable needed for closure.
const baseClass = mixinElementInternals(mixinFocusable(LitElement));
/**
 * A Material Design menu item component.
 */
let MenuItem = class MenuItem extends baseClass {
    static { this.styles = [
        focusRingStyles,
        rippleStyles,
        menuStyles,
        css `
      :host {
        display: flex;
        outline: none;
      }
      .menu-item {
        flex: 1;
      }
      :is(.menu-item-leading, .menu-item-trailing):not(:has(.has-slotted, .checkmark)) {
        display: none;
      }
      slot:not(.has-slotted) {
        display: contents;
      }
      .checkmark {
        display: flex;
        font: var(--md-icon-size) var(--md-icon-font);
      }
    `,
    ]; }
    get menu() {
        return this.menuContext?.menu || null;
    }
    constructor() {
        super();
        this.checked = false;
        this.disabled = false;
        this[internals].role = "menuitem";
        setupDispatchHooks(this, "click");
        this.addEventListener("click", (e) => {
            if (this.disabled) {
                e.stopImmediatePropagation();
                return;
            }
            const wasChecked = this.checked;
            afterDispatch(e, () => {
                if (e.defaultPrevented)
                    return;
                if (this.checkable) {
                    this.checked = !wasChecked;
                    this.dispatchEvent(new Event("change", { bubbles: true }));
                    this.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
                }
                if (this.checkable !== "multiple") {
                    this.menu?.hidePopover();
                }
            });
        });
        this.addEventListener("keydown", (e) => {
            if (this.disabled)
                return;
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.click();
            }
        });
    }
    connectedCallback() {
        super.connectedCallback();
        this.menuContext?.itemConnected(this);
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.menuContext?.itemDisconnected(this);
    }
    render() {
        return html `<div
      part="menu-item"
      class="${menuItem({
            checked: this.checked,
            disabled: this.disabled,
        })} ripple-host focus-ring-host"
    >
      ${this.renderContent()}
    </div>`;
    }
    renderContent() {
        return html `
      <span class="menu-item-leading">
        <slot name="leading" ${hasSlotted()}>
          ${this.checked ? html `<span class="checkmark">check</span>` : nothing}
        </slot>
      </span>
      <span class="menu-item-content">
        <slot></slot>
        <slot name="supporting-text" class="menu-item-supporting-text"></slot>
      </span>
      <span class="menu-item-trailing">
        <slot name="trailing-text" class="menu-item-trailing-text" ${hasSlotted()}></slot>
        <slot name="trailing" ${hasSlotted()}></slot>
      </span>
    `;
    }
    updated() {
        if (this.checkable === "single") {
            this[internals].role = "menuitemradio";
        }
        else if (this.checkable === "multiple") {
            this[internals].role = "menuitemcheckbox";
        }
        else {
            this[internals].role = "menuitem";
        }
        if (this.checkable) {
            this[internals].ariaChecked = String(this.checked);
        }
        else {
            this[internals].ariaChecked = null;
        }
        this[internals].ariaDisabled = String(this.disabled);
        this[isFocusable] = !this.disabled;
    }
};
__decorate([
    property({ type: Boolean, reflect: true })
], MenuItem.prototype, "checked", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], MenuItem.prototype, "disabled", void 0);
__decorate([
    consume({ context: menuContext, subscribe: true })
], MenuItem.prototype, "menuContext", void 0);
__decorate([
    state(),
    consume({ context: menuItemCheckable, subscribe: true })
], MenuItem.prototype, "checkable", void 0);
MenuItem = __decorate([
    customElement("md-menu-item")
], MenuItem);
export { MenuItem };
//# sourceMappingURL=md-menu-item.js.map