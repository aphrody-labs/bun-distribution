/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * The visual variants of a tooltip.
 *
 * - `plain` — a single line of supporting text on an inverse surface.
 * - `rich` — a container with an optional headline, supporting text and
 *   actions, persistent while hovered/focused.
 */
export type TooltipVariant = "plain" | "rich";
/**
 * A Material 3 tooltip displays informative text when a user hovers over,
 * focuses, or touches an anchor element.
 *
 * The tooltip anchors to its trigger using CSS Anchor Positioning when
 * available, falling back to a JS-computed absolute position otherwise. The
 * trigger is resolved from the `for` attribute (an element id) or, when absent,
 * from the tooltip's parent element / a slotted `trigger` element.
 *
 * Plain tooltips show on hover/focus after a short delay and auto-hide; rich
 * tooltips remain visible while the pointer is over the trigger or the tooltip
 * itself, so their actions stay reachable.
 *
 * @fires tooltip-show {Event} Fired when the tooltip becomes visible.
 * @fires tooltip-hide {Event} Fired when the tooltip is hidden.
 */
export declare class Tooltip extends LitElement {
    /** Tooltip variant: `plain` (default) or `rich`. Reflected for styling. */
    variant: TooltipVariant;
    private readonly tooltipId;
    /** Id of the anchor element this tooltip describes. */
    for: string;
    /** Supporting text for the plain variant (rich uses the default slot). */
    text: string;
    /** Delay in ms before a plain tooltip is shown on hover. */
    showDelay: number;
    /** Delay in ms before a plain tooltip auto-hides after showing. */
    hideDelay: number;
    /** Whether the tooltip is currently visible. Reflected so CSS can target it. */
    visible: boolean;
    private readonly surface;
    private anchorEl;
    private showTimer;
    private hideTimer;
    private pointerOverSurface;
    /** Shows the tooltip immediately and dispatches `tooltip-show`. */
    show(): void;
    /** Hides the tooltip and dispatches `tooltip-hide`. */
    hide(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected updated(changed: Map<string, unknown>): void;
    private resolveAnchor;
    private attachToAnchor;
    private detachFromAnchor;
    private readonly handleAnchorEnter;
    private readonly handleAnchorLeave;
    private readonly handleAnchorFocus;
    private readonly handleAnchorBlur;
    private readonly handleSurfaceEnter;
    private readonly handleSurfaceLeave;
    private scheduleShow;
    private scheduleHide;
    private clearTimers;
    /**
     * Positions the tooltip below its anchor. With CSS Anchor Positioning this is
     * handled declaratively in CSS; this fallback runs when that API is missing.
     */
    private position;
    protected render(): import("lit-html").TemplateResult<1>;
    private renderTriggerSlot;
}
