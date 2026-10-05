/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * The Material 3 Expressive loading indicator: an active shape that rotates and
 * morphs between rounded polygon forms. When `value` is provided it acts as a
 * determinate progress indicator; otherwise it is indeterminate.
 *
 * Built entirely from animated SVG paths and CSS `@keyframes`; it carries no
 * dependency on any compiled style asset. Respects reduced-motion by falling
 * back to a static shape (driven via the `@media (prefers-reduced-motion)`
 * rule in the stylesheet).
 */
export declare class LoadingIndicator extends LitElement {
    /**
     * Progress in the range 0..1. When set, the indicator is determinate and
     * exposes `aria-valuenow`. When unset (`undefined`), it is indeterminate.
     */
    value?: number;
    /** Accessible label for the indicator. */
    ariaLabel: string;
    protected render(): import("lit-html").TemplateResult<1>;
}
