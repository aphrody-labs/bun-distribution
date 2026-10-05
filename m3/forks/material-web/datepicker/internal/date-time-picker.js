/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html } from "lit";
import { property, state } from "lit/decorators.js";
import { DatePicker, fromISO, toISO } from "./date-picker.js";
/** Splits an ISO datetime into its date and `HH:MM` time parts. */
export function splitDateTime(value) {
    const trimmed = value.trim();
    const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}:\d{2})(?::\d{2})?)?$/.exec(trimmed);
    if (!match) {
        return { date: "", time: "" };
    }
    const time = match[2] ?? "";
    return { date: match[1], time: normalizeTime(time) };
}
/** Pads a `H:MM` time to `HH:MM`, or returns `''` if invalid. */
function normalizeTime(time) {
    if (!time) {
        return "";
    }
    const match = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!match) {
        return "";
    }
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 23 || m > 59) {
        return "";
    }
    return `${h < 10 ? `0${h}` : h}:${match[2]}`;
}
/** Joins a date (`YYYY-MM-DD`) and a `HH:MM` time into an ISO datetime. */
export function joinDateTime(date, time) {
    if (!date) {
        return "";
    }
    return time ? `${date}T${time}` : date;
}
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
export class DateTimePicker extends DatePicker {
    constructor() {
        super(...arguments);
        /** `'12h'` shows an AM/PM toggle in the time row; `'24h'` shows 0–23. */
        this.timeFormat = "24h";
        /** The `HH:MM` time portion of the value. */
        this.time = "";
    }
    willUpdate(changed) {
        if (changed.has("value")) {
            this.time = splitDateTime(this.value).time;
        }
        super.willUpdate(changed);
    }
    /** Parses only the date portion so the inherited grid stays date-based. */
    selectedDate() {
        return fromISO(splitDateTime(this.value).date);
    }
    /** Commits a date while preserving the current time component. */
    commitDate(date) {
        this.commit(toISO(date), this.time);
    }
    render() {
        const calendar = super.render();
        return html `
      <div class="date-time">
        ${calendar}
        <div class="time-row">
          <span class="time-label">Time</span>
          <md-time-picker
            class="time"
            .value=${this.time}
            .format=${this.timeFormat}
            .locale=${this.locale}
            editable
            field-label="Time"
            @time-picker:change=${this.handleTimeChange}
          ></md-time-picker>
        </div>
      </div>
    `;
    }
    handleTimeChange(event) {
        event.stopPropagation();
        const time = event.detail.value;
        const date = splitDateTime(this.value).date || toISO(new Date());
        this.commit(date, time);
    }
    /** Commits a new date/time pair, emitting native + custom change events. */
    commit(date, time) {
        this.time = time;
        this.value = joinDateTime(date, time);
        this.dispatchNative("input");
        this.dispatchEvent(new CustomEvent("date-time-picker:change", {
            detail: { value: this.value },
            bubbles: true,
            composed: true,
        }));
        this.dispatchNative("change");
    }
    connectedCallback() {
        this.time = splitDateTime(this.value).time;
        super.connectedCallback();
    }
}
__decorate([
    property({ type: String })
], DateTimePicker.prototype, "timeFormat", void 0);
__decorate([
    state()
], DateTimePicker.prototype, "time", void 0);
//# sourceMappingURL=date-time-picker.js.map