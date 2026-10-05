/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement } from "lit";
import { property } from "lit/decorators.js";
/**
 * A single Material 3 layout pane: a self-contained content surface with
 * padding and independent scrolling. Panes are the only place content lives in
 * the M3 layout model; they are composed by `md-list-detail`,
 * `md-supporting-pane`, or laid out directly in a `md-scaffold` body.
 *
 * A `fixed` pane keeps a constant width ({@link width}); a `flexible` pane
 * grows to fill the remaining space. The host exposes `flex` accordingly so it
 * drops into a flex row without extra wrappers.
 *
 * @slot - The pane content.
 */
export class Pane extends LitElement {
    constructor() {
        super(...arguments);
        /**
         * Whether the pane is fixed-width or flexible. Reflected so containers and
         * CSS can target `[variant='fixed']` / `[variant='flexible']`.
         */
        this.variant = "flexible";
        /**
         * Width in CSS pixels applied when {@link variant} is `fixed`. Ignored for
         * flexible panes. Defaults to the M3 list-pane width of 360px.
         */
        this.width = 360;
        /** A human-readable name for the pane, exposed as the region's a11y label. */
        this.paneName = "";
        /**
         * When true, applies an M3 large corner radius to the pane surface (used for
         * explicit containment / emphasis). Reflected for CSS targeting.
         */
        this.rounded = false;
    }
    updated() {
        // Drive layout from the resolved variant so the host participates in a flex
        // row directly (fixed = constant basis, flexible = grow).
        if (this.variant === "fixed") {
            this.style.flex = `0 0 ${this.width}px`;
            this.style.inlineSize = `${this.width}px`;
        }
        else {
            this.style.flex = "1 1 0%";
            this.style.inlineSize = "";
        }
    }
    render() {
        return html `
      <section class="pane" part="pane" role="region" aria-label=${this.paneName || "pane"}>
        <slot></slot>
      </section>
    `;
    }
}
__decorate([
    property({ reflect: true })
], Pane.prototype, "variant", void 0);
__decorate([
    property({ type: Number })
], Pane.prototype, "width", void 0);
__decorate([
    property({ attribute: "pane-name" })
], Pane.prototype, "paneName", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], Pane.prototype, "rounded", void 0);
//# sourceMappingURL=pane.js.map