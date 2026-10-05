import { __decorate } from "tslib";
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { html, LitElement } from "lit";
import { property } from "lit/decorators.js";
/**
 * A Badge component implementing Material Design 3 guidelines.
 */
export class Badge extends LitElement {
    constructor() {
        super(...arguments);
        /**
         * The text or counter value to display inside the badge.
         * If empty or undefined, the badge renders as a small status dot.
         */
        this.value = "";
        /**
         * If true, forces the badge to render as a small status dot even if value is present.
         * Automatically derives from value if not set.
         */
        this.dot = false;
        /**
         * Helper property to absolutely position the badge at the top-right corner of its parent.
         */
        this.positioned = false;
    }
    willUpdate(changedProperties) {
        if (changedProperties.has("value")) {
            // Auto dot state when value is falsy
            if (!this.dot && !this.value) {
                this.dot = true;
            }
            else if (this.value) {
                this.dot = false;
            }
        }
    }
    render() {
        return html `${this.dot ? "" : this.value}`;
    }
}
__decorate([
    property({ type: String })
], Badge.prototype, "value", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], Badge.prototype, "dot", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], Badge.prototype, "positioned", void 0);
//# sourceMappingURL=badge.js.map