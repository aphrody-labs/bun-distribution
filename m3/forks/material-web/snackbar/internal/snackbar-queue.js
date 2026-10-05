/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
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
export class SnackbarQueue {
    constructor(host) {
        this.host = host;
        this.pending = [];
        this.current = null;
        this.actionButton = null;
        this.handleClosed = (event) => {
            const finished = this.current;
            this.clearActionButton();
            this.current = null;
            finished?.onClosed?.(event.detail.reason);
            this.showNext();
        };
        this.host.addEventListener("closed", this.handleClosed);
    }
    /** Number of messages waiting behind the one currently shown (if any). */
    get length() {
        return this.pending.length;
    }
    /** Whether a message is currently being shown. */
    get isShowing() {
        return this.current !== null;
    }
    /** Enqueues a message. Shows it immediately if the queue was idle. */
    enqueue(message) {
        this.pending.push(message);
        if (!this.current) {
            this.showNext();
        }
    }
    /** Clears messages waiting behind the current one; it is left untouched. */
    clear() {
        this.pending.length = 0;
    }
    /** Immediately dismisses the current message so the next one can show. */
    async skip() {
        await this.host.close("dismiss");
    }
    /** Detaches the queue from its host and drops pending messages. */
    dispose() {
        this.host.removeEventListener("closed", this.handleClosed);
        this.clearActionButton();
        this.current = null;
        this.clear();
    }
    showNext() {
        const message = this.pending.shift();
        if (!message) {
            this.current = null;
            return;
        }
        this.current = message;
        this.applyMessage(message);
        void this.host.show();
    }
    applyMessage(message) {
        this.host.labelText = message.labelText;
        this.host.timeoutMs = message.timeoutMs ?? this.host.timeoutMs;
        this.host.closeable = message.closeable ?? false;
        this.host.stacked = message.stacked ?? false;
        this.clearActionButton();
        if (message.actionLabel) {
            const button = document.createElement("button");
            button.slot = "action";
            button.textContent = message.actionLabel;
            button.addEventListener("click", () => message.onAction?.());
            this.host.appendChild(button);
            this.actionButton = button;
        }
    }
    clearActionButton() {
        if (this.actionButton) {
            this.actionButton.remove();
            this.actionButton = null;
        }
    }
}
//# sourceMappingURL=snackbar-queue.js.map