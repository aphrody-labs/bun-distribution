/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * The reason a snackbar closed, surfaced on the `closed`/`closing` events'
 * `detail.reason`.
 *
 * - `timeout` — the auto-dismiss timer elapsed.
 * - `action` — the user activated the action button.
 * - `dismiss` — the user activated the close affordance (or pressed Escape).
 * - `programmatic` — `close()` was called without a reason.
 */
export type SnackbarCloseReason = "timeout" | "action" | "dismiss" | "programmatic";
/**
 * A snackbar shows short, low-priority feedback about a process the app has
 * performed or will perform. It appears at the bottom of the screen, never
 * interrupts the user, and disappears on its own.
 *
 * Implements the Material 3 snackbar spec on top of the `--md-sys-*` tokens.
 * The surface uses the Popover API (`popover="manual"`) so it lives in the
 * browser top layer — it can never be occluded by dialogs or other overlays,
 * and multiple toasts coexist (the M3-recommended toast pattern). Entry/exit is
 * animated declaratively via `@starting-style` + `transition-behavior:
 * allow-discrete`, with a graceful fallback when the Popover API is absent.
 *
 * @fires opening {Event} Fired when the snackbar begins to open.
 * @fires opened {Event} Fired once the open animation finishes.
 * @fires closing {CustomEvent<{reason: SnackbarCloseReason}>} Fired when the
 *     snackbar begins to close. Cancelable: prevent default to keep it open.
 * @fires closed {CustomEvent<{reason: SnackbarCloseReason}>} Fired once the
 *     close animation finishes.
 */
export declare class Snackbar extends LitElement {
    /** Whether the snackbar is open. Reflected so CSS can target `[open]`. */
    open: boolean;
    /**
     * Auto-dismiss timeout in milliseconds. The M3 guidance is 4–10 s; the
     * default is 5 s. Set to a value `<= 0` to disable auto-dismiss (the
     * snackbar then stays until `close()` or the close affordance is used).
     */
    timeoutMs: number;
    /** Supporting text shown in the snackbar (alternative to the default slot). */
    labelText: string;
    /**
     * When true, renders a trailing close (✕) affordance and lets Escape dismiss
     * the snackbar.
     */
    closeable: boolean;
    /**
     * Stacks the action beneath the text. M3 uses this two-line layout when the
     * text plus action would not fit on a single line.
     */
    stacked: boolean;
    private readonly surface;
    private readonly actionElements;
    private timer;
    /**
     * Opens the snackbar and starts the auto-dismiss timer. Resolves after the
     * surface has been promoted to the top layer. Re-showing an already-open
     * snackbar restarts the timer.
     */
    show(): Promise<void>;
    /**
     * Closes the snackbar. Dispatches a cancelable `closing` event; if it is
     * prevented the snackbar stays open.
     */
    close(reason?: SnackbarCloseReason): Promise<void>;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected updated(changed: Map<string, unknown>): void;
    /** Promote the surface to the top layer (no-op without Popover API). */
    private showSurface;
    /** Remove the surface from the top layer (no-op without Popover API). */
    private hideSurface;
    protected render(): import("lit-html").TemplateResult<1>;
    private renderCloseButton;
    private handleCloseClick;
    private handleActionClick;
    private handleKeydown;
    private readonly pause;
    private readonly resume;
    private startTimer;
    private clearTimer;
}
