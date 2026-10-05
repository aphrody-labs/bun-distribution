/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { internals, mixinElementInternals } from "../../../behaviors/element-internals.js";
import { styles as listStyles } from "./list.cssresult.js"; // github-only
// import {styles as listStyles} from './list.cssresult.js'; // google3-only
import { list } from "./list.js";
// Separate variable needed for closure.
const baseClass = mixinElementInternals(LitElement);
/**
 * A Material Design list component.
 */
let List = class List extends baseClass {
    static { this.styles = [
        listStyles,
        css `
      :host {
        display: flex;
      }
      .list {
        flex: 1;
      }
    `,
    ]; }
    constructor() {
        super();
        /**
         * Whether to render the list with segmented items.
         */
        this.segmented = false;
        this[internals].role = "list";
    }
    render() {
        return html `<div part="list" class="${list(this)}">
      <slot></slot>
    </div>`;
    }
};
__decorate([
    property({ type: Boolean })
], List.prototype, "segmented", void 0);
List = __decorate([
    customElement("md-list")
], List);
export { List };
//# sourceMappingURL=md-list.js.map