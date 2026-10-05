/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { mixinDelegatesAria } from "../../../../internal/aria/delegate.js";
import { ripple } from "../ripple/ripple.js";
import { styles as focusRingStyles } from "../focus/focus-ring.cssresult.js";
import { styles as rippleStyles } from "../ripple/ripple.cssresult.js";
import { styles as cardStyles } from "./card.cssresult.js";
import { card } from "./card.js";
// Separate variable needed for closure.
const baseClass = mixinDelegatesAria(LitElement);
/**
 * A Material Design card.
 */
let Card = class Card extends baseClass {
    constructor() {
        super(...arguments);
        /** The color of the card. */
        this.color = "outlined";
        /** Whether the card is disabled. */
        this.disabled = false;
        /** Whether the card is interactive. */
        this.interactive = false;
    }
    /** @nocollapse */
    static { this.shadowRootOptions = {
        mode: "open",
        delegatesFocus: true,
    }; }
    static { this.styles = [
        focusRingStyles,
        rippleStyles,
        cardStyles,
        css `
      :host {
        display: inline-flex;
      }
      .card {
        flex: 1;
      }
    `,
    ]; }
    render() {
        const { ariaLabel } = this;
        return html `<div
      part="card"
      class="${card({
            color: this.color,
            disabled: this.disabled,
            interactive: this.interactive,
        })}"
    >
      ${this.interactive
            ? html `<button
            part="card-btn"
            class="card-btn ripple focus-ring-target"
            ${ripple()}
            ?disabled="${this.disabled}"
            aria-label="${ariaLabel || nothing}"
          ></button>`
            : nothing}
      <slot></slot>
    </div>`;
    }
};
__decorate([
    property()
], Card.prototype, "color", void 0);
__decorate([
    property({ type: Boolean })
], Card.prototype, "disabled", void 0);
__decorate([
    property({ type: Boolean })
], Card.prototype, "interactive", void 0);
Card = __decorate([
    customElement("md-card")
], Card);
export { Card };
//# sourceMappingURL=md-card.js.map