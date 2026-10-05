/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement } from "lit";
import { property } from "lit/decorators.js";
/**
 * A toolbar groups a set of actions (typically icon buttons) into a single
 * horizontal surface. It implements the Material 3 docked and floating toolbar
 * specs on top of the `--md-sys-*` design tokens, painting its own elevation
 * so it carries no dependency on `md-elevation`.
 *
 * Slot the actions into the default slot:
 *
 * ```html
 * <md-toolbar variant="floating">
 *   <md-icon-button><md-icon>format_bold</md-icon></md-icon-button>
 *   <md-icon-button><md-icon>format_italic</md-icon></md-icon-button>
 * </md-toolbar>
 * ```
 */
export class Toolbar extends LitElement {
    constructor() {
        super(...arguments);
        /**
         * The toolbar variant. Reflected so CSS can target `[variant="floating"]`.
         */
        this.variant = "docked";
    }
    render() {
        return html `
      <div class="toolbar" role="toolbar">
        <slot></slot>
      </div>
    `;
    }
}
__decorate([
    property({ reflect: true })
], Toolbar.prototype, "variant", void 0);
//# sourceMappingURL=toolbar.js.map