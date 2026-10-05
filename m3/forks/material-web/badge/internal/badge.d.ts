/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * A Badge component implementing Material Design 3 guidelines.
 */
export declare class Badge extends LitElement {
    /**
     * The text or counter value to display inside the badge.
     * If empty or undefined, the badge renders as a small status dot.
     */
    value: string;
    /**
     * If true, forces the badge to render as a small status dot even if value is present.
     * Automatically derives from value if not set.
     */
    dot: boolean;
    /**
     * Helper property to absolutely position the badge at the top-right corner of its parent.
     */
    positioned: boolean;
    willUpdate(changedProperties: Map<PropertyKey, unknown>): void;
    protected render(): import("lit-html").TemplateResult<1>;
}
