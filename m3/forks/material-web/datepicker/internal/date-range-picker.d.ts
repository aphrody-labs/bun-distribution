/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, TemplateResult } from "lit";
import { type DateDisabledPredicate } from "./date-picker.js";
/** The `detail` payload of the `date-range-picker:change` event. */
export interface DateRangeChangeDetail {
    /** Range start as an ISO `YYYY-MM-DD` string (or `''` if unset). */
    start: string;
    /** Range end as an ISO `YYYY-MM-DD` string (or `''` if unset). */
    end: string;
}
export declare class DateRangePicker extends LitElement {
    /** Associates the element with a containing `<form>`. */
    static readonly formAssociated = true;
    private readonly internals;
    /** Range start as `YYYY-MM-DD`. */
    start: string;
    /** Range end as `YYYY-MM-DD`. */
    end: string;
    /** Earliest selectable date as `YYYY-MM-DD`. */
    min: string;
    /** Latest selectable date as `YYYY-MM-DD`. */
    max: string;
    /** Whether to show the coupled editable start/end fields above the grid. */
    editable: boolean;
    /** Optional predicate to disable individual dates. JS-only property. */
    disabledDate?: DateDisabledPredicate;
    /** BCP-47 locale tag for month/weekday labels and field parsing. */
    locale: string;
    /** Explicit display mask (`YYYY`/`MM`/`DD`) overriding the locale format. */
    format: string;
    /** The first day of the currently displayed month. */
    private viewDate;
    /** Current text in the start/end editable fields. */
    private startText;
    private endText;
    /** Leading blank cells before day 1 of the displayed month. */
    private leadingBlanks;
    /** Memoised day cells for the displayed month (computed in `willUpdate`). */
    private dayCells;
    connectedCallback(): void;
    willUpdate(changed: Map<string, unknown>): void;
    private syncViewToValue;
    private syncFieldsToValue;
    private isDisabled;
    protected render(): TemplateResult<1>;
    private renderFields;
    /**
     * Computes the displayed month's range grid once per relevant update (in
     * `willUpdate`) instead of inside `render()`, keeping render pure.
     */
    private computeDayCells;
    private renderDays;
    private handleStartInput;
    private handleEndInput;
    private handleFieldCommit;
    private normalizeOrder;
    private handlePrev;
    private handleNext;
    private handleDayClick;
    /**
     * Range-selection state machine: with no start (or a complete range), the
     * click sets a new start and clears the end; with a start but no end, the
     * click sets the end (swapping if earlier than the start).
     */
    private pick;
    private emit;
    /** The combined value, `start/end`, for native form-control consumption. */
    get value(): string;
    private handleKeydown;
    private focusEdgeCell;
}
