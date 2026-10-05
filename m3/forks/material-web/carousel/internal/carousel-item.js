/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement } from "lit";
import { property } from "lit/decorators.js";
/**
 * A single item within an `md-carousel`. It is a rounded, clipped container for
 * an image or arbitrary content, sized by the `size` attribute so the parent
 * carousel can compose its layout.
 */
export class CarouselItem extends LitElement {
    constructor() {
        super(...arguments);
        /** The relative size. Reflected so CSS can target `[size]`. */
        this.size = "large";
        /** When true, this item is the currently snapped or active item in the view. */
        this.active = false;
    }
    render() {
        return html `
      <div class="item">
        <slot></slot>
      </div>
    `;
    }
}
__decorate([
    property({ reflect: true })
], CarouselItem.prototype, "size", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], CarouselItem.prototype, "active", void 0);
//# sourceMappingURL=carousel-item.js.map