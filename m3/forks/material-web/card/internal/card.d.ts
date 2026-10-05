/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * A Card component implementing Material Design 3 guidelines.
 */
export declare class Card extends LitElement {
    /**
     * The variant of the card.
     * Supported: 'elevated', 'filled', 'outlined'.
     */
    variant: "elevated" | "filled" | "outlined";
    /**
     * If true, makes the card interactive and adds hover/active state visual effects.
     */
    clickable: boolean;
    protected render(): import("lit-html").TemplateResult<1>;
}
