/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, isServer, LitElement } from "lit";
import { property, queryAssignedElements } from "lit/decorators.js";
import { ExpansionPanel } from "./expansion-panel.js";
/**
 * A Material 3 accordion: a container of `md-expansion-panel` children. In the
 * default single-expand mode the accordion listens for each panel's
 * `expansion:toggle` event and collapses the other panels when one opens. Set
 * `multi` to let several panels stay open simultaneously.
 *
 * Slot:
 * - default — the `md-expansion-panel` children.
 */
export class Accordion extends LitElement {
    constructor() {
        super(...arguments);
        /**
         * When true, multiple panels may be expanded at once. When false (default),
         * opening one panel collapses any other open panel.
         */
        this.multi = false;
        this.handleToggle = (event) => {
            if (this.multi) {
                return;
            }
            const detail = event.detail;
            if (!detail || !detail.expanded) {
                return;
            }
            const opened = event.target;
            for (const panel of this.expansionPanels()) {
                if (panel !== opened && panel.expanded) {
                    panel.collapse();
                }
            }
        };
    }
    connectedCallback() {
        super.connectedCallback();
        if (!isServer) {
            this.addEventListener("expansion:toggle", this.handleToggle);
        }
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        if (!isServer) {
            this.removeEventListener("expansion:toggle", this.handleToggle);
        }
    }
    /** Returns the slotted `md-expansion-panel` children. */
    expansionPanels() {
        return this.items.filter((el) => el instanceof ExpansionPanel);
    }
    render() {
        return html `<slot role="presentation"></slot>`;
    }
}
__decorate([
    property({ type: Boolean, reflect: true })
], Accordion.prototype, "multi", void 0);
__decorate([
    queryAssignedElements({ flatten: true })
], Accordion.prototype, "items", void 0);
//# sourceMappingURL=accordion.js.map