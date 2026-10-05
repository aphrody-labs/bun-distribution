/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, isServer, LitElement } from "lit";
import { property, state } from "lit/decorators.js";
/**
 * A top app bar displays navigation, actions, and the title of the current
 * screen at the top of a layout. Implements the four Material 3 variants and
 * the on-scroll container-color fill.
 *
 * Slot a leading nav affordance into `slot="leading"`, the title into the
 * default slot, and trailing actions into `slot="trailing"`.
 */
export class TopAppBar extends LitElement {
    constructor() {
        super(...arguments);
        /** The bar layout variant. */
        this.variant = "small";
        /**
         * A scrollable element whose scroll position drives the on-scroll fill. When
         * unset, the bar listens to the document scroll. Provide the element (not a
         * selector).
         */
        this.scrollTarget = null;
        this.scrolled = false;
        this.handleScroll = () => {
            const top = this.scrollTarget ? this.scrollTarget.scrollTop : window.scrollY;
            const scrolled = top > 0;
            if (scrolled !== this.scrolled) {
                this.scrolled = scrolled;
            }
        };
    }
    connectedCallback() {
        super.connectedCallback();
        this.setAttribute("role", "banner");
        if (!isServer) {
            this.attachScroll();
        }
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.detachScroll();
    }
    updated(changed) {
        if (changed.has("scrollTarget")) {
            this.detachScroll();
            this.attachScroll();
        }
    }
    get scroller() {
        return this.scrollTarget ?? window;
    }
    /**
     * Prefer the CSS scroll-driven animation (declarative, runs off the main
     * thread). Only fall back to a JS scroll listener when a custom scroll target
     * is set (which CSS `scroll()` can't reference) or the browser lacks
     * scroll-driven-animation support. The `js-scroll` attribute disables the CSS
     * path so the two never fight.
     */
    attachScroll() {
        const cssDriven = !this.scrollTarget &&
            typeof CSS !== "undefined" &&
            CSS.supports("(animation-timeline: scroll()) and (animation-range: 0% 100%)");
        if (cssDriven) {
            this.removeAttribute("js-scroll");
            return;
        }
        this.setAttribute("js-scroll", "");
        this.scroller.addEventListener("scroll", this.handleScroll, {
            passive: true,
        });
        this.handleScroll();
    }
    detachScroll() {
        this.scroller.removeEventListener("scroll", this.handleScroll);
    }
    render() {
        const twoLine = this.variant === "medium" || this.variant === "large";
        return html `
      <header class="bar ${this.scrolled ? "scrolled" : ""}" part="bar">
        <div class="row">
          <span class="leading"><slot name="leading"></slot></span>
          ${twoLine
            ? html `<span class="spacer"></span>`
            : html `<h1 class="headline inline"><slot></slot></h1>`}
          <span class="trailing"><slot name="trailing"></slot></span>
        </div>
        ${twoLine ? html `<h1 class="headline block"><slot></slot></h1>` : ""}
      </header>
    `;
    }
}
__decorate([
    property({ reflect: true })
], TopAppBar.prototype, "variant", void 0);
__decorate([
    property({ attribute: false })
], TopAppBar.prototype, "scrollTarget", void 0);
__decorate([
    state()
], TopAppBar.prototype, "scrolled", void 0);
//# sourceMappingURL=top-app-bar.js.map