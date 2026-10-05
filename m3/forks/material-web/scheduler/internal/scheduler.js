/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
/** Minutes in a day — used for vertical positioning in day/week views. */
const MINUTES_PER_DAY = 24 * 60;
/** Pads a number to a two-digit string. */
function pad2(n) {
    return n < 10 ? `0${n}` : String(n);
}
/** Coerces a `Date | string` into a `Date` (invalid inputs become `Invalid Date`). */
function toDate(value) {
    return value instanceof Date ? value : new Date(value);
}
/** Midnight (local) of the given date. */
function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
/** Whether two dates fall on the same local calendar day. */
function isSameDay(a, b) {
    return (a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate());
}
/** Adds `days` to a date, returning a new local `Date`. */
function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
/** The Sunday that starts the week containing `date`. */
function startOfWeek(date) {
    return addDays(startOfDay(date), -date.getDay());
}
/**
 * A Material 3 scheduler / calendar. Renders a `day`, `week`, or `month` view
 * computed from real `Date` arithmetic, with prev/next/today navigation and a
 * settable current `date`. Events supplied on the `events` property are laid
 * out into month cells or positioned vertically by time in the day/week time
 * grid.
 *
 * This is a Community baseline: it does not implement drag-and-drop, event
 * resize, recurrence, or resource/timeline rows (those are MUI X Pro/Premium
 * concerns and are intentionally out of scope).
 *
 * Grid math is memoised in `willUpdate` so `render()` stays pure. The element
 * is self-contained on the `--md-sys-*` tokens.
 *
 * @fires scheduler:select {CustomEvent<SchedulerSelectDetail>} Fired when an
 *     empty slot or day cell is activated.
 * @fires scheduler:event-click {CustomEvent<SchedulerEventClickDetail>} Fired
 *     when an event chip is activated.
 * @fires scheduler:navigate {CustomEvent<SchedulerNavigateDetail>} Fired when
 *     the view is navigated (prev/next/today).
 */
