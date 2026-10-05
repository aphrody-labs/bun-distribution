/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, TemplateResult } from "lit";
/**
 * The semantic severity of an alert. Drives the default icon and the M3 color
 * role mapping.
 *
 * - `success` — uses the tertiary role family.
 * - `info` — uses the primary role family.
 * - `warning` — uses the secondary role family.
 * - `error` — uses the error role family.
 */
export type AlertSeverity = "success" | "info" | "warning" | "error";
/**
 * The visual variant of an alert.
 *
 * - `standard` — tonal container (the `*-container` role) with a tinted icon.
 * - `filled` — solid severity color with on-color content.
 * - `outlined` — transparent surface with a severity-colored outline.
 */
export type AlertVariant = "standard" | "filled" | "outlined";
/**
 * An alert displays a short, important message in a way that attracts the
 * user's attention without interrupting their task.
 *
 * Equivalent to MUI's `Alert` + `AlertTitle`. The default slot holds the
 * message; slot a heading into `slot="title"`, an action (e.g.
 * `<md-text-button>`) into `slot="action"`, and override the leading icon via
 * `slot="icon"`. Set `closeable` for a trailing dismiss affordance which fires
 * a `close` event.
 *
 * Colors map onto the real M3 `--md-sys-color-*` roles (error/tertiary/
 * secondary/primary families) with baseline fallbacks, so the component is
 * self-contained.
 *
 * @fires close {Event} Fired when the user activates the dismiss affordance.
 */
export declare class Alert extends LitElement {
    /** The semantic severity. Reflected so CSS can target `[severity="…"]`. */
    severity: AlertSeverity;
    /** The visual variant. Reflected so CSS can target `[variant="…"]`. */
    variant: AlertVariant;
    /** When true, renders a trailing close (✕) affordance. */
    closeable: boolean;
    private readonly iconElements;
    protected render(): TemplateResult;
    private handleIconSlotChange;
    private renderCloseButton;
    private handleCloseClick;
    private renderDefaultIcon;
}
