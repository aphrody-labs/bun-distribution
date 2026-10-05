/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement, nothing } from "lit";
import { property, queryAssignedElements, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
/**
 * A Material 3 breadcrumb trail. Shows the path of pages leading to the current
 * one as a list of links separated by a customizable separator.
 *
 * Slot the trail items (typically `<md-link>`, `<a>`, or other inline
 * elements) into the default slot, in order from the root to the current page.
 * The separator defaults to `/` and can be overridden with the `separator`
 * property or, for rich content, the `separator` slot.
 *
 * When the number of items exceeds `max-items`, the middle is collapsed behind
 * an ellipsis (`…`) affordance; activating it expands the full trail.
 *
 * Renders a `<nav aria-label>` wrapping an ordered list (`<ol>`) for correct
 * assistive-technology semantics.
 *
 * ```html
 * <md-breadcrumbs aria-label="Breadcrumb" max-items="4">
 *   <md-link href="/">Home</md-link>
 *   <md-link href="/library">Library</md-link>
 *   <md-link href="/library/data">Data</md-link>
 *   <span>Current</span>
 * </md-breadcrumbs>
 * ```
 */
export class Breadcrumbs extends LitElement {
    constructor() {
        super(...arguments);
        /**
         * The separator rendered between items. Defaults to `/`. For rich separators
         * use the `separator` slot instead, which takes precedence.
         */
        this.separator = "/";
        /**
         * The accessible label for the wrapping `<nav>`. Defaults to `Breadcrumb`.
         */
        this.label = "Breadcrumb";
        /**
         * Collapse the trail when it contains more than this many items. The first
         * `items-before-collapse` and last `items-after-collapse` items stay visible
         * with an ellipsis between them. Set to `0` (or a value large enough) to
         * never collapse.
         */
        this.maxItems = 0;
        /** Number of items to show before the collapse ellipsis. */
        this.itemsBeforeCollapse = 1;
        /** Number of items to show after the collapse ellipsis. */
        this.itemsAfterCollapse = 1;
        /** The accessible label for the expand (ellipsis) button. */
        this.expandText = "Show path";
        this.expanded = false;
        this.itemCount = 0;
        /** Whether the trail is currently collapsed behind an ellipsis. */
        this.collapsing = false;
        /** Source indices of the items to render, in order. Derived before render. */
        this.visibleIndices = [];
    }
    willUpdate(changed) {
        // Recompute the collapse layout whenever any input that affects it changes,
        // so render() stays a pure function of derived state.
        if (changed.has("expanded") ||
            changed.has("itemCount") ||
            changed.has("maxItems") ||
            changed.has("itemsBeforeCollapse") ||
            changed.has("itemsAfterCollapse")) {
            const total = this.itemCount;
            this.collapsing =
                !this.expanded &&
                    this.maxItems > 0 &&
                    total > this.maxItems &&
                    total > this.itemsBeforeCollapse + this.itemsAfterCollapse;
            if (this.collapsing) {
                const before = Array.from({ length: Math.max(0, this.itemsBeforeCollapse) }, (_unused, i) => i);
                const after = Array.from({ length: Math.max(0, this.itemsAfterCollapse) }, (_unused, i) => total - this.itemsAfterCollapse + i);
                this.visibleIndices = [...before, ...after];
            }
            else {
                this.visibleIndices = Array.from({ length: total }, (_unused, i) => i);
            }
        }
    }
    render() {
        return html `
      <nav aria-label=${this.label} part="nav">
        <ol class="list" part="list">
          ${this.renderItems(this.visibleIndices, this.collapsing, this.itemCount)}
        </ol>
      </nav>
      <!-- Hidden host slot; items are projected per-index by renderItems. -->
      <slot class="source" @slotchange=${this.handleSlotChange} hidden aria-hidden="true"></slot>
    `;
    }
    renderItems(visible, collapsing, total) {
        const lis = [];
        visible.forEach((index, position) => {
            const atCollapsePoint = collapsing && position === this.itemsBeforeCollapse;
            if (atCollapsePoint) {
                // Insert the ellipsis (with surrounding separators) between the
                // "before" block and the "after" block.
                if (position > 0) {
                    lis.push(this.renderSeparator());
                }
                lis.push(this.renderEllipsis());
                lis.push(this.renderSeparator());
            }
            else if (position > 0) {
                lis.push(this.renderSeparator());
            }
            const isLast = index === total - 1;
            lis.push(html `
        <li class=${classMap({ item: true, current: isLast })} part="item">
          <slot name="item-${index}" aria-current=${isLast ? "page" : nothing}></slot>
        </li>
      `);
        });
        return lis;
    }
    renderSeparator() {
        return html `
      <li class="separator" aria-hidden="true" part="separator">
        <slot name="separator">${this.separator}</slot>
      </li>
    `;
    }
    renderEllipsis() {
        return html `
      <li class="ellipsis-item" part="ellipsis">
        <button
          class="ellipsis"
          type="button"
          aria-label=${this.expandText}
          aria-expanded="false"
          @click=${this.handleExpand}
        >
          …
        </button>
      </li>
    `;
    }
    handleExpand() {
        this.expanded = true;
    }
    handleSlotChange() {
        const els = this.items;
        this.itemCount = els.length;
        // Assign a stable, index-based slot name to each child so the rendered list
        // can place items individually around separators.
        els.forEach((el, i) => {
            el.setAttribute("slot", `item-${i}`);
        });
    }
}
__decorate([
    property()
], Breadcrumbs.prototype, "separator", void 0);
__decorate([
    property({ attribute: "label" })
], Breadcrumbs.prototype, "label", void 0);
__decorate([
    property({ type: Number, attribute: "max-items" })
], Breadcrumbs.prototype, "maxItems", void 0);
__decorate([
    property({ type: Number, attribute: "items-before-collapse" })
], Breadcrumbs.prototype, "itemsBeforeCollapse", void 0);
__decorate([
    property({ type: Number, attribute: "items-after-collapse" })
], Breadcrumbs.prototype, "itemsAfterCollapse", void 0);
__decorate([
    property({ attribute: "expand-text" })
], Breadcrumbs.prototype, "expandText", void 0);
__decorate([
    queryAssignedElements({ flatten: true })
], Breadcrumbs.prototype, "items", void 0);
__decorate([
    state()
], Breadcrumbs.prototype, "expanded", void 0);
__decorate([
    state()
], Breadcrumbs.prototype, "itemCount", void 0);
__decorate([
    state()
], Breadcrumbs.prototype, "collapsing", void 0);
__decorate([
    state()
], Breadcrumbs.prototype, "visibleIndices", void 0);
//# sourceMappingURL=breadcrumbs.js.map