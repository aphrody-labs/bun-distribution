/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Snackbar, SnackbarCloseReason } from "./snackbar.js";
/** A single message enqueued onto a {@link SnackbarQueue}. */
export interface SnackbarQueueMessage {
    /** The supporting text, applied to the host's `labelText`. */
    labelText: string;
    /** Per-message auto-dismiss timeout in ms; defaults to the host's current `timeoutMs`. */
    timeoutMs?: number;
    /** Renders a trailing close affordance for this message. Defaults to `false`. */
    closeable?: boolean;
    /** Stacks the action beneath the text for this message. Defaults to `false`. */
    stacked?: boolean;
    /** Label of a single action button rendered into `slot="action"`. */
    actionLabel?: string;
    /** Invoked when the action button is activated (before the snackbar closes). */
    onAction?: () => void;
    /** Invoked once the message has finished closing, with the reason it closed for. */
    onClosed?: (reason: SnackbarCloseReason) => void;
}
/**
 * Material 3 guidance: only one snackbar is visible at a time; further
 * messages queue up and are shown once the current one finishes closing.
 * `SnackbarQueue` drives a single `<md-snackbar>` (or subclass) host,
 * serializing `enqueue()`d messages onto it — the small queue controller
 * companion to the `md-snackbar` element.
 *
 * ```ts
 * const queue = new SnackbarQueue(document.querySelector('md-snackbar')!);
 * queue.enqueue({labelText: 'Archived', actionLabel: 'Undo', onAction: undo});
 * queue.enqueue({labelText: 'Deleted'}); // shown once the first message closes
 * ```
 */
export declare class SnackbarQueue {
    private readonly host;
    private readonly pending;
    private current;
    private actionButton;
    constructor(host: Snackbar);
    /** Number of messages waiting behind the one currently shown (if any). */
    get length(): number;
    /** Whether a message is currently being shown. */
    get isShowing(): boolean;
    /** Enqueues a message. Shows it immediately if the queue was idle. */
    enqueue(message: SnackbarQueueMessage): void;
    /** Clears messages waiting behind the current one; it is left untouched. */
    clear(): void;
    /** Immediately dismisses the current message so the next one can show. */
    skip(): Promise<void>;
    /** Detaches the queue from its host and drops pending messages. */
    dispose(): void;
    private showNext;
    private applyMessage;
    private clearActionButton;
    private readonly handleClosed;
}
