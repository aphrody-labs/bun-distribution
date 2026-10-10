// SPDX-License-Identifier: Apache-2.0
//
// Mass scripting: run thousands of X operations from a Bun script with the concurrency, retry,
// rate-limit waiting, pacing and checkpoint of the Rust runner (crates/web/x/src/batch.rs). The
// operations are dispatched in input order and finish out of order; each result carries its `id`.
//
//   const client = new XClient();
//   const run = xBatch(client, handles.map((h) => ({ id: h, op: "user_by_screen_name", args: { handle: h } })), {
//     concurrency: 8,
//     checkpoint: "users.jsonl",        // a rerun resumes from the results already written
//     onProgress: ({ completed, total }) => console.error(`${completed}/${total}`),
//   });
//   for await (const result of run) if (result.ok) save(result.data);
//   console.log(run.summary);
//
// One failing operation never stops the others, except an `auth` failure (a dead session): the
// remaining operations are then reported `not_run`. Cancelling (`signal` or `run.cancel()`) aborts
// the operations in flight; the checkpoint keeps every completed result.

import {
  xBatchCancel,
  xBatchPoll,
  type XBatchOpInput,
  type XBatchOptions,
  type XBatchPoll,
  type XBatchSummary,
  type XEnvelope,
} from "@aphrody/bun/x";
import type { XClient } from "./core/client";

export type { XBatchOpInput, XBatchOptions, XBatchSummary, XEnvelope };

/** One finished operation of a batch (the envelope of the native runner). */
export type XBatchResult<T = unknown> = XEnvelope<T>;

/** Progress of a batch, reported after every drain. */
export interface XBatchProgress {
  completed: number;
  total: number;
  pending: number;
}

export interface XBatchRunOptions extends XBatchOptions {
  /** Aborts the batch: in-flight operations are cancelled and the iteration ends. */
  signal?: AbortSignal;
  /** Called after every drain of results. */
  onProgress?: (progress: XBatchProgress) => void;
  /** Results drained per poll (default 256). */
  drain?: number;
}

/** How a batch ended, beyond the native reasons. */
export type XBatchEnd = XBatchSummary["stopped_by"] | "aborted";

export interface XBatchRunSummary extends Omit<XBatchSummary, "stopped_by"> {
  stopped_by: XBatchEnd;
}

/**
 * A running batch. Iterate it for the results as they finish; `summary` is set when the iteration
 * ends. Iterate once.
 */
export class XBatch<T = unknown> implements AsyncIterable<XBatchResult<T>> {
  /** The operations submitted. */
  public readonly total: number;
  /** Set when the iteration has ended. */
  public summary: XBatchRunSummary | null = null;

  private readonly id: number;
  private readonly options: XBatchRunOptions;
  private finished = false;
  private started = false;

  constructor(client: XClient, ops: readonly XBatchOpInput[], options: XBatchRunOptions = {}) {
    const { signal: _signal, onProgress: _onProgress, drain: _drain, ...native } = options;
    this.options = options;
    const submitted = client.batchSubmit(ops, native);
    this.id = submitted.batch;
    this.total = submitted.total;
  }

  /** Stop dispatching and abort the operations in flight. The iteration ends. */
  public cancel(): void {
    if (!this.finished) xBatchCancel(this.id);
    this.finished = true;
  }

  public async *[Symbol.asyncIterator](): AsyncGenerator<XBatchResult<T>, void, undefined> {
    if (this.started) throw new Error("an XBatch can be iterated once");
    this.started = true;
    const { signal, onProgress } = this.options;
    const drain = this.options.drain ?? 256;
    let delay = 1;
    try {
      for (;;) {
        if (signal?.aborted) return this.abort();
        const poll: XBatchPoll = xBatchPoll(this.id, drain);
        for (const item of poll.items) yield item as XBatchResult<T>;
        onProgress?.({ completed: poll.completed, total: poll.total, pending: poll.pending });
        if (poll.done) {
          this.finished = true;
          this.summary = (poll.summary ?? {
            total: poll.total,
            ok: 0,
            failed: 0,
            resumed: 0,
            not_run: 0,
            elapsed_ms: 0,
            stopped_by: null,
          }) as XBatchRunSummary;
          return;
        }
        if (poll.items.length > 0) {
          delay = 1;
        } else {
          // oxlint-disable-next-line no-await-in-loop -- sondage avec backoff : chaque interrogation attend le délai courant avant la suivante
          await Bun.sleep(delay);
          delay = Math.min(delay * 2, 25);
        }
      }
    } finally {
      // The consumer broke out of the loop, or a poll threw: do not leave the batch running.
      if (!this.finished) this.cancel();
    }
  }

  private abort(): void {
    this.cancel();
    this.summary = {
      total: this.total,
      ok: 0,
      failed: 0,
      resumed: 0,
      not_run: 0,
      elapsed_ms: 0,
      stopped_by: "aborted",
    };
  }

  /** Drain the whole batch into an array (use `for await` for large batches). */
  public async collect(): Promise<XBatchResult<T>[]> {
    const out: XBatchResult<T>[] = [];
    for await (const item of this) out.push(item);
    return out;
  }
}

/** Start a batch of operations on `client`. */
export function xBatch<T = unknown>(
  client: XClient,
  ops: readonly XBatchOpInput[],
  options: XBatchRunOptions = {},
): XBatch<T> {
  return new XBatch<T>(client, ops, options);
}

/**
 * Run a pure or local native operation (parsers, catalog, ranking, features) synchronously, with no
 * client and no network. Throws the failure as an `XError`. `xLocal("meta")` serves the operation
 * table, the error taxonomy and the surface constants.
 */
export { local as xLocal } from "./core/local";
