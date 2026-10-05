/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
/**
 * An avatar represents a user or entity with an image, initials, or icon.
 *
 * It renders, in priority order: an image (`src`), then the default slot /
 * initials text, then a fallback. If the image fails to load it transparently
 * falls back to the slotted content (initials or an icon). The fallback surface
 * uses the `--md-sys-color-primary-container` / `on-primary-container` tokens.
 *
 * ```html
 * <md-avatar src="user.jpg" alt="Ada Lovelace"></md-avatar>
 * <md-avatar>AL</md-avatar>
 * <md-avatar><svg slot="icon" ...></svg></md-avatar>
 * ```
 *
 * @fires error {Event} Re-dispatched when the underlying image fails to load.
 */
export class Avatar extends LitElement {
    constructor() {
        super(...arguments);
        /** Image source URL. When set and loadable, the image is shown. */
        this.src = "";
        /**
         * Alternative text for the image, also used as the accessible label for the
         * avatar as a whole.
         */
        this.alt = "";
        /** The avatar shape. */
        this.variant = "circular";
        /**
         * The avatar size. Accepts any CSS length (e.g. `40px`, `3rem`) or a number,
         * interpreted as pixels. Drives both width and height.
         */
        this.size = "40px";
        /** Tracks whether the current `src` failed to load. */
        this.hasError = false;
        /** The size coerced to a CSS length, derived in `willUpdate`. */
        this.cssSize = "40px";
    }
    willUpdate(changed) {
        // Reset the error state whenever a new source is provided so a previously
        // failed avatar can recover.
        if (changed.has("src")) {
            this.hasError = false;
        }
        // Coerce the size to a CSS length once per change, keeping render() pure.
        if (changed.has("size")) {
            this.cssSize =
                typeof this.size === "number" || /^\d+(\.\d+)?$/.test(String(this.size))
                    ? `${this.size}px`
                    : String(this.size);
        }
    }
    render() {
        const showImage = !!this.src && !this.hasError;
        const classes = {
            avatar: true,
            "has-image": showImage,
        };
        return html `
      <div
        class=${classMap(classes)}
        style=${styleMap({ "--_size": this.cssSize })}
        role="img"
        aria-label=${this.alt || nothing}
      >
        ${showImage ? this.renderImage() : this.renderFallback()}
      </div>
    `;
    }
    renderImage() {
        return html `
      <img class="image" src=${this.src} alt=${this.alt || nothing} @error=${this.handleError} />
    `;
    }
    renderFallback() {
        return html `
      <span class="fallback" aria-hidden=${this.alt ? "true" : nothing}>
        <slot name="icon"></slot>
        <slot></slot>
      </span>
    `;
    }
    handleError() {
        this.hasError = true;
        this.dispatchEvent(new Event("error"));
    }
}
__decorate([
    property()
], Avatar.prototype, "src", void 0);
__decorate([
    property()
], Avatar.prototype, "alt", void 0);
__decorate([
    property({ reflect: true })
], Avatar.prototype, "variant", void 0);
__decorate([
    property()
], Avatar.prototype, "size", void 0);
__decorate([
    state()
], Avatar.prototype, "hasError", void 0);
__decorate([
    state()
], Avatar.prototype, "cssSize", void 0);
//# sourceMappingURL=avatar.js.map