export class Scheduler extends LitElement {
    constructor() {
        super(...arguments);
        /** The active view. */
        this.view = "week";
        /** The current date as a local `YYYY-MM-DD` ISO string. */
        this.date = "";
        /**
         * The events to render. Each event's `start`/`end` may be a `Date` or an ISO
         * string. This is a property, not an attribute, and must be set in JS.
         */
        this.events = [];
        /** The resolved current date (defaults to today when `date` is empty/invalid). */
        this.current = startOfDay(new Date());
        /** Memoised month grid (month view). */
        this.monthCells = [];
        /** Memoised day columns (day/week views). */
        this.dayColumns = [];
    }
    connectedCallback() {
        super.connectedCallback();
        this.setAttribute("role", "grid");
        this.syncCurrentToDate();
    }
    willUpdate(changed) {
        if (changed.has("date")) {
            this.syncCurrentToDate();
        }
        if (changed.has("date") ||
            changed.has("current") ||
            changed.has("view") ||
            changed.has("events")) {
            this.recompute();
        }
    }
    syncCurrentToDate() {
        const parsed = this.parseDate(this.date);
        this.current = parsed ?? startOfDay(new Date());
    }
    /** Parses a local `YYYY-MM-DD` string into a midnight `Date`, or `null`. */
    parseDate(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
        if (!match) {
            return null;
        }
        const year = Number(match[1]);
        const month = Number(match[2]) - 1;
        const day = Number(match[3]);
        const date = new Date(year, month, day);
        if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
            return null;
        }
        return date;
    }
    /** Serialises a `Date` to a local `YYYY-MM-DD` string. */
    toISODate(date) {
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    }
    /** Normalises and validity-filters the `events` input. */
    normalizeEvents() {
        const result = [];
        for (const event of this.events) {
            const start = toDate(event.start);
            const end = toDate(event.end);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
                continue;
            }
            result.push({
                id: event.id,
                start,
                end,
                title: event.title,
                color: event.color,
            });
        }
        return result;
    }
    /** Recomputes the memoised grid for the active view. */
    recompute() {
        const events = this.normalizeEvents();
        if (this.view === "month") {
            this.computeMonth(events);
            this.dayColumns = [];
        }
        else {
            this.computeColumns(events);
            this.monthCells = [];
        }
    }
    /** Builds the 6×7 month grid (leading/trailing days from adjacent months). */
    computeMonth(events) {
        const year = this.current.getFullYear();
        const month = this.current.getMonth();
        const firstOfMonth = new Date(year, month, 1);
        const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay());
        const today = startOfDay(new Date());
        const cells = [];
        for (let i = 0; i < 42; i++) {
            const date = addDays(gridStart, i);
            cells.push({
                date,
                day: date.getDate(),
                inMonth: date.getMonth() === month,
                isToday: isSameDay(date, today),
                label: `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`,
                events: events
                    .filter((event) => this.eventTouchesDay(event, date))
                    .sort((a, b) => a.start.getTime() - b.start.getTime()),
            });
        }
        this.monthCells = cells;
    }
    /** Builds the day columns (1 for `day`, 7 for `week`) with positioned events. */
    computeColumns(events) {
        const today = startOfDay(new Date());
        const days = this.view === "day" ? [startOfDay(this.current)] : this.weekDays();
        this.dayColumns = days.map((date) => ({
            date,
            isToday: isSameDay(date, today),
            label: `${WEEKDAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}`,
            events: events
                .filter((event) => this.eventTouchesDay(event, date))
                .sort((a, b) => a.start.getTime() - b.start.getTime())
                .map((event) => this.positionEvent(event, date)),
        }));
    }
    /** The seven days (Sun–Sat) of the week containing `current`. */
    weekDays() {
        const start = startOfWeek(this.current);
        const days = [];
        for (let i = 0; i < 7; i++) {
            days.push(addDays(start, i));
        }
        return days;
    }
    /** Whether an event overlaps the given local day. */
    eventTouchesDay(event, day) {
        const dayStart = startOfDay(day);
        const dayEnd = addDays(dayStart, 1);
        return event.start < dayEnd && event.end > dayStart;
    }
    /** Clamps an event to the given day and converts to top/height percentages. */
    positionEvent(event, day) {
        const dayStart = startOfDay(day);
        const startMin = Math.max(0, (event.start.getTime() - dayStart.getTime()) / 60000);
        const endMin = Math.min(MINUTES_PER_DAY, (event.end.getTime() - dayStart.getTime()) / 60000);
        const top = (startMin / MINUTES_PER_DAY) * 100;
        const height = Math.max(1, ((endMin - startMin) / MINUTES_PER_DAY) * 100);
        return { event, top, height };
    }
    render() {
        return html `
      <div class="scheduler">
        ${this.renderToolbar()}
        ${this.view === "month" ? this.renderMonth() : this.renderTimeGrid()}
      </div>
    `;
    }
    renderToolbar() {
        return html `
      <div class="toolbar">
        <div class="nav-group">
          <button class="nav" aria-label="Previous" @click=${this.handlePrev}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z"></path>
            </svg>
          </button>
          <button class="today" @click=${this.handleToday}>Today</button>
          <button class="nav" aria-label="Next" @click=${this.handleNext}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6z"></path>
            </svg>
          </button>
        </div>
        <span class="title">${this.titleText()}</span>
        <div class="views" role="tablist" aria-label="Calendar view">
          ${["day", "week", "month"].map((view) => this.renderViewTab(view))}
        </div>
      </div>
    `;
    }
    renderViewTab(view) {
        const selected = this.view === view;
        return html `
      <button
        class=${classMap({ "view-tab": true, selected })}
        role="tab"
        aria-selected=${selected ? "true" : "false"}
        data-view=${view}
        @click=${this.handleViewClick}
      >
        ${view.charAt(0).toUpperCase() + view.slice(1)}
      </button>
    `;
    }
    /** Human-readable label for the current view/date. */
    titleText() {
        const year = this.current.getFullYear();
        if (this.view === "month") {
            return `${MONTHS[this.current.getMonth()]} ${year}`;
        }
        if (this.view === "day") {
            return `${WEEKDAYS[this.current.getDay()]}, ${MONTHS[this.current.getMonth()]} ${this.current.getDate()}, ${year}`;
        }
        const start = startOfWeek(this.current);
        const end = addDays(start, 6);
        if (start.getMonth() === end.getMonth()) {
            return `${MONTHS[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${year}`;
        }
        return `${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${year}`;
    }
    renderMonth() {
        return html `
      <div class="month">
        <div class="weekdays" role="row">
          ${WEEKDAYS.map((d) => html `<span class="weekday" role="columnheader">${d}</span>`)}
        </div>
        <div class="month-grid">${this.monthCells.map((c) => this.renderMonthCell(c))}</div>
      </div>
    `;
    }
    renderMonthCell(cell) {
        const classes = classMap({
            "month-cell": true,
            "out-of-month": !cell.inMonth,
            today: cell.isToday,
        });
        return html `
      <div
        class=${classes}
        role="gridcell"
        aria-label=${cell.label}
        tabindex="-1"
        data-date=${this.toISODate(cell.date)}
        @click=${this.handleSlotClick}
        @keydown=${this.handleSlotKeydown}
      >
        <span class="month-day-number">${cell.day}</span>
        <div class="month-events">
          ${cell.events.map((event) => this.renderEventChip(event, true))}
        </div>
      </div>
    `;
    }
    renderTimeGrid() {
        return html `
      <div class=${classMap({ "time-grid": true, single: this.view === "day" })}>
        <div class="time-axis" aria-hidden="true">${this.renderHourLabels()}</div>
        <div class="columns">
          ${this.dayColumns.map((column) => this.renderColumnHeader(column))}
          ${this.dayColumns.map((column) => this.renderColumnBody(column))}
        </div>
      </div>
    `;
    }
    renderHourLabels() {
        const labels = [];
        for (let hour = 0; hour < 24; hour++) {
            const label = hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`;
            labels.push(html `<span class="hour-label">${label}</span>`);
        }
        return labels;
    }
    renderColumnHeader(column) {
        return html `
      <div class=${classMap({ "column-header": true, today: column.isToday })} role="columnheader">
        ${column.label}
      </div>
    `;
    }
    renderColumnBody(column) {
        const hours = [];
        for (let hour = 0; hour < 24; hour++) {
            const slotDate = new Date(column.date.getFullYear(), column.date.getMonth(), column.date.getDate(), hour);
            hours.push(html `
        <div
          class="hour-slot"
          role="gridcell"
          aria-label=${`${column.label}, ${this.hourLabel(hour)}`}
          tabindex="-1"
          data-date=${slotDate.toISOString()}
          @click=${this.handleSlotClick}
          @keydown=${this.handleSlotKeydown}
        ></div>
      `);
        }
        return html `
      <div class="column-body">
        ${hours}
        <div class="column-events">
          ${column.events.map((positioned) => this.renderPositionedEvent(positioned))}
        </div>
      </div>
    `;
    }
    hourLabel(hour) {
        if (hour === 0) {
            return "12 AM";
        }
        if (hour < 12) {
            return `${hour} AM`;
        }
        if (hour === 12) {
            return "12 PM";
        }
        return `${hour - 12} PM`;
    }
    renderPositionedEvent(positioned) {
        const style = styleMap({
            top: `${positioned.top}%`,
            height: `${positioned.height}%`,
            ...(positioned.event.color ? { "background-color": positioned.event.color } : {}),
        });
        return html `
      <button
        class="event positioned"
        style=${style}
        data-event-id=${positioned.event.id}
        @click=${this.handleEventClick}
      >
        <span class="event-title">${positioned.event.title}</span>
      </button>
    `;
    }
    renderEventChip(event, compact) {
        const style = event.color ? styleMap({ "background-color": event.color }) : nothing;
        return html `
      <button
        class=${classMap({ event: true, chip: compact })}
        style=${style}
        data-event-id=${event.id}
        @click=${this.handleEventClick}
      >
        <span class="event-title">${event.title}</span>
      </button>
    `;
    }
    handleViewClick(event) {
        const button = event.currentTarget;
        const view = button.dataset["view"];
        if (view && view !== this.view) {
            this.view = view;
        }
    }
    handlePrev() {
        this.navigate("prev");
    }
    handleNext() {
        this.navigate("next");
    }
    handleToday() {
        this.navigate("today");
    }
    /** Moves the current date per the view granularity and fires `scheduler:navigate`. */
    navigate(direction) {
        let next;
        if (direction === "today") {
            next = startOfDay(new Date());
        }
        else {
            const sign = direction === "next" ? 1 : -1;
            if (this.view === "month") {
                next = new Date(this.current.getFullYear(), this.current.getMonth() + sign, this.current.getDate());
            }
            else if (this.view === "week") {
                next = addDays(this.current, 7 * sign);
            }
            else {
                next = addDays(this.current, sign);
            }
        }
        this.date = this.toISODate(next);
        this.current = next;
        this.dispatchEvent(new CustomEvent("scheduler:navigate", {
            detail: { direction, date: next },
            bubbles: true,
            composed: true,
        }));
    }
    handleSlotClick(event) {
        const target = event.currentTarget;
        this.selectSlot(target.dataset["date"]);
    }
    handleSlotKeydown(event) {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }
        event.preventDefault();
        const target = event.currentTarget;
        this.selectSlot(target.dataset["date"]);
    }
    selectSlot(raw) {
        if (!raw) {
            return;
        }
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) {
            return;
        }
        this.dispatchEvent(new CustomEvent("scheduler:select", {
            detail: { date },
            bubbles: true,
            composed: true,
        }));
    }
    handleEventClick(domEvent) {
        domEvent.stopPropagation();
        const button = domEvent.currentTarget;
        const id = button.dataset["eventId"];
        if (!id) {
            return;
        }
        const found = this.normalizeEvents().find((event) => event.id === id);
        if (!found) {
            return;
        }
        this.dispatchEvent(new CustomEvent("scheduler:event-click", {
            detail: { event: found },
            bubbles: true,
            composed: true,
        }));
    }
}
__decorate([
    property({ type: String, reflect: true })
], Scheduler.prototype, "view", void 0);
__decorate([
    property({ type: String })
], Scheduler.prototype, "date", void 0);
__decorate([
    property({ attribute: false })
], Scheduler.prototype, "events", void 0);
__decorate([
    state()
], Scheduler.prototype, "current", void 0);
//# sourceMappingURL=scheduler.js.map