/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
import { Step } from "./step.js";
/**
 * A stepper guides a user through a sequence of logical, numbered steps. It
 * renders a header (a row of numbered indicators connected by lines in
 * horizontal mode, or a vertical stack in vertical mode) plus the content of
 * the currently-selected `<md-step>`.
 *
 * Implements the Material 3 stepper pattern on top of the `--md-sys-*` tokens.
 * In `linear` mode the user may not jump ahead to an incomplete future step.
 *
 * @fires stepper:change {CustomEvent<{selectedIndex: number}>} Fired whenever
 *     the selected step changes (via `select`, `next`, `previous`, or a click
 *     on a step indicator).
 */
export declare class Stepper extends LitElement {
    /** Layout orientation. Reflected so CSS can target `[orientation]`. */
    orientation: "horizontal" | "vertical";
    /** Index of the currently selected step. */
    selectedIndex: number;
    /**
     * When true, the user cannot select a future step until all prior steps are
     * completed (the classic "wizard" behaviour).
     */
    linear: boolean;
    private readonly stepElements;
    /** Returns the live list of `<md-step>` children. */
    get steps(): Step[];
    /** Selects the next step, if any (respecting `linear`). */
    next(): void;
    /** Selects the previous step, if any. */
    previous(): void;
    /**
     * Selects the step at `index`. Out-of-range indices are ignored. In linear
     * mode, selecting a future step is rejected unless every step before it is
     * completed.
     */
    select(index: number): void;
    /**
     * In linear mode a step is reachable only if every preceding step is
     * completed. The target step's own completion is irrelevant.
     */
    private canReach;
    connectedCallback(): void;
    private handleSlotChange;
    /** Toggles the `active` flag on each child step to match `selectedIndex`. */
    private syncActive;
    protected render(): import("lit-html").TemplateResult<1>;
    private renderStepHeader;
    private handleHeaderClick;
    private handleHeaderKeydown;
    private focusHeader;
}
