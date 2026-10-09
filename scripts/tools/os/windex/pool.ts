// SPDX-License-Identifier: Apache-2.0
// Bounded worker pool: batches of tasks are dispatched to the least busy worker; results come back in batch order
// per worker but batches complete in any order. Back-pressure is the caller's `await submit()`.
import type { EntryRecord, Task } from "./analyze.ts";

type Pending = { resolve: (r: EntryRecord[]) => void; reject: (e: Error) => void };

export class Pool {
  private workers: { w: Worker; busy: number }[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(
    size: number,
    private maxInFlightPerWorker = 2,
  ) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url).href);
      const slot = { w, busy: 0 };
      w.onmessage = (e: MessageEvent<{ id: number; records: EntryRecord[] }>) => {
        slot.busy--;
        const p = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        p?.resolve(e.data.records);
        this.wake();
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

  private waiters: (() => void)[] = [];
  private wake() {
    const fn = this.waiters.shift();
    fn?.();
  }

  private async slot(): Promise<{ w: Worker; busy: number }> {
    for (;;) {
      const free = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
      if (free.busy < this.maxInFlightPerWorker) return free;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  /** Waits for capacity, then returns the promise of the batch's records. */
  async submit(tasks: Task[]): Promise<Promise<EntryRecord[]>> {
    const slot = await this.slot();
    const id = this.nextId++;
    slot.busy++;
    const done = new Promise<EntryRecord[]>((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
    slot.w.postMessage({ id, tasks });
    return done;
  }

  close(): void {
    for (const { w } of this.workers) w.terminate();
    this.workers = [];
  }
}
