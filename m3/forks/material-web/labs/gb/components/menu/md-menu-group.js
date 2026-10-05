/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { consume, provide } from "@lit/context";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { internals, mixinElementInternals } from "../../../behaviors/element-internals.js";
import { menuContext, menuItemCheckable, } from "./menu.js";
// Separate variable needed for closure.
const baseClass = mixinElementInternals(LitElement);
/**
 * A Material Design menu group component.
 */
let MenuGroup = class MenuGroup extends baseClass {
    static { this.styles = [
        css `
      :host {
        display: contents;
      }
    `,
    ]; }
    // TODO: add optional section label
    get menu() {
        return this.menuContext?.menu || null;
    }
    get items() {
        return (this.menuContext?.getItems?.() || []).filter((item) => this.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_CONTAINED_BY);
    }
    constructor() {
        super();
        this.checkable = null;
        this.menuContext = null;
        this[internals].role = "none";
        this.addEventListener("change", (event) => {
            if (this.checkable === "single") {
                const composedPath = event.composedPath();
                const items = this.items;
                for (const item of items) {
                    if (!composedPath.includes(item) && item.checked) {
                        item.checked = false;
                    }
                }
            }
        });
    }
    render() {
        return html `<slot></slot>`;
    }
};
__decorate([
    provide({ context: menuItemCheckable }),
    property({ reflect: true })
], MenuGroup.prototype, "checkable", void 0);
__decorate([
    consume({ context: menuContext, subscribe: true })
], MenuGroup.prototype, "menuContext", void 0);
MenuGroup = __decorate([
    customElement("md-menu-group")
], MenuGroup);
export { MenuGroup };
//# sourceMappingURL=md-menu-group.js.map