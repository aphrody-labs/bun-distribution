// SPDX-License-Identifier: Apache-2.0
import { NativeRedisClient, RedisUnavailableError } from "./client";

export function validateNamespace(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new TypeError(
      "Redis namespace must contain 1-128 letters, numbers, dots, underscores or hyphens",
    );
  }
}

export function validateRecordId(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new TypeError("Redis record ID must contain 1-512 characters");
  }
}

export function validatePageSize(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a nonnegative safe integer`);
}

export function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface RecordBackend {
  read(): Promise<Map<string, string>>;
  write(id: string, value: string): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  validateWrite?(value: string): void;
  acceptWrite?(value: string): void;
  acceptClear?(): void;
}

export interface RedisPersistenceState {
  connected: boolean;
  pendingWrites: number;
  clearPending: boolean;
}

/** One serialized owner for authoritative snapshots and unacknowledged mutations. */
export class IndexedRecords {
  readonly #client: NativeRedisClient;
  readonly #backend: RecordBackend;
  #snapshot = new Map<string, string>();
  readonly #pending = new Map<string, string | null>();
  #clearPending = false;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(client: NativeRedisClient, backend: RecordBackend) {
    this.#client = client;
    this.#backend = backend;
  }

  get persistenceState(): RedisPersistenceState {
    return {
      connected: this.#client.isConnected,
      pendingWrites: this.#pending.size,
      clearPending: this.#clearPending,
    };
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(operation);
    this.#tail = next.catch(() => {});
    return next;
  }

  async #reconcile(refresh: boolean): Promise<void> {
    try {
      if (this.#clearPending) {
        await this.#backend.clear();
        this.#snapshot.clear();
        this.#clearPending = false;
      }
      for (const [id, value] of this.#pending) {
        if (value === null) {
          // oxlint-disable-next-line no-await-in-loop -- écritures séquentielles dans l'ordre d'insertion : la persistance doit rester ordonnée
          await this.#backend.remove(id);
          this.#snapshot.delete(id);
        } else {
          // oxlint-disable-next-line no-await-in-loop -- écritures séquentielles dans l'ordre d'insertion : la persistance doit rester ordonnée
          await this.#backend.write(id, value);
          this.#snapshot.set(id, value);
        }
        this.#pending.delete(id);
      }
      if (refresh) this.#snapshot = await this.#backend.read();
    } catch (error) {
      if (!(error instanceof RedisUnavailableError)) throw error;
    }
  }

  #view(): Map<string, string> {
    const view = this.#clearPending ? new Map<string, string>() : new Map(this.#snapshot);
    for (const [id, value] of this.#pending) {
      if (value === null) view.delete(id);
      else view.set(id, value);
    }
    return view;
  }

  async values(): Promise<Map<string, string>> {
    return this.#serialize(async () => {
      await this.#reconcile(true);
      return this.#view();
    });
  }

  async put(id: string, value: string): Promise<void> {
    return this.#serialize(async () => {
      await this.#reconcile(false);
      this.#backend.validateWrite?.(value);
      const previous = this.#pending.get(id);
      this.#pending.set(id, value);
      try {
        await this.#reconcile(false);
        this.#backend.acceptWrite?.(value);
      } catch (error) {
        if (previous === undefined) this.#pending.delete(id);
        else this.#pending.set(id, previous);
        throw error;
      }
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.#serialize(async () => {
      await this.#reconcile(true);
      const existed = this.#view().has(id);
      this.#pending.set(id, null);
      await this.#reconcile(false);
      return existed;
    });
  }

  async clear(): Promise<void> {
    return this.#serialize(async () => {
      const previous = new Map(this.#pending);
      const wasPending = this.#clearPending;
      this.#pending.clear();
      this.#clearPending = true;
      try {
        await this.#reconcile(false);
        this.#backend.acceptClear?.();
      } catch (error) {
        this.#clearPending = wasPending;
        for (const [id, value] of previous) this.#pending.set(id, value);
        throw error;
      }
    });
  }

  async sync(): Promise<RedisPersistenceState> {
    await this.values();
    return this.persistenceState;
  }
}

// Redis scripts are atomic, but do not roll back a runtime error. Validate types first.
export const CHECK_INDEX = `
local kind = redis.call('TYPE', KEYS[1]).ok
if kind ~= 'none' and kind ~= 'set' then return redis.error_reply('YOLO index must be a set') end
`;
export const REMOVE_RECORD = `${CHECK_INDEX}
redis.call('DEL', KEYS[2])
redis.call('SREM', KEYS[1], ARGV[1])
return 1
`;
export const CLEAR_RECORDS = `${CHECK_INDEX}
for _, id in ipairs(redis.call('SMEMBERS', KEYS[1])) do redis.call('DEL', ARGV[1] .. id) end
redis.call('DEL', unpack(KEYS))
return 1
`;
