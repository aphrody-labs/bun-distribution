/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, isServer, LitElement } from "lit";
import { property, state } from "lit/decorators.js";
import { classifyWidth } from "./scaffold.js";
/**
 * Material 3 supporting-pane layout. From the Expanded breakpoint up
 * (>= 840dp), a flexible `main` pane and a fixed ~360px `supporting` pane sit
 * side by side, separated by the 24dp pane spacer (`PANE_SPACER_DP`). Below
 * that, the supporting content stacks beneath the main content — or is hidden
 * entirely when {@link collapsed} is set.
 *
 * The supporting pane is trailing (logical), so the layout mirrors for RTL.
 *
 * @slot main - The primary content pane (flexible, leading).
 * @slot supporting - The supporting content pane (fixed, trailing/stacked).
 */
export class SupportingPane extends LitElement {
    constructor() {
        super(...arguments);
        /** Width in pixels of the fixed supporting pane in side-by-side mode. */
        this.supportingWidth = 360;
        /**
         * When true, the supporting pane is hidden in compact/medium instead of
         * stacking beneath the main content. Reflected for CSS targeting.
         */
        this.collapsed = false;
        /** The resolved window size class. Reflected to `size-class`. */
        this.sizeClass = "compact";
        this.sideBySide = false;
        this.resizeObserver = null;
    }
    /** Whether the panes are laid out side by side (Expanded breakpoint and up). */
    get isSideBySide() {
        return this.sideBySide;
    }
    connectedCallback() {
        super.connectedCallback();
        if (isServer || typeof ResizeObserver === "undefined") {
            return;
        }
        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                this.applyWidth(entry.contentRect.width);
            }
        });
        this.resizeObserver.observe(this);
        this.applyWidth(this.getBoundingClientRect().width);
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }
    applyWidth(width) {
        if (width <= 0) {
            return;
        }
        this.sizeClass = classifyWidth(width);
        this.sideBySide = width >= 840;
    }
    render() {
        const supportingStyle = this.sideBySide
            ? `flex: 0 0 ${this.supportingWidth}px; inline-size: ${this.supportingWidth}px;`
            : "";
        return html `
      <div class="container" part="container">
        <div class="main" part="main">
          <slot name="main"></slot>
        </div>
        <div class="supporting" part="supporting" style=${supportingStyle}>
          <slot name="supporting"></slot>
        </div>
      </div>
    `;
    }
}
__decorate([
    property({ type: Number, attribute: "supporting-width" })
], SupportingPane.prototype, "supportingWidth", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], SupportingPane.prototype, "collapsed", void 0);
__decorate([
    property({ reflect: true, attribute: "size-class" })
], SupportingPane.prototype, "sizeClass", void 0);
__decorate([
    state()
], SupportingPane.prototype, "sideBySide", void 0);
//# sourceMappingURL=supporting-pane.js.map