/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement, nothing } from "lit";
import { property } from "lit/decorators.js";
/**
 * A single destination inside an `<md-navigation-rail>`. Renders the M3 active
 * indicator pill (56×32dp collapsed) around the icon, the label beneath (or
 * inline when the rail is expanded), and an optional badge.
 *
 * Slot an icon into the default slot (e.g. `<md-icon>` or an SVG); optionally
 * slot a distinct `active-icon` shown when selected.
 *
 * @fires navigation-rail-item:activate {Event} Fired when the item is
 *     activated; the parent rail listens for this to update its `value`.
 */
export class NavigationRailItem extends LitElement {
    constructor() {
        super(...arguments);
        /** Identifies this destination within the rail's `value`. */
        this.value = "";
        /** The text label shown beneath (collapsed) or beside (expanded) the icon. */
        this.label = "";
        /** Whether this destination is the active one. Managed by the rail. */
        this.selected = false;
        /** Whether the parent rail is expanded. Managed by the rail. */
        this.expanded = false;
        /** Optional badge text (large badge). A bare presence renders a small dot. */
        this.badgeValue = "";
        /** Renders a small dot badge with no text. */
        this.showBadge = false;
        /** When set, the item renders as a link to this destination. */
        this.href = "";
    }
    connectedCallback() {
        super.connectedCallback();
        this.setAttribute("role", "listitem");
    }
    render() {
        if (this.href !== "") {
            return html `<a
        class="target"
        href=${this.href}
        aria-current=${this.selected ? "page" : nothing}
        @click=${this.activate}
      >
        ${this.renderContent()}
      </a>`;
        }
        return html `<button
      class="target"
      type="button"
      aria-pressed=${this.selected ? "true" : "false"}
      @click=${this.activate}
    >
      ${this.renderContent()}
    </button>`;
    }
    renderContent() {
        return html `
      <span class="indicator">
        <span class="icon">
          <slot name="active-icon" ?hidden=${!this.selected}></slot>
          <slot ?hidden=${this.selected && this.hasActiveIcon()}></slot>
        </span>
        ${this.renderBadge()}
      </span>
      ${this.label ? html `<span class="label">${this.label}</span>` : nothing}
    `;
    }
    renderBadge() {
        if (this.badgeValue) {
            return html `<span class="badge large" aria-hidden="true">${this.badgeValue}</span>`;
        }
        if (this.showBadge) {
            return html `<span class="badge small" aria-hidden="true"></span>`;
        }
        return nothing;
    }
    hasActiveIcon() {
        return this.querySelector('[slot="active-icon"]') !== null;
    }
    activate() {
        this.dispatchEvent(new Event("navigation-rail-item:activate", {
            bubbles: true,
            composed: true,
        }));
    }
}
__decorate([
    property()
], NavigationRailItem.prototype, "value", void 0);
__decorate([
    property()
], NavigationRailItem.prototype, "label", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], NavigationRailItem.prototype, "selected", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], NavigationRailItem.prototype, "expanded", void 0);
__decorate([
    property({ attribute: "badge-value" })
], NavigationRailItem.prototype, "badgeValue", void 0);
__decorate([
    property({ type: Boolean, attribute: "show-badge" })
], NavigationRailItem.prototype, "showBadge", void 0);
__decorate([
    property()
], NavigationRailItem.prototype, "href", void 0);
//# sourceMappingURL=navigation-rail-item.js.map