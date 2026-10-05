/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { TemplateResult } from "lit";
import { DatePicker } from "./date-picker.js";
/** The `detail` payload of the `date-time-picker:change` event. */
export interface DateTimePickerChangeDetail {
    /** Selected date-time as an ISO `YYYY-MM-DDTHH:MM` string (or `''`). */
    value: string;
}
/** Splits an ISO datetime into its date and `HH:MM` time parts. */
export declare function splitDateTime(value: string): {
    date: string;
    time: string;
};
/** Joins a date (`YYYY-MM-DD`) and a `HH:MM` time into an ISO datetime. */
export declare function joinDateTime(date: string, time: string): string;
/**
 * A docked Material 3 date-time picker. Reuses the date-picker month grid (and
 * its navigation, keyboard handling, `min`/`max` and locale support via the
 * `selectedDate`/`commitDate` seams) and adds a coupled, editable time row
 * backed by `<md-time-picker>`. The canonical `value` is an ISO
 * `YYYY-MM-DDTHH:MM` string; `min`/`max` accept date-only ISO strings.
 *
 * @fires date-time-picker:change {CustomEvent<DateTimePickerChangeDetail>} Fired
 *     when the date or time changes.
 * @fires input Native event fired as the value changes.
 * @fires change Native event fired when the value is committed.
 */
export declare class DateTimePicker extends DatePicker {
    /** `'12h'` shows an AM/PM toggle in the time row; `'24h'` shows 0–23. */
    timeFormat: "12h" | "24h";
    /** The `HH:MM` time portion of the value. */
    private time;
    willUpdate(changed: Map<string, unknown>): void;
    /** Parses only the date portion so the inherited grid stays date-based. */
    protected selectedDate(): Date | null;
    /** Commits a date while preserving the current time component. */
    protected commitDate(date: Date): void;
    protected render(): TemplateResult;
    private handleTimeChange;
    /** Commits a new date/time pair, emitting native + custom change events. */
    private commit;
    connectedCallback(): void;
}
