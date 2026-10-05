/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, nothing, TemplateResult } from "lit";
/**
 * A banner shows a prominent message and related optional actions. It
 * appears at the top of the screen, below a top app bar, and stays until the
 * user acts on it or dismisses it.
 *
 * The default slot holds the message (one or two lines depending on
 * `lines`); slot a leading icon or image into `slot="icon"` and up to two
 * actions (e.g. `<md-text-button>`) into `slot="action"`. Set `lines="two"`
 * for the multi-line layout, `stacked` to move the actions onto their own
 * row beneath the content (the M3 mobile two-line layout), and `closeable`
 * for a trailing dismiss affordance that fires a `close` event.
 *
 * ```html
 * <md-banner lines="two">
 *   <img slot="icon" src="…" alt="" />
 *   Two files could not be synced to this device because they are too large.
 *   <md-text-button slot="action">Dismiss</md-text-button>
 *   <md-text-button slot="action">Retry</md-text-button>
 * </md-banner>
 * ```
 *
 * @fires close {Event} Fired when the user activates the dismiss affordance.
 */
export declare class Banner extends LitElement {
    /** Whether the banner is shown. Reflected so CSS can target `[open]`. */
    open: boolean;
    /** `'single'` (default) shows one line of text; `'two'` allows two. */
    lines: "single" | "two";
    /**
     * Moves the actions onto their own row beneath the content instead of
     * trailing it inline — the M3 mobile layout for two-line banners.
     */
    stacked: boolean;
    /** Renders a bottom divider under the container. */
    divider: boolean;
    /**
     * When true, renders a trailing close (✕) affordance and lets Escape
     * dismiss the banner.
     */
    closeable: boolean;
    private readonly iconElements;
    private readonly actionElements;
    connectedCallback(): void;
    /** Shows the banner. */
    show(): void;
    /** Dismisses the banner and fires `close`. */
    dismiss(): void;
    protected render(): TemplateResult | typeof nothing;
    private handleIconSlotChange;
    private handleActionSlotChange;
    private renderCloseButton;
    private handleCloseClick;
    private handleKeydown;
}
