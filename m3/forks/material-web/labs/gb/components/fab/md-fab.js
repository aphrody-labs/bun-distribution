/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styles as focusRingStyles } from "../focus/focus-ring.cssresult.js";
import { styles as rippleStyles } from "../ripple/ripple.cssresult.js";
import { styles as fabStyles } from "./fab.cssresult.js"; // github-only
// import {styles as fabStyles} from './fab.cssresult.js'; // google3-only
import { fab } from "./fab.js";
/**
 * A Material Design fab component.
 */
let Fab = class Fab extends LitElement {
    constructor() {
        super(...arguments);
        this.color = "primary-container";
        this.size = "default";
    }
    static { this.styles = [
        focusRingStyles,
        rippleStyles,
        fabStyles,
        css `
      :host {
        display: inline-flex;
      }
      .fab {
        flex: 1;
      }
    `,
    ]; }
    render() {
        return html `<button part="fab" class="${fab({ color: this.color, size: this.size })}">
      <slot></slot>
    </button>`;
    }
};
__decorate([
    property()
], Fab.prototype, "color", void 0);
__decorate([
    property()
], Fab.prototype, "size", void 0);
Fab = __decorate([
    customElement("md-fab")
], Fab);
export { Fab };
//# sourceMappingURL=md-fab.js.map