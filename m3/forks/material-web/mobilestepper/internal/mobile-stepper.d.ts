/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, TemplateResult } from "lit";
/**
 * The visual treatment of the stepper's progress indicator.
 *
 * - `dots` — one dot per step; the active step's dot uses the primary color.
 * - `text` — a compact `"N / M"` label.
 * - `progress` — a linear progress bar filled to the current step.
 */
export type MobileStepperVariant = "dots" | "text" | "progress";
/**
 * Where the stepper anchors itself. `static` flows inline with the document;
 * `bottom`/`top` fix it to the corresponding edge of the viewport.
 */
export type MobileStepperPosition = "bottom" | "top" | "static";
/**
 * A mobile stepper displays progress through a sequence of steps and is
 * typically used at the bottom of mobile screens for paginated content such as
 * onboarding carousels.
 *
 * Implements the Material 3 design language on top of the `--md-sys-*` tokens.
 * The app supplies its own back/next controls through the `back` and `next`
 * slots so it owns navigation behavior; this element renders only the progress
 * affordance (`dots`, `text`, or `progress`) between them.
 *
 * ```html
 * <md-mobile-stepper steps="6" active-step="2" variant="dots">
 *   <md-text-button slot="back">Back</md-text-button>
 *   <md-text-button slot="next">Next</md-text-button>
 * </md-mobile-stepper>
 * ```
 */
export declare class MobileStepper extends LitElement {
    /** Total number of steps. */
    steps: number;
    /** The zero-based index of the active step. */
    activeStep: number;
    /** The progress indicator treatment. Reflected so CSS can target it. */
    variant: MobileStepperVariant;
    /** Where the stepper anchors itself. Reflected so CSS can target it. */
    position: MobileStepperPosition;
    protected render(): TemplateResult;
    private renderProgress;
    private renderDots;
    private renderText;
    private renderBar;
    private stepCountLabel;
}
