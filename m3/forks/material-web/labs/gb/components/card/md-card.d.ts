/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative, LitElement } from "lit";
import { type CardColor } from "./card.js";
declare global {
    interface HTMLElementTagNameMap {
        /** A Material Design card component. */
        "md-card": Card;
    }
}
declare const baseClass: import("@aphrody/material-web/labs/behaviors/mixin.js").MixinReturn<typeof LitElement>;
/**
 * A Material Design card.
 */
export declare class Card extends baseClass {
    /** @nocollapse */
    static shadowRootOptions: ShadowRootInit;
    static styles: CSSResultOrNative[];
    /** The color of the card. */
    color: CardColor;
    /** Whether the card is disabled. */
    disabled: boolean;
    /** Whether the card is interactive. */
    interactive: boolean;
    protected render(): import("lit-html").TemplateResult<1>;
}
export {};
