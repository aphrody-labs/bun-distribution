import { __decorate } from "tslib";
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { html, LitElement } from "lit";
import { property } from "lit/decorators.js";
/**
 * A Card component implementing Material Design 3 guidelines.
 */
export class Card extends LitElement {
    constructor() {
        super(...arguments);
        /**
         * The variant of the card.
         * Supported: 'elevated', 'filled', 'outlined'.
         */
        this.variant = "elevated";
        /**
         * If true, makes the card interactive and adds hover/active state visual effects.
         */
        this.clickable = false;
    }
    render() {
        return html `
      <div class="card-container">
        <slot name="media"></slot>
        <div class="card-content-area">
          <slot></slot>
        </div>
        <slot name="actions"></slot>
      </div>
    `;
    }
}
__decorate([
    property({ type: String, reflect: true })
], Card.prototype, "variant", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], Card.prototype, "clickable", void 0);
//# sourceMappingURL=card.js.map