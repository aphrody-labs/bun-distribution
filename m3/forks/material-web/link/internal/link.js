/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement, nothing } from "lit";
import { property, state } from "lit/decorators.js";
/**
 * A Material 3 styled hyperlink. Renders a real `<a>` so it behaves like a
 * native link for assistive technology, middle-click, "open in new tab", and
 * the browser's status bar.
 *
 * Built entirely on the `--md-sys-*` tokens. Hover/focus use M3 state-layer
 * opacities, and keyboard focus draws a tokenised outline (no ripple).
 *
 * ```html
 * <md-link href="/pricing" underline="hover" color="primary">Pricing</md-link>
 * ```
 *
 * When `href` is omitted the element still renders an `<a>` but without an
 * `href` attribute, so it is presentational only (not focusable).
 */
export class Link extends LitElement {
    constructor() {
        super(...arguments);
        /** The URL the link points to. */
        this.href = "";
        /** The anchor `target` (e.g. `_blank`). */
        this.target = "";
        /**
         * The anchor `rel`. When `target="_blank"` and no `rel` is provided,
         * `noopener noreferrer` is applied automatically to avoid reverse-tabnabbing.
         */
        this.rel = "";
        /** Controls underline behaviour. Defaults to `always`. */
        this.underline = "always";
        /** The M3 color role used to tint the link. Defaults to `primary`. */
        this.color = "primary";
        /**
         * Resolved `rel`, derived from `rel`/`target` before render. Defaulting to
         * `noopener noreferrer` for `target="_blank"` guards against reverse
         * tabnabbing.
         */
        this.resolvedRel = "";
    }
    /**
     * Delegate focus to the inner `<a>` so the host is reachable by keyboard and
     * `:focus-within`/`delegatesFocus` semantics line up with the real anchor.
     */
    static { this.shadowRootOptions = {
        ...LitElement.shadowRootOptions,
        delegatesFocus: true,
    }; }
    willUpdate(changed) {
        if (changed.has("rel") || changed.has("target")) {
            this.resolvedRel = this.rel || (this.target === "_blank" ? "noopener noreferrer" : "");
        }
    }
    render() {
        return html `
      <a
        class="link underline-${this.underline}"
        href=${this.href || nothing}
        target=${this.target || nothing}
        rel=${this.resolvedRel || nothing}
        part="link"
      >
        <slot></slot>
      </a>
    `;
    }
}
__decorate([
    property()
], Link.prototype, "href", void 0);
__decorate([
    property()
], Link.prototype, "target", void 0);
__decorate([
    property()
], Link.prototype, "rel", void 0);
__decorate([
    property()
], Link.prototype, "underline", void 0);
__decorate([
    property({ reflect: true })
], Link.prototype, "color", void 0);
__decorate([
    state()
], Link.prototype, "resolvedRel", void 0);
//# sourceMappingURL=link.js.map