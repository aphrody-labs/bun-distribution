/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, TemplateResult } from "lit";
/** The `detail` payload of the `time-picker:change` event. */
export interface TimePickerChangeDetail {
    /** Normalized 24-hour `HH:MM` string. */
    value: string;
}
/** The hour display format. */
export type TimeFormat = "12h" | "24h";
/** Parses a 24-hour `HH:MM` string into `[hours, minutes]`, or `null`. */
export declare function parseTime(value: string): [number, number] | null;
/**
 * Parses a user-typed time string robustly. Accepts `HH:MM`, `H:MM`, `HHMM`,
 * and an optional AM/PM (or locale day-period) suffix, returning a 24-hour
 * `[hours, minutes]` pair or `null`.
 */
export declare function parseTimeInput(value: string, meridiem: {
    am: string;
    pm: string;
}): [number, number] | null;
/**
 * A Material 3 time picker (input variant): two numeric fields for hours and
 * minutes separated by a colon, plus an AM/PM toggle in 12-hour mode. The value
 * is always emitted as a normalized 24-hour `HH:MM` string.
 *
 * The element is form-associated (via `ElementInternals`) and, when `editable`
 * is set, exposes a coupled single text field whose value is parsed leniently.
 * In addition to the high-level `time-picker:change` event it fires native
 * `input`/`change` events so it can be consumed like a form control.
 *
 * @fires time-picker:change {CustomEvent<TimePickerChangeDetail>} Fired when the
 *     time changes through user interaction.
 * @fires input Native event fired as the value changes.
 * @fires change Native event fired when a value is committed.
 */
export declare class TimePicker extends LitElement {
    /** Associates the element with a containing `<form>`. */
    static readonly formAssociated = true;
    private readonly internals;
    /** The time as a 24-hour `HH:MM` string. */
    value: string;
    /** `'12h'` shows an AM/PM toggle; `'24h'` shows 0–23 hours. */
    format: TimeFormat;
    /** Whether to show a single coupled editable text field instead of dials. */
    editable: boolean;
    /** Accessible label / placeholder for the editable field. */
    fieldLabel: string;
    /** The presentation variant: `'input'` (numeric fields) or `'dial'` (clock face). */
    variant: "input" | "dial";
    /** Shorthand for `variant="dial"`. */
    dial: boolean;
    /** BCP-47 locale tag driving AM/PM (day-period) labels via `Intl`. */
    locale: string;
    /** Parsed hours in 24h space (0–23). `-1` when unset/invalid. */
    private hours24;
    /** Parsed minutes (0–59). `-1` when unset/invalid. */
    private minutes;
    /** Active unit being adjusted on the dial: `'hours'` or `'minutes'`. */
    private activeUnit;
    /** Current (possibly invalid) text in the editable field. */
    private fieldText;
    /** Whether the field currently holds an unparseable value. */
    private fieldInvalid;
    willUpdate(changed: Map<string, unknown>): void;
    connectedCallback(): void;
    private parseValue;
    private syncFieldToValue;
    /** Renders the current time for the editable field, respecting `format`. */
    private formatFieldValue;
    /** Whether the current parsed time is in the PM half (12h mode). */
    private get isPm();
    /** Hours shown to the user, respecting the active format. */
    private get displayHours();
    private get displayMinutes();
    private get isDial();
    private get displayHoursNumber();
    private get dialHourAngle();
    private get dialMinuteAngle();
    protected render(): TemplateResult;
    private renderDial;
    private renderDialHours;
    private renderDialMinutes;
    private selectDialHour;
    private selectDialMinute;
    private handleDialClick;
    private handleDialKeydown;
    private renderField;
    private renderAmPm;
    private handleFieldInput;
    private handleFieldChange;
    private handleHoursInput;
    private handleHoursBlur;
    private handleMinutesInput;
    private handleMinutesBlur;
    private handleHoursKeydown;
    private handleMinutesKeydown;
    private arrowDelta;
    private handleAmClick;
    private handlePmClick;
    /** Converts a 12-hour clock hour + meridiem flag into a 0–23 hour. */
    private to24;
    /**
     * Commits a new time, updates the form value, and dispatches events. When
     * `syncField` is `false` the editable field text is left as-typed (so the
     * user's in-progress input is not clobbered mid-edit).
     */
    private setTime;
    /** Fires a native `input`/`change` event so `event.target.value` works. */
    private dispatchNative;
}
