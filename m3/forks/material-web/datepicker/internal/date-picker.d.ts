/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, nothing, TemplateResult } from "lit";
/** The `detail` payload of the `date-picker:change` event. */
export interface DatePickerChangeDetail {
    /** Selected date as an ISO `YYYY-MM-DD` string. */
    value: string;
}
/**
 * Predicate used to disable individual dates. Receives a local `Date` (midnight
 * of the day) and returns `true` if that day should be unselectable.
 */
export type DateDisabledPredicate = (date: Date) => boolean;
/** Pads a number to a two-digit string. */
export declare function pad2(n: number): string;
/** Formats a `Date` as a local `YYYY-MM-DD` ISO date string. */
export declare function toISO(date: Date): string;
/** Parses a `YYYY-MM-DD` string into a local `Date`, or `null` if invalid. */
export declare function fromISO(value: string): Date | null;
/**
 * Formats a `Date` for display in the editable field (locale `MM/DD/YYYY`).
 * Mirrors MUI X's masked text field; parsing accepts both `MM/DD/YYYY` and the
 * ISO `YYYY-MM-DD` form.
 */
export declare function formatDisplay(date: Date): string;
/** Parses a user-typed field value (`MM/DD/YYYY` or `YYYY-MM-DD`). */
export declare function parseDisplay(value: string): Date | null;
export declare class DatePicker extends LitElement {
    /** Associates the element with a containing `<form>`. */
    static readonly formAssociated = true;
    private readonly internals;
    /** Selected date as `YYYY-MM-DD`. */
    value: string;
    /** Earliest selectable date as `YYYY-MM-DD`. */
    min: string;
    /** Latest selectable date as `YYYY-MM-DD`. */
    max: string;
    /** Whether to show the coupled editable text field above the calendar. */
    editable: boolean;
    /** Placeholder shown in the editable field when empty. */
    fieldLabel: string;
    /**
     * BCP-47 locale tag driving month/weekday labels and the editable field's
     * numeric date order (via `Intl`). Empty uses the runtime default; EN is the
     * hard fallback.
     */
    locale: string;
    /**
     * Explicit display mask (`YYYY`/`MM`/`DD`, e.g. `DD.MM.YYYY`). When set it
     * overrides the locale-derived format for both rendering and parsing.
     */
    format: string;
    /**
     * Optional predicate to disable individual dates (in addition to `min`/`max`).
     * This is a property, not an attribute, and must be set in JS.
     */
    disabledDate?: DateDisabledPredicate;
    /** The first day of the currently displayed month. */
    protected viewDate: Date;
    /** Current (possibly invalid) text in the editable field. */
    private fieldText;
    /** Whether the field currently holds an unparseable value. */
    private fieldInvalid;
    /** Number of leading blank cells before day 1 of the displayed month. */
    private leadingBlanks;
    /** Memoised day cells for the displayed month (computed in `willUpdate`). */
    private dayCells;
    connectedCallback(): void;
    willUpdate(changed: Map<string, unknown>): void;
    /**
     * The currently selected `Date`, or `null`. Defined as a seam so subclasses
     * whose `value` carries extra data (e.g. a date-time picker) can parse just
     * the date portion without re-implementing the grid logic.
     */
    protected selectedDate(): Date | null;
    protected syncViewToValue(): void;
    private syncFieldToValue;
    /** Whether a given date is outside `min`/`max` or matched by `disabledDate`. */
    protected isDisabled(date: Date): boolean;
    protected render(): TemplateResult;
    private renderField;
    /**
     * Computes the displayed month's grid (leading blanks + day descriptors).
     * Runs once per relevant update in `willUpdate` so `render()` stays pure and
     * the (date-arithmetic-heavy) grid is not rebuilt on unrelated renders.
     */
    protected computeDayCells(): void;
    protected renderDays(_year?: number, _month?: number): typeof nothing | TemplateResult<1>[];
    private handleFieldInput;
    private handleFieldChange;
    private handlePrev;
    private handleNext;
    private handlePrevYear;
    private handleNextYear;
    private handleDayClick;
    protected selectDay(day: number): void;
    /**
     * Commits a newly selected `Date` to `value` and emits events. Defined as a
     * seam so subclasses (e.g. a date-time picker) can preserve extra value parts
     * such as a time component.
     */
    protected commitDate(date: Date): void;
    protected dispatchChangeEvent(): void;
    /** Fires a native `input`/`change` event so `event.target.value` works. */
    protected dispatchNative(type: "input" | "change"): void;
    private handleKeydown;
    private focusSelectedCell;
}
