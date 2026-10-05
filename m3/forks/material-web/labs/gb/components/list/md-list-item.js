/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { mixinDelegatesAria } from "../../../../internal/aria/delegate.js";
import { internals, mixinElementInternals, } from "../../../behaviors/element-internals.js";
import { hasSlotted } from "../shared/has-slotted.js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styles as focusRingStyles } from "../focus/focus-ring.cssresult.js"; // github-only
// import {styles as focusRingStyles} from '../focus/focus-ring.cssresult.js'; // google3-only
import { styles as rippleStyles } from "../ripple/ripple.cssresult.js"; // github-only
// import {styles as rippleStyles} from '../ripple/ripple.cssresult.js'; // google3-only
import { styles as listStyles } from "./list.cssresult.js"; // github-only
// import {styles as listStyles} from './list.cssresult.js'; // google3-only
import { listItem } from "./list.js";
// Separate variable needed for closure.
const baseClass = mixinDelegatesAria(mixinElementInternals(LitElement));
/**
 * A Material Design list item component.
 */
let ListItem = class ListItem extends baseClass {
    /** @nocollapse */
    static { this.shadowRootOptions = {
        ...LitElement.shadowRootOptions,
        delegatesFocus: true,
    }; }
    static { this.styles = [
        focusRingStyles,
        rippleStyles,
        listStyles,
        css `
      :host {
        display: flex;
        align-items: center;
      }
      .list-item {
        flex: 1;
        align-items: inherit;
      }
      :is(.list-item-leading, .list-item-trailing):not(:has(.has-slotted)) {
        display: none;
      }
      slot:not(.has-slotted) {
        display: contents;
      }
    `,
    ]; }
    constructor() {
        super();
        /**
         * Whether the list item is selected.
         */
        this.checked = false;
        /**
         * Whether the list item is disabled.
         */
        this.disabled = false;
        /**
         * Whether the list item is non-interactive.
         */
        this.nonInteractive = false;
        this[internals].role = "listitem";
    }
    render() {
        const state = {
            checked: this.checked,
            disabled: this.disabled,
            static: this.nonInteractive,
        };
        if (this.nonInteractive) {
            return html `<div part="list-item" class="${listItem(state)}">${this.renderContent()}</div>`;
        }
        // Needed for closure conformance
        const { ariaLabel } = this;
        return html `<button
      part="list-item"
      class="${listItem(state)}"
      ?disabled=${this.disabled}
      aria-label=${ariaLabel || nothing}
    >
      ${this.renderContent()}
    </button>`;
    }
    renderContent() {
        return html `
      <span class="list-item-leading">
        <slot name="avatar" class="list-item-avatar" ${hasSlotted()}></slot>
        <slot name="leading" ${hasSlotted()}></slot>
      </span>
      <span class="list-item-content">
        <slot name="overline" class="list-item-overline"></slot>
        <slot></slot>
        <slot name="supporting-text" class="list-item-supporting-text"></slot>
      </span>
      <span class="list-item-trailing">
        <slot name="trailing-text" class="list-item-trailing-text" ${hasSlotted()}></slot>
        <slot name="trailing" ${hasSlotted()}></slot>
      </span>
    `;
    }
};
__decorate([
    property({ type: Boolean })
], ListItem.prototype, "checked", void 0);
__decorate([
    property({ type: Boolean })
], ListItem.prototype, "disabled", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: "static" })
], ListItem.prototype, "nonInteractive", void 0);
ListItem = __decorate([
    customElement("md-list-item")
], ListItem);
export { ListItem };
//# sourceMappingURL=md-list-item.js.map