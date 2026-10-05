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
export class SnackbarQueue {
  private readonly pending: SnackbarQueueMessage[] = [];
  private current: SnackbarQueueMessage | null = null;
  private actionButton: HTMLButtonElement | null = null;

  constructor(private readonly host: Snackbar) {
    this.host.addEventListener("closed", this.handleClosed as EventListener);
  }

  /** Number of messages waiting behind the one currently shown (if any). */
  get length(): number {
    return this.pending.length;
  }

  /** Whether a message is currently being shown. */
  get isShowing(): boolean {
    return this.current !== null;
  }

  /** Enqueues a message. Shows it immediately if the queue was idle. */
  enqueue(message: SnackbarQueueMessage): void {
    this.pending.push(message);
    if (!this.current) {
      this.showNext();
    }
  }

  /** Clears messages waiting behind the current one; it is left untouched. */
  clear(): void {
    this.pending.length = 0;
  }

  /** Immediately dismisses the current message so the next one can show. */
  async skip(): Promise<void> {
    await this.host.close("dismiss");
  }

  /** Detaches the queue from its host and drops pending messages. */
  dispose(): void {
    this.host.removeEventListener("closed", this.handleClosed as EventListener);
    this.clearActionButton();
    this.current = null;
    this.clear();
  }

  private showNext(): void {
    const message = this.pending.shift();
    if (!message) {
      this.current = null;
      return;
    }
    this.current = message;
    this.applyMessage(message);
    void this.host.show();
  }

  private applyMessage(message: SnackbarQueueMessage): void {
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

  private clearActionButton(): void {
    if (this.actionButton) {
      this.actionButton.remove();
      this.actionButton = null;
    }
  }

  private readonly handleClosed = (event: CustomEvent<{ reason: SnackbarCloseReason }>) => {
    const finished = this.current;
    this.clearActionButton();
    this.current = null;
    finished?.onClosed?.(event.detail.reason);
    this.showNext();
  };
}
