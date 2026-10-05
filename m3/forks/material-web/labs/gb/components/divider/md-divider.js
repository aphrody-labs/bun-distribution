/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styles as dividerStyles } from "./divider.cssresult.js"; // github-only
// import {styles as dividerStyles} from './divider.cssresult.js'; // google3-only
import { divider } from "./divider.js";
/**
 * A Material Design divider component.
 */
let Divider = class Divider extends LitElement {
    constructor() {
        super(...arguments);
        /**
         * Whether or not the divider is vertical.
         */
        this.vertical = false;
    }
    static { this.styles = [
        dividerStyles,
        css `
      :host {
        display: flex;
      }
      .divider {
        flex: 1;
      }
      :host(:not([vertical])) {
        width: 100%;
      }
      :host([vertical]) {
        min-height: 100%;
      }
    `,
    ]; }
    render() {
        return html `<div part="divider" class="${divider(this)}"></div>`;
    }
};
__decorate([
    property({ type: Boolean, reflect: true })
], Divider.prototype, "vertical", void 0);
Divider = __decorate([
    customElement("md-divider")
], Divider);
export { Divider };
//# sourceMappingURL=md-divider.js.map