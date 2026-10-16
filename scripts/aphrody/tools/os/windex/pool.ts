// SPDX-License-Identifier: Apache-2.0
// Bounded worker pool: batches are dispatched to the least busy worker and complete in any order. Back-pressure is
// the caller's `await submit()`, which resolves once a worker slot is free.
import type { EntryRecord, Task } from "./analyze.ts";
import type { CatalogSignature } from "./catalog.ts";

type Pending = { resolve: (r: unknown[]) => void; reject: (e: Error) => void };
type Slot = { w: Worker; busy: number };

export class Pool {
  private workers: Slot[] = [];
  private pending = new Map<number, Pending>();
  private waiters: (() => void)[] = [];
  private nextId = 1;

  constructor(
    size: number,
    private maxInFlightPerWorker = 2,
  ) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url).href);
      const slot = { w, busy: 0 };
      w.onmessage = (e: MessageEvent<{ id: number; records: unknown[] }>) => {
        slot.busy--;
        const p = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        p?.resolve(e.data.records);
        this.waiters.shift()?.();
      };
      w.onerror = (e) => {
        slot.busy = 0;
        for (const [id, p] of this.pending) {
          p.reject(new Error(`worker windex : ${e.message}`));
          this.pending.delete(id);
        }
      };
      this.workers.push(slot);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  private async slot(): Promise<Slot> {
    for (;;) {
      const free = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
      if (free.busy < this.maxInFlightPerWorker) return free;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private async post<T>(message: object): Promise<{ done: Promise<T[]> }> {
    const slot = await this.slot();
    const id = this.nextId++;
    slot.busy++;
    const done = new Promise<T[]>((resolve, reject) =>
      this.pending.set(id, {
        resolve: resolve as (r: unknown[]) => void,
        reject,
      }),
    );
    slot.w.postMessage({ id, ...message });
    return { done };
  }

  /**
   * Waits for capacity, then returns the batch's pending result. The promise is wrapped in an object: an async
   * function returning a promise would adopt it and wait for the whole batch, defeating the pipelining.
   */
  submit(tasks: Task[]): Promise<{ done: Promise<EntryRecord[]> }> {
    return this.post<EntryRecord>({ tasks });
  }

  /** Analyses one batch and waits for its records. */
  async run(tasks: Task[]): Promise<EntryRecord[]> {
    return await (
      await this.submit(tasks)
    ).done;
  }

  /** Deferred catalog lookups of a batch of paths (same order). */
  catalogs(
    paths: string[],
  ): Promise<{ done: Promise<(CatalogSignature | null)[]> }> {
    return this.post<CatalogSignature | null>({ catalog: paths });
  }

  close(): void {
    for (const { w } of this.workers) w.terminate();
    this.workers = [];
  }
}
