/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement } from "lit";
import { property } from "lit/decorators.js";
/**
 * A navigation rail lets people switch between UI views on mid-sized devices.
 * It implements the Material 3 collapsed (80dp) and expanded (≥220dp) variants
 * with optional leading menu button and FAB slots.
 *
 * Slot `menu` for a leading menu/hamburger affordance, `fab` for a FAB or
 * extended FAB, and the default slot for `<md-navigation-rail-item>`s.
 *
 * @fires navigation-rail:change {CustomEvent<{value: string}>} Fired when the
 *     active item changes, with the newly-selected item's `value`.
 */
export class NavigationRail extends LitElement {
    constructor() {
        super(...arguments);
        /** Expands the rail to its wide layout with inline labels. */
        this.expanded = false;
        /** Vertical placement of the items group. */
        this.alignment = "top";
        /**
         * The `value` of the currently-selected item. Two-way: set it to select an
         * item, read it after a `navigation-rail:change`.
         */
        this.value = "";
        this.handleActivate = (event) => {
            const item = event.target;
            if (!item || item.value === undefined) {
                return;
            }
            this.value = item.value;
            this.dispatchEvent(new CustomEvent("navigation-rail:change", {
                detail: { value: this.value },
                bubbles: true,
                composed: true,
            }));
        };
    }
    connectedCallback() {
        super.connectedCallback();
        this.setAttribute("role", "navigation");
        this.addEventListener("navigation-rail-item:activate", this.handleActivate);
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.removeEventListener("navigation-rail-item:activate", this.handleActivate);
    }
    updated(changed) {
        if (changed.has("value") || changed.has("expanded")) {
            this.syncItems();
        }
    }
    get items() {
        return Array.from(this.querySelectorAll("md-navigation-rail-item"));
    }
    syncItems() {
        for (const item of this.items) {
            item.selected = item.value !== "" && item.value === this.value;
            item.expanded = this.expanded;
        }
    }
    render() {
        return html `
      <div class="rail" part="rail">
        <div class="leading">
          <slot name="menu"></slot>
          <slot name="fab"></slot>
        </div>
        <div class="items" role="list">
          <slot @slotchange=${this.syncItems}></slot>
        </div>
      </div>
    `;
    }
}
__decorate([
    property({ type: Boolean, reflect: true })
], NavigationRail.prototype, "expanded", void 0);
__decorate([
    property({ reflect: true })
], NavigationRail.prototype, "alignment", void 0);
__decorate([
    property()
], NavigationRail.prototype, "value", void 0);
//# sourceMappingURL=navigation-rail.js.map