// SPDX-License-Identifier: Apache-2.0
/** Token bucket shared by every transfer of a process plus per-transfer caps (bytes per second). */
export class Throttle {
  private tokens: number;
  private last = performance.now();

  constructor(public rate: number) {
    this.tokens = rate;
  }

  /** Waits until `bytes` may pass; a rate of 0 means unlimited. */
  async take(bytes: number): Promise<void> {
    if (!this.rate) return;
    for (;;) {
      const now = performance.now();
      this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate);
      this.last = now;
      if (this.tokens >= bytes || this.tokens >= this.rate) {
        this.tokens -= bytes;
        return;
      }
      await Bun.sleep(Math.min(250, Math.ceil(((bytes - this.tokens) / this.rate) * 1000)));
    }
  }
}

/** Splits a chunk so a slow limit still reports smooth progress. */
export function* slices(chunk: Uint8Array, size: number): Generator<Uint8Array> {
  for (let i = 0; i < chunk.length; i += size) yield chunk.subarray(i, Math.min(chunk.length, i + size));
}
