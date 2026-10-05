/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, isServer, LitElement, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { getMeridiemLabels } from "./time-i18n.js";
/** Pads a number to a two-digit string. */
function pad2(n) {
    return n < 10 ? `0${n}` : String(n);
}
/** Clamps `n` into the inclusive `[lo, hi]` range. */
function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}
/** Parses a 24-hour `HH:MM` string into `[hours, minutes]`, or `null`. */
export function parseTime(value) {
    const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
    if (!match) {
        return null;
    }
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 23 || m > 59) {
        return null;
    }
    return [h, m];
}
/**
 * Parses a user-typed time string robustly. Accepts `HH:MM`, `H:MM`, `HHMM`,
 * and an optional AM/PM (or locale day-period) suffix, returning a 24-hour
 * `[hours, minutes]` pair or `null`.
 */
export function parseTimeInput(value, meridiem) {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const lower = trimmed.toLowerCase();
    let pm = null;
    if (lower.includes("pm") || lower.includes(meridiem.pm.toLowerCase())) {
        pm = true;
    }
    else if (lower.includes("am") || lower.includes(meridiem.am.toLowerCase())) {
        pm = false;
    }
    const nums = trimmed.match(/\d+/g);
    if (!nums) {
        return null;
    }
    let h;
    let m;
    if (nums.length >= 2) {
        h = Number(nums[0]);
        m = Number(nums[1]);
    }
    else {
        const digits = nums[0];
        if (digits.length <= 2) {
            h = Number(digits);
            m = 0;
        }
        else {
            h = Number(digits.slice(0, digits.length - 2));
            m = Number(digits.slice(-2));
        }
    }
    if (pm !== null) {
        h = h % 12;
        if (pm) {
            h += 12;
        }
    }
    if (h > 23 || m > 59) {
        return null;
    }
    return [h, m];
}
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
export class TimePicker extends LitElement {
    constructor() {
        super(...arguments);
        this.internals = this.attachInternals();
        /** The time as a 24-hour `HH:MM` string. */
        this.value = "";
        /** `'12h'` shows an AM/PM toggle; `'24h'` shows 0–23 hours. */
        this.format = "24h";
        /** Whether to show a single coupled editable text field instead of dials. */
        this.editable = false;
        /** Accessible label / placeholder for the editable field. */
        this.fieldLabel = "Time";
        /** The presentation variant: `'input'` (numeric fields) or `'dial'` (clock face). */
        this.variant = "input";
        /** Shorthand for `variant="dial"`. */
        this.dial = false;
        /** BCP-47 locale tag driving AM/PM (day-period) labels via `Intl`. */
        this.locale = "";
        /** Parsed hours in 24h space (0–23). `-1` when unset/invalid. */
        this.hours24 = -1;
        /** Parsed minutes (0–59). `-1` when unset/invalid. */
        this.minutes = -1;
        /** Active unit being adjusted on the dial: `'hours'` or `'minutes'`. */
        this.activeUnit = "hours";
        /** Current (possibly invalid) text in the editable field. */
        this.fieldText = "";
        /** Whether the field currently holds an unparseable value. */
        this.fieldInvalid = false;
    }
    /** Associates the element with a containing `<form>`. */
    static { this.formAssociated = true; }
    willUpdate(changed) {
        if (changed.has("value")) {
            this.parseValue();
            this.syncFieldToValue();
            this.internals.setFormValue(this.value);
        }
        if ((changed.has("locale") || changed.has("format")) && !changed.has("value")) {
            this.syncFieldToValue();
        }
    }
    connectedCallback() {
        super.connectedCallback();
        this.setAttribute("role", "group");
        if (!this.hasAttribute("aria-label")) {
            this.setAttribute("aria-label", "Time");
        }
        this.parseValue();
        this.syncFieldToValue();
        this.internals.setFormValue(this.value);
    }
    parseValue() {
        const parsed = parseTime(this.value);
        if (!parsed) {
            this.hours24 = -1;
            this.minutes = -1;
            return;
        }
        [this.hours24, this.minutes] = parsed;
    }
    syncFieldToValue() {
        this.fieldText = this.hours24 < 0 ? "" : this.formatFieldValue();
        this.fieldInvalid = false;
    }
    /** Renders the current time for the editable field, respecting `format`. */
    formatFieldValue() {
        if (this.format === "24h") {
            return `${pad2(this.hours24)}:${this.displayMinutes}`;
        }
        const labels = getMeridiemLabels(this.locale);
        const suffix = this.isPm ? labels.pm : labels.am;
        return `${this.displayHours}:${this.displayMinutes} ${suffix}`;
    }
    /** Whether the current parsed time is in the PM half (12h mode). */
    get isPm() {
        return this.hours24 >= 12;
    }
    /** Hours shown to the user, respecting the active format. */
    get displayHours() {
        if (this.hours24 < 0) {
            return "";
        }
        if (this.format === "24h") {
            return pad2(this.hours24);
        }
        const h12 = this.hours24 % 12;
        return pad2(h12 === 0 ? 12 : h12);
    }
    get displayMinutes() {
        return this.minutes < 0 ? "" : pad2(this.minutes);
    }
    get isDial() {
        return this.dial || this.variant === "dial";
    }
    get displayHoursNumber() {
        if (this.hours24 < 0)
            return 12;
        if (this.format === "24h")
            return this.hours24;
        const h12 = this.hours24 % 12;
        return h12 === 0 ? 12 : h12;
    }
    get dialHourAngle() {
        const h = this.displayHoursNumber;
        return (h % 12) * 30;
    }
    get dialMinuteAngle() {
        const m = this.minutes < 0 ? 0 : this.minutes;
        return m * 6;
    }
    render() {
        if (this.editable) {
            return this.renderField();
        }
        if (this.isDial) {
            return this.renderDial();
        }
        const is12h = this.format === "12h";
        return html `
      <div class="picker">
        <div class="fields">
          <input
            class="field hours"
            type="text"
            inputmode="numeric"
            maxlength="2"
            aria-label="Hours"
            .value=${this.displayHours}
            @input=${this.handleHoursInput}
            @blur=${this.handleHoursBlur}
            @keydown=${this.handleHoursKeydown}
          />
          <span class="separator" aria-hidden="true">:</span>
          <input
            class="field minutes"
            type="text"
            inputmode="numeric"
            maxlength="2"
            aria-label="Minutes"
            .value=${this.displayMinutes}
            @input=${this.handleMinutesInput}
            @blur=${this.handleMinutesBlur}
            @keydown=${this.handleMinutesKeydown}
          />
        </div>
        ${is12h ? this.renderAmPm() : nothing}
      </div>
    `;
    }
    renderDial() {
        const is12h = this.format === "12h";
        const angle = this.activeUnit === "hours" ? this.dialHourAngle : this.dialMinuteAngle;
        const dialLabel = this.activeUnit === "hours" ? "Select hour" : "Select minute";
        const currentValue = this.activeUnit === "hours"
            ? (is12h ? this.displayHoursNumber : Math.max(0, this.hours24))
            : Math.max(0, this.minutes);
        const maxValue = this.activeUnit === "hours" ? (is12h ? 12 : 23) : 59;
        const minValue = this.activeUnit === "hours" && is12h ? 1 : 0;
        return html `
      <div class="dial-picker">
        <div class="picker">
          <div class="fields">
            <button
              type="button"
              class=${classMap({ field: true, hours: true, clickable: true, active: this.activeUnit === "hours" })}
              aria-label="Hours"
              aria-pressed=${this.activeUnit === "hours" ? "true" : "false"}
              @click=${() => (this.activeUnit = "hours")}
            >
              ${this.displayHours || "00"}
            </button>
            <span class="separator" aria-hidden="true">:</span>
            <button
              type="button"
              class=${classMap({ field: true, minutes: true, clickable: true, active: this.activeUnit === "minutes" })}
              aria-label="Minutes"
              aria-pressed=${this.activeUnit === "minutes" ? "true" : "false"}
              @click=${() => (this.activeUnit = "minutes")}
            >
              ${this.displayMinutes || "00"}
            </button>
          </div>
          ${is12h ? this.renderAmPm() : nothing}
        </div>

        <div
          class="clock-dial"
          role="slider"
          tabindex="0"
          aria-label=${dialLabel}
          aria-valuemin=${minValue}
          aria-valuemax=${maxValue}
          aria-valuenow=${currentValue}
          @click=${this.handleDialClick}
          @keydown=${this.handleDialKeydown}
        >
          <div class="clock-pin"></div>
          <div class="clock-hand" style="transform: rotate(${angle}deg);">
            <div class="clock-hand-knob"></div>
          </div>
          ${this.activeUnit === "hours" ? this.renderDialHours() : this.renderDialMinutes()}
        </div>
      </div>
    `;
    }
    renderDialHours() {
        const is12h = this.format === "12h";
        const hours = is12h
            ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
            : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
        return hours.map((h) => {
            let radius = 92;
            let angle = (h % 12) * 30;
            if (!is12h && (h === 0 || h >= 13)) {
                radius = 60;
                angle = (h % 12) * 30;
            }
            const rad = (angle - 90) * (Math.PI / 180);
            const x = Math.round(128 + radius * Math.cos(rad));
            const y = Math.round(128 + radius * Math.sin(rad));
            const selected = is12h
                ? this.displayHoursNumber === h
                : (this.hours24 === h || (this.hours24 < 0 && h === 0));
            return html `
        <button
          type="button"
          class=${classMap({ "clock-number": true, selected })}
          style="left: ${x}px; top: ${y}px;"
          @click=${(e) => {
                e.stopPropagation();
                this.selectDialHour(h);
            }}
        >
          ${is12h ? h : pad2(h)}
        </button>
      `;
        });
    }
    renderDialMinutes() {
        const steps = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
        return steps.map((m) => {
            const angle = m * 6;
            const rad = (angle - 90) * (Math.PI / 180);
            const x = Math.round(128 + 92 * Math.cos(rad));
            const y = Math.round(128 + 92 * Math.sin(rad));
            const selected = this.minutes === m;
            return html `
        <button
          type="button"
          class=${classMap({ "clock-number": true, selected })}
          style="left: ${x}px; top: ${y}px;"
          @click=${(e) => {
                e.stopPropagation();
                this.selectDialMinute(m);
            }}
        >
          ${pad2(m)}
        </button>
      `;
        });
    }
    selectDialHour(hour) {
        let h24;
        if (this.format === "24h") {
            h24 = hour;
        }
        else {
            h24 = this.to24(hour === 12 ? 0 : hour, this.isPm);
        }
        const m = this.minutes < 0 ? 0 : this.minutes;
        this.setTime(h24, m);
        this.activeUnit = "minutes";
    }
    selectDialMinute(minute) {
        const h = this.hours24 < 0 ? 0 : this.hours24;
        this.setTime(h, minute);
    }
    handleDialClick(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left - 128;
        const y = event.clientY - rect.top - 128;
        const dist = Math.hypot(x, y);
        if (dist < 10)
            return;
        let deg = (Math.atan2(y, x) * (180 / Math.PI)) + 90;
        if (deg < 0)
            deg += 360;
        if (this.activeUnit === "hours") {
            const is12h = this.format === "12h";
            let step = Math.round(deg / 30) % 12;
            if (is12h) {
                this.selectDialHour(step === 0 ? 12 : step);
            }
            else {
                if (dist < 76) {
                    this.selectDialHour(step === 0 ? 0 : step + 12);
                }
                else {
                    this.selectDialHour(step === 0 ? 12 : step);
                }
            }
        }
        else {
            const m = Math.round(deg / 6) % 60;
            this.selectDialMinute(m);
        }
    }
    handleDialKeydown(event) {
        const delta = this.arrowDelta(event);
        if (delta === 0)
            return;
        event.preventDefault();
        if (this.activeUnit === "hours") {
            const current = this.hours24 < 0 ? 0 : this.hours24;
            const next = (current + delta + 24) % 24;
            this.setTime(next, this.minutes < 0 ? 0 : this.minutes);
        }
        else {
            const current = this.minutes < 0 ? 0 : this.minutes;
            const next = (current + delta + 60) % 60;
            this.setTime(this.hours24 < 0 ? 0 : this.hours24, next);
        }
    }
    renderField() {
        const placeholder = this.format === "24h" ? "HH:MM" : "HH:MM AM";
        return html `
      <div class=${classMap({ "text-field": true, invalid: this.fieldInvalid })}>
        <input
          class="text-field-input"
          type="text"
          inputmode="numeric"
          placeholder=${placeholder}
          aria-label=${this.fieldLabel}
          aria-invalid=${this.fieldInvalid ? "true" : "false"}
          .value=${this.fieldText}
          @input=${this.handleFieldInput}
          @change=${this.handleFieldChange}
        />
      </div>
    `;
    }
    renderAmPm() {
        const labels = getMeridiemLabels(this.locale);
        const pm = this.hours24 >= 0 && this.isPm;
        const am = this.hours24 >= 0 && !this.isPm;
        return html `
      <div class="ampm" role="group" aria-label="AM or PM">
        <button
          class=${classMap({ "ampm-button": true, top: true, on: am })}
          aria-pressed=${am ? "true" : "false"}
          @click=${this.handleAmClick}
        >
          ${labels.am}
        </button>
        <button
          class=${classMap({ "ampm-button": true, bottom: true, on: pm })}
          aria-pressed=${pm ? "true" : "false"}
          @click=${this.handlePmClick}
        >
          ${labels.pm}
        </button>
      </div>
    `;
    }
    handleFieldInput(event) {
        const input = event.target;
        this.fieldText = input.value;
        const parsed = parseTimeInput(input.value, getMeridiemLabels(this.locale));
        if (parsed) {
            this.fieldInvalid = false;
            this.setTime(parsed[0], parsed[1], false);
            this.dispatchNative("input");
        }
        else {
            this.fieldInvalid = input.value.trim().length > 0;
        }
    }
    handleFieldChange() {
        if (this.fieldInvalid) {
            this.syncFieldToValue();
            return;
        }
        this.dispatchNative("change");
    }
    handleHoursInput(event) {
        const raw = event.target.value.replace(/\D/g, "");
        if (raw === "") {
            return;
        }
        let h = Number(raw);
        if (this.format === "24h") {
            h = clamp(h, 0, 23);
            this.setTime(h, this.minutes < 0 ? 0 : this.minutes);
        }
        else {
            h = clamp(h, 1, 12);
            this.setTime(this.to24(h, this.isPm), this.minutes < 0 ? 0 : this.minutes);
        }
    }
    handleHoursBlur(event) {
        event.target.value = this.displayHours;
    }
    handleMinutesInput(event) {
        const raw = event.target.value.replace(/\D/g, "");
        if (raw === "") {
            return;
        }
        const m = clamp(Number(raw), 0, 59);
        this.setTime(this.hours24 < 0 ? 0 : this.hours24, m);
    }
    handleMinutesBlur(event) {
        event.target.value = this.displayMinutes;
    }
    handleHoursKeydown(event) {
        const delta = this.arrowDelta(event);
        if (delta === 0) {
            return;
        }
        event.preventDefault();
        const base = this.hours24 < 0 ? 0 : this.hours24;
        const h = (base + delta + 24) % 24;
        this.setTime(h, this.minutes < 0 ? 0 : this.minutes);
    }
    handleMinutesKeydown(event) {
        const delta = this.arrowDelta(event);
        if (delta === 0) {
            return;
        }
        event.preventDefault();
        const base = this.minutes < 0 ? 0 : this.minutes;
        const m = (base + delta + 60) % 60;
        this.setTime(this.hours24 < 0 ? 0 : this.hours24, m);
    }
    arrowDelta(event) {
        if (event.key === "ArrowUp") {
            return 1;
        }
        if (event.key === "ArrowDown") {
            return -1;
        }
        return 0;
    }
    handleAmClick() {
        if (this.isPm) {
            this.setTime(this.hours24 - 12, this.minutes < 0 ? 0 : this.minutes);
        }
        else if (this.hours24 < 0) {
            this.setTime(0, 0);
        }
    }
    handlePmClick() {
        if (!this.isPm) {
            const base = this.hours24 < 0 ? 0 : this.hours24;
            this.setTime(base + 12, this.minutes < 0 ? 0 : this.minutes);
        }
    }
    /** Converts a 12-hour clock hour + meridiem flag into a 0–23 hour. */
    to24(h12, pm) {
        const base = h12 % 12;
        return pm ? base + 12 : base;
    }
    /**
     * Commits a new time, updates the form value, and dispatches events. When
     * `syncField` is `false` the editable field text is left as-typed (so the
     * user's in-progress input is not clobbered mid-edit).
     */
    setTime(hours24, minutes, syncField = true) {
        this.hours24 = clamp(hours24, 0, 23);
        this.minutes = clamp(minutes, 0, 59);
        this.value = `${pad2(this.hours24)}:${pad2(this.minutes)}`;
        this.internals.setFormValue(this.value);
        if (syncField) {
            this.syncFieldToValue();
        }
        this.dispatchEvent(new CustomEvent("time-picker:change", {
            detail: { value: this.value },
            bubbles: true,
            composed: true,
        }));
        if (syncField && !isServer) {
            this.dispatchNative("input");
            this.dispatchNative("change");
        }
    }
    /** Fires a native `input`/`change` event so `event.target.value` works. */
    dispatchNative(type) {
        this.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
    }
}
__decorate([
    property({ type: String })
], TimePicker.prototype, "value", void 0);
__decorate([
    property({ type: String })
], TimePicker.prototype, "format", void 0);
__decorate([
    property({ type: Boolean })
], TimePicker.prototype, "editable", void 0);
__decorate([
    property({ type: String, attribute: "field-label" })
], TimePicker.prototype, "fieldLabel", void 0);
__decorate([
    property({ type: String })
], TimePicker.prototype, "variant", void 0);
__decorate([
    property({ type: Boolean })
], TimePicker.prototype, "dial", void 0);
__decorate([
    property({ type: String })
], TimePicker.prototype, "locale", void 0);
__decorate([
    state()
], TimePicker.prototype, "hours24", void 0);
__decorate([
    state()
], TimePicker.prototype, "minutes", void 0);
__decorate([
    state()
], TimePicker.prototype, "activeUnit", void 0);
__decorate([
    state()
], TimePicker.prototype, "fieldText", void 0);
__decorate([
    state()
], TimePicker.prototype, "fieldInvalid", void 0);
//# sourceMappingURL=time-picker.js.map