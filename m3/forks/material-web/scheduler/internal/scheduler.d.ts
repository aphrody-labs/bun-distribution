/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, TemplateResult } from "lit";
/** Supported scheduler views. */
export type SchedulerView = "day" | "week" | "month";
/** Direction passed to navigation handlers / surfaced on `scheduler:navigate`. */
export type SchedulerNavigateDirection = "prev" | "next" | "today";
/**
 * A calendar event as accepted on the `events` property. `start`/`end` may be
 * either a `Date` or an ISO 8601 string (parsed with the native `Date`
 * constructor). `color` is any CSS color applied to the event chip.
 */
export interface SchedulerEvent {
    id: string;
    start: Date | string;
    end: Date | string;
    title: string;
    color?: string;
}
/** A `SchedulerEvent` with its endpoints normalised to `Date`. */
export interface NormalizedSchedulerEvent {
    id: string;
    start: Date;
    end: Date;
    title: string;
    color?: string;
}
/** `detail` payload of `scheduler:select`. */
export interface SchedulerSelectDetail {
    /** The slot/day that was activated (local `Date`). */
    date: Date;
}
/** `detail` payload of `scheduler:event-click`. */
export interface SchedulerEventClickDetail {
    /** The normalised event that was activated. */
    event: NormalizedSchedulerEvent;
}
/** `detail` payload of `scheduler:navigate`. */
export interface SchedulerNavigateDetail {
    /** The navigation direction. */
    direction: SchedulerNavigateDirection;
    /** The new current date after navigation (local `Date`). */
    date: Date;
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
export declare class Scheduler extends LitElement {
    /** The active view. */
    view: SchedulerView;
    /** The current date as a local `YYYY-MM-DD` ISO string. */
    date: string;
    /**
     * The events to render. Each event's `start`/`end` may be a `Date` or an ISO
     * string. This is a property, not an attribute, and must be set in JS.
     */
    events: SchedulerEvent[];
    /** The resolved current date (defaults to today when `date` is empty/invalid). */
    private current;
    /** Memoised month grid (month view). */
    private monthCells;
    /** Memoised day columns (day/week views). */
    private dayColumns;
    connectedCallback(): void;
    willUpdate(changed: Map<string, unknown>): void;
    private syncCurrentToDate;
    /** Parses a local `YYYY-MM-DD` string into a midnight `Date`, or `null`. */
    private parseDate;
    /** Serialises a `Date` to a local `YYYY-MM-DD` string. */
    private toISODate;
    /** Normalises and validity-filters the `events` input. */
    private normalizeEvents;
    /** Recomputes the memoised grid for the active view. */
    private recompute;
    /** Builds the 6×7 month grid (leading/trailing days from adjacent months). */
    private computeMonth;
    /** Builds the day columns (1 for `day`, 7 for `week`) with positioned events. */
    private computeColumns;
    /** The seven days (Sun–Sat) of the week containing `current`. */
    private weekDays;
    /** Whether an event overlaps the given local day. */
    private eventTouchesDay;
    /** Clamps an event to the given day and converts to top/height percentages. */
    private positionEvent;
    protected render(): TemplateResult;
    private renderToolbar;
    private renderViewTab;
    /** Human-readable label for the current view/date. */
    private titleText;
    private renderMonth;
    private renderMonthCell;
    private renderTimeGrid;
    private renderHourLabels;
    private renderColumnHeader;
    private renderColumnBody;
    private hourLabel;
    private renderPositionedEvent;
    private renderEventChip;
    private handleViewClick;
    private handlePrev;
    private handleNext;
    private handleToday;
    /** Moves the current date per the view granularity and fires `scheduler:navigate`. */
    private navigate;
    private handleSlotClick;
    private handleSlotKeydown;
    private selectSlot;
    private handleEventClick;
}
