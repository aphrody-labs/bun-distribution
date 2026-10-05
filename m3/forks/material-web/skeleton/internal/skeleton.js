/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement } from "lit";
import { property, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
/**
 * A skeleton displays a placeholder preview of content before the data loads,
 * reducing perceived latency. Equivalent to MUI's `Skeleton`.
 *
 * Set `variant` for the shape, `width`/`height` for the dimensions (numbers are
 * treated as pixels, strings are used verbatim), and `animation` for the
 * loading effect. The element is `aria-hidden` so assistive tech ignores the
 * placeholder. Colors are sourced from the `--md-sys-color-*` surface roles
 * with baseline fallbacks, so it is self-contained.
 */
export class Skeleton extends LitElement {
    constructor() {
        super(...arguments);
        /** The placeholder shape. Reflected so CSS can target `[variant="…"]`. */
        this.variant = "text";
        /**
         * The loading animation. Reflected so CSS can target `[animation="…"]`. Use
         * the empty string / `false` to disable.
         */
        this.animation = "pulse";
        /** Derived inline dimensions, computed in `willUpdate` to keep render pure. */
        this.dims = {};
    }
    willUpdate(changed) {
        if (changed.has("width") || changed.has("height")) {
            const dims = {};
            if (this.width != null && this.width !== "") {
                dims["width"] = toCssSize(this.width);
            }
            if (this.height != null && this.height !== "") {
                dims["height"] = toCssSize(this.height);
            }
            this.dims = dims;
        }
    }
    render() {
        return html ` <div class="skeleton" aria-hidden="true" style=${styleMap(this.dims)}></div> `;
    }
}
__decorate([
    property({ reflect: true })
], Skeleton.prototype, "variant", void 0);
__decorate([
    property()
], Skeleton.prototype, "width", void 0);
__decorate([
    property()
], Skeleton.prototype, "height", void 0);
__decorate([
    property({ reflect: true })
], Skeleton.prototype, "animation", void 0);
__decorate([
    state()
], Skeleton.prototype, "dims", void 0);
/** Coerce a `width`/`height` value to a CSS size (bare numbers → pixels). */
function toCssSize(value) {
    if (typeof value === "number") {
        return `${value}px`;
    }
    // A purely numeric string is also treated as pixels.
    return /^\d+(\.\d+)?$/.test(value.trim()) ? `${value}px` : value;
}
//# sourceMappingURL=skeleton.js.map