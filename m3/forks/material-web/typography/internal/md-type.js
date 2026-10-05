/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement } from "lit";
import { property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { fontVariationSettings } from "./google-sans-flex-axes.js";
import { TYPE_SCALE } from "./type-scale.js";
/**
 * `<md-type>` renders slotted text in a Material 3 type-scale role using Google
 * Sans Flex, and exposes every variable axis as an attribute for maximum
 * flexibility. Set `scale` to pick a role; override any single axis
 * (`wght`/`opsz`/`wdth`/`grad`/`slnt`/`rond`) without disturbing the others.
 * With `animated`, axis changes tween smoothly (font-variation-settings is an
 * animatable CSS property), enabling expressive typographic motion.
 *
 * The host is `display: contents` by default so it does not disturb layout;
 * set `block` to render as a block-level element.
 */
export class MdType extends LitElement {
    constructor() {
        super(...arguments);
        /** The M3 type-scale role to apply. */
        this.scale = "body-large";
        /**
         * Render in Google Sans Code (monospace face) instead of Google Sans Flex —
         * for code, terminals, and tabular data. Uses the `MONO`/`wght` axes.
         */
        this.code = false;
        /** Tween axis changes (font-variation-settings transition). */
        this.animated = false;
        /** Render as a block element instead of `display: contents`. */
        this.block = false;
    }
    /** Resolve the effective axis settings: scale defaults + attribute overrides. */
    resolveAxes() {
        const base = TYPE_SCALE[this.scale].axes;
        return {
            wght: this.wght ?? base.wght,
            opsz: this.opsz ?? base.opsz,
            wdth: this.wdth ?? base.wdth,
            grad: this.grad ?? base.grad,
            slnt: this.slnt ?? base.slnt,
            rond: this.rond ?? base.rond,
        };
    }
    render() {
        const s = TYPE_SCALE[this.scale];
        const axes = this.resolveAxes();
        const weight = axes.wght ?? 400;
        const styles = this.code
            ? {
                "font-family": "var(--md-sys-typescale-code-font, 'Google Sans Code', ui-monospace, 'Cascadia Code', monospace)",
                "font-size": `${s.sizePx}px`,
                "line-height": `${s.lineHeightPx}px`,
                "letter-spacing": `${s.trackingPx}px`,
                "font-weight": `${weight}`,
                // Google Sans Code exposes MONO (0..1) + wght only.
                "font-variation-settings": `"MONO" ${this.mono ?? 1}, "wght" ${weight}`,
            }
            : {
                "font-family": "var(--md-sys-typescale-font, 'Google Sans Flex', Roboto, system-ui, sans-serif)",
                "font-size": `${s.sizePx}px`,
                "line-height": `${s.lineHeightPx}px`,
                "letter-spacing": `${s.trackingPx}px`,
                "font-weight": `${weight}`,
                "font-variation-settings": fontVariationSettings(axes),
            };
        return html `<span class="text" style=${styleMap(styles)}><slot></slot></span>`;
    }
}
__decorate([
    property()
], MdType.prototype, "scale", void 0);
__decorate([
    property({ type: Number })
], MdType.prototype, "wght", void 0);
__decorate([
    property({ type: Number })
], MdType.prototype, "opsz", void 0);
__decorate([
    property({ type: Number })
], MdType.prototype, "wdth", void 0);
__decorate([
    property({ type: Number })
], MdType.prototype, "grad", void 0);
__decorate([
    property({ type: Number })
], MdType.prototype, "slnt", void 0);
__decorate([
    property({ type: Number })
], MdType.prototype, "rond", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], MdType.prototype, "code", void 0);
__decorate([
    property({ type: Number })
], MdType.prototype, "mono", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], MdType.prototype, "animated", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], MdType.prototype, "block", void 0);
//# sourceMappingURL=md-type.js.map