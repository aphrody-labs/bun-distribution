/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, isServer, LitElement, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { fromISO, toISO } from "./date-picker.js";
import { formatDisplayLocale, getDateLocaleData, monthName, parseDisplayLocale, } from "./date-i18n.js";
export class DateRangePicker extends LitElement {
    constructor() {
        super(...arguments);
        this.internals = this.attachInternals();
        /** Range start as `YYYY-MM-DD`. */
        this.start = "";
        /** Range end as `YYYY-MM-DD`. */
        this.end = "";
        /** Earliest selectable date as `YYYY-MM-DD`. */
        this.min = "";
        /** Latest selectable date as `YYYY-MM-DD`. */
        this.max = "";
        /** Whether to show the coupled editable start/end fields above the grid. */
        this.editable = false;
        /** BCP-47 locale tag for month/weekday labels and field parsing. */
        this.locale = "";
        /** Explicit display mask (`YYYY`/`MM`/`DD`) overriding the locale format. */
        this.format = "";
        /** The first day of the currently displayed month. */
        this.viewDate = new Date();
        /** Current text in the start/end editable fields. */
        this.startText = "";
        this.endText = "";
        /** Leading blank cells before day 1 of the displayed month. */
        this.leadingBlanks = 0;
        /** Memoised day cells for the displayed month (computed in `willUpdate`). */
        this.dayCells = [];
    }
    /** Associates the element with a containing `<form>`. */
    static { this.formAssociated = true; }
    connectedCallback() {
        super.connectedCallback();
        this.setAttribute("role", "group");
        this.syncViewToValue();
        this.syncFieldsToValue();
        this.internals.setFormValue(this.value);
    }
    willUpdate(changed) {
        if (changed.has("start") || changed.has("end")) {
            this.syncViewToValue();
            this.syncFieldsToValue();
            this.internals.setFormValue(this.value);
        }
        if (changed.has("locale") || changed.has("format")) {
            this.syncFieldsToValue();
        }
        if (changed.has("start") ||
            changed.has("end") ||
            changed.has("viewDate") ||
            changed.has("min") ||
            changed.has("max") ||
            changed.has("disabledDate") ||
            changed.has("locale")) {
            this.computeDayCells();
        }
    }
    syncViewToValue() {
        const base = fromISO(this.start) ?? fromISO(this.end) ?? new Date();
        this.viewDate = new Date(base.getFullYear(), base.getMonth(), 1);
    }
    syncFieldsToValue() {
        const s = fromISO(this.start);
        const e = fromISO(this.end);
        this.startText = s ? formatDisplayLocale(s, this.locale, this.format) : "";
        this.endText = e ? formatDisplayLocale(e, this.locale, this.format) : "";
    }
    isDisabled(date) {
        const minDate = fromISO(this.min);
        const maxDate = fromISO(this.max);
        if (minDate != null && date < minDate) {
            return true;
        }
        if (maxDate != null && date > maxDate) {
            return true;
        }
        return this.disabledDate ? this.disabledDate(date) : false;
    }
    render() {
        const year = this.viewDate.getFullYear();
        const month = this.viewDate.getMonth();
        const weekdays = getDateLocaleData(this.locale).weekdays;
        return html `
      <div class="picker">
        ${this.editable ? this.renderFields() : nothing}
        <div class="header">
          <button class="nav" aria-label="Previous month" @click=${this.handlePrev}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z"></path>
            </svg>
          </button>
          <span class="month-label">${monthName(this.locale, month)} ${year}</span>
          <button class="nav" aria-label="Next month" @click=${this.handleNext}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6z"></path>
            </svg>
          </button>
        </div>
        <div class="weekdays" aria-hidden="true">
          ${weekdays.map((d) => html `<span class="weekday">${d}</span>`)}
        </div>
        <div class="grid" role="grid" @keydown=${this.handleKeydown}>
          ${this.renderDays(year, month)}
        </div>
      </div>
    `;
    }
    renderFields() {
        return html `
      <div class="fields">
        <div class="field">
          <input
            class="field-input"
            type="text"
            inputmode="numeric"
            placeholder="Start"
            aria-label="Range start"
            .value=${this.startText}
            @input=${this.handleStartInput}
            @change=${this.handleFieldCommit}
          />
        </div>
        <span class="field-sep" aria-hidden="true">–</span>
        <div class="field">
          <input
            class="field-input"
            type="text"
            inputmode="numeric"
            placeholder="End"
            aria-label="Range end"
            .value=${this.endText}
            @input=${this.handleEndInput}
            @change=${this.handleFieldCommit}
          />
        </div>
      </div>
    `;
    }
    /**
     * Computes the displayed month's range grid once per relevant update (in
     * `willUpdate`) instead of inside `render()`, keeping render pure.
     */
    computeDayCells() {
        const year = this.viewDate.getFullYear();
        const month = this.viewDate.getMonth();
        this.leadingBlanks = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const start = fromISO(this.start);
        const end = fromISO(this.end);
        const startISO = start ? toISO(start) : "";
        const endISO = end ? toISO(end) : "";
        const todayISO = toISO(new Date());
        const cells = [];
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const iso = toISO(date);
            const isStart = startISO !== "" && startISO === iso;
            const isEnd = endISO !== "" && endISO === iso;
            const inRange = start != null && end != null && date > start && date < end;
            cells.push({
                day,
                isStart,
                isEnd,
                inRange,
                isToday: iso === todayISO,
                disabled: this.isDisabled(date),
                selected: isStart || isEnd,
                label: `${monthName(this.locale, month)} ${day}, ${year}`,
            });
        }
        this.dayCells = cells;
    }
    renderDays(_year, _month) {
        if (this.dayCells.length === 0) {
            return nothing;
        }
        const blanks = [];
        for (let i = 0; i < this.leadingBlanks; i++) {
            blanks.push(html `<span class="cell empty" role="gridcell"></span>`);
        }
        const days = this.dayCells.map((c) => {
            const classes = classMap({
                cell: true,
                day: true,
                "range-start": c.isStart,
                "range-end": c.isEnd,
                "in-range": c.inRange,
                today: c.isToday && !c.isStart && !c.isEnd,
                disabled: c.disabled,
            });
            return html `
        <button
          class=${classes}
          role="gridcell"
          aria-selected=${c.selected ? "true" : "false"}
          aria-label=${c.label}
          tabindex=${c.selected ? "0" : "-1"}
          data-day=${c.day}
          ?disabled=${c.disabled}
          @click=${this.handleDayClick}
        >
          <span class="day-bg"></span>
          <span class="day-num">${c.day}</span>
        </button>
      `;
        });
        return [...blanks, ...days];
    }
    handleStartInput(event) {
        const input = event.target;
        this.startText = input.value;
        const parsed = parseDisplayLocale(input.value, this.locale, this.format);
        if (parsed && !this.isDisabled(parsed)) {
            this.start = toISO(parsed);
            this.normalizeOrder();
            this.emit("input");
        }
    }
    handleEndInput(event) {
        const input = event.target;
        this.endText = input.value;
        const parsed = parseDisplayLocale(input.value, this.locale, this.format);
        if (parsed && !this.isDisabled(parsed)) {
            this.end = toISO(parsed);
            this.normalizeOrder();
            this.emit("input");
        }
    }
    handleFieldCommit() {
        this.syncFieldsToValue();
        this.emit("change");
    }
    normalizeOrder() {
        const s = fromISO(this.start);
        const e = fromISO(this.end);
        if (s && e && s > e) {
            const tmp = this.start;
            this.start = this.end;
            this.end = tmp;
        }
    }
    handlePrev() {
        this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() - 1, 1);
    }
    handleNext() {
        this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() + 1, 1);
    }
    handleDayClick(event) {
        const button = event.currentTarget;
        const day = Number(button.dataset["day"]);
        if (!day) {
            return;
        }
        const date = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth(), day);
        if (this.isDisabled(date)) {
            return;
        }
        this.pick(date);
    }
    /**
     * Range-selection state machine: with no start (or a complete range), the
     * click sets a new start and clears the end; with a start but no end, the
     * click sets the end (swapping if earlier than the start).
     */
    pick(date) {
        const iso = toISO(date);
        const hasStart = fromISO(this.start) != null;
        const hasEnd = fromISO(this.end) != null;
        if (!hasStart || hasEnd) {
            this.start = iso;
            this.end = "";
        }
        else {
            const startDate = fromISO(this.start);
            if (date < startDate) {
                this.end = this.start;
                this.start = iso;
            }
            else {
                this.end = iso;
            }
        }
        this.syncFieldsToValue();
        this.emit("input");
        this.emit("change");
    }
    emit(native) {
        if (native) {
            this.dispatchEvent(new Event(native, { bubbles: true, composed: true }));
        }
        this.dispatchEvent(new CustomEvent("date-range-picker:change", {
            detail: { start: this.start, end: this.end },
            bubbles: true,
            composed: true,
        }));
    }
    /** The combined value, `start/end`, for native form-control consumption. */
    get value() {
        return `${this.start}/${this.end}`;
    }
    handleKeydown(event) {
        const deltas = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -7,
            ArrowDown: 7,
        };
        const delta = deltas[event.key];
        if (delta === undefined) {
            return;
        }
        event.preventDefault();
        // Navigate from the most recently set edge (end, else start, else today).
        const anchor = fromISO(this.end) ?? fromISO(this.start) ?? this.viewDate;
        const next = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + delta);
        if (this.isDisabled(next)) {
            return;
        }
        this.pick(next);
        this.viewDate = new Date(next.getFullYear(), next.getMonth(), 1);
        if (!isServer) {
            this.focusEdgeCell();
        }
    }
    focusEdgeCell() {
        this.updateComplete.then(() => {
            const root = this.renderRoot;
            const cell = root.querySelector(".cell.range-end, .cell.range-start");
            if (cell) {
                cell.focus();
            }
        });
    }
}
__decorate([
    property({ type: String })
], DateRangePicker.prototype, "start", void 0);
__decorate([
    property({ type: String })
], DateRangePicker.prototype, "end", void 0);
__decorate([
    property({ type: String })
], DateRangePicker.prototype, "min", void 0);
__decorate([
    property({ type: String })
], DateRangePicker.prototype, "max", void 0);
__decorate([
    property({ type: Boolean })
], DateRangePicker.prototype, "editable", void 0);
__decorate([
    property({ attribute: false })
], DateRangePicker.prototype, "disabledDate", void 0);
__decorate([
    property({ type: String })
], DateRangePicker.prototype, "locale", void 0);
__decorate([
    property({ type: String })
], DateRangePicker.prototype, "format", void 0);
__decorate([
    state()
], DateRangePicker.prototype, "viewDate", void 0);
__decorate([
    state()
], DateRangePicker.prototype, "startText", void 0);
__decorate([
    state()
], DateRangePicker.prototype, "endText", void 0);
//# sourceMappingURL=date-range-picker.js.map