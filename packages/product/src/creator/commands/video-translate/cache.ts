/** Content-hash keyed JSON cache stored next to the output (`.vt-cache/`). */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const sha256 = (value: string | Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");

/** Stable hash of any JSON-serialisable parts. */
export const keyOf = (...parts: unknown[]): string =>
  sha256(JSON.stringify(parts));

export class Cache {
  hits = 0;
  writes = 0;
  private ready = false;

  /** `read` is only true with --resume; writes always happen unless `write` is false (dry run). */
  constructor(
    readonly dir: string,
    private readonly read: boolean,
    private readonly write = true,
  ) {}

  private path(kind: string, key: string): string {
    return join(this.dir, `${kind}-${key.slice(0, 32)}.json`);
  }

  async get<T>(kind: string, key: string): Promise<T | undefined> {
    if (!this.read) return undefined;
    const file = Bun.file(this.path(kind, key));
    if (!(await file.exists())) return undefined;
    try {
      const value = (await file.json()) as { key: string; value: T };
      if (value.key !== key) return undefined;
      this.hits += 1;
      return value.value;
    } catch {
      return undefined;
    }
  }

  async set<T>(kind: string, key: string, value: T): Promise<void> {
    if (!this.write) return;
    if (!this.ready) {
      await mkdir(this.dir, { recursive: true });
      this.ready = true;
    }
    await Bun.write(this.path(kind, key), JSON.stringify({ key, value }));
    this.writes += 1;
  }
}
