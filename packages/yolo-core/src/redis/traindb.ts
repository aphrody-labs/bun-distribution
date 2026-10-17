// SPDX-License-Identifier: Apache-2.0
import { NativeRedisClient } from "./client";
import {
  CHECK_INDEX,
  CLEAR_RECORDS,
  REMOVE_RECORD,
  IndexedRecords,
  compareIds,
  validateNamespace,
  validatePageSize,
  validateRecordId,
} from "./records";
import type { RedisPersistenceState } from "./records";

export interface TrainInstruction {
  id: string;
  instruction: string;
  input?: string | undefined;
  output: string;
  system?: string | undefined;
  thought?: string | undefined;
  split?: "train" | "val" | "test" | undefined;
  metadata?: Record<string, unknown> | undefined;
}
export interface TrainTriple {
  id: string;
  query: string;
  positive: string;
  negative: string;
  split?: "train" | "val" | "test" | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface TrainDatasetStats {
  totalCount: number;
  dataset: string;
  instructionCount: number;
  tripleCount: number;
  splitCounts: {
    train: number;
    val: number;
    test: number;
    unspecified: number;
  };
}

function validateJson(value: unknown, parents = new Set<object>(), depth = 0): void {
  if (depth > 64) throw new TypeError("Training metadata exceeds maximum depth");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") throw new TypeError("Training metadata must contain finite JSON values");
  if (parents.has(value)) throw new TypeError("Training metadata must not contain cycles");
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== null && prototype !== Object.prototype)
    throw new TypeError("Training metadata must contain plain JSON objects");
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new TypeError("Training metadata cannot contain symbol keys");
  parents.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) validateJson(item, parents, depth + 1);
  parents.delete(value);
}

function validateTrainingRecord(value: unknown, expectedId?: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Training record must be an object");
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") throw new TypeError("Training record ID must be a string");
  validateRecordId(record.id);
  if (expectedId !== undefined && expectedId !== record.id)
    throw new TypeError("Training record ID differs from its index");
  const required =
    record.type === "instruction"
      ? ["instruction", "output"]
      : record.type === "triple"
        ? ["query", "positive", "negative"]
        : null;
  if (required === null || required.some(field => typeof record[field] !== "string"))
    throw new TypeError("Invalid training record type or fields");
  for (const field of ["input", "system", "thought"]) {
    if (record[field] !== undefined && typeof record[field] !== "string")
      throw new TypeError(`Training ${field} must be a string`);
  }
  if (
    record.split !== undefined &&
    (typeof record.split !== "string" || !["train", "val", "test"].includes(record.split))
  )
    throw new TypeError("Invalid training split");
  if (
    record.metadata !== undefined &&
    (record.metadata === null || typeof record.metadata !== "object" || Array.isArray(record.metadata))
  )
    throw new TypeError("Training metadata must be an object");
  if (record.metadata !== undefined) validateJson(record.metadata);
  return record;
}

const WRITE_TRAINING = `${CHECK_INDEX}
local kind = redis.call('TYPE', KEYS[2]).ok
if kind ~= 'none' and kind ~= 'string' then return redis.error_reply('YOLO training record must be a string') end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SADD', KEYS[1], ARGV[1])
return 1
`;
const READ_TRAINING = `${CHECK_INDEX}
local rows = {}
for _, id in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  local value = redis.call('GET', ARGV[1] .. id)
  if value then table.insert(rows, {id, value}) end
end
return rows
`;

/** Training records use the same pending mutation owner as the vector store. */
export class RedisTrainDb {
  readonly client: NativeRedisClient;
  readonly datasetName: string;
  readonly #records: IndexedRecords;

  constructor(client: NativeRedisClient, datasetName = "default") {
    validateNamespace(datasetName);
    this.client = client;
    this.datasetName = datasetName;
    this.#records = new IndexedRecords(client, {
      read: async () => {
        const rows = await client.sendCommand<Array<[string, string]>>(
          "EVAL",
          READ_TRAINING,
          1,
          this.indexKey,
          this.keyPrefix,
        );
        const records = new Map<string, string>();
        for (const [id, value] of rows) {
          validateTrainingRecord(JSON.parse(value), id);
          records.set(id, value);
        }
        return records;
      },
      write: async (id, value) => {
        await client.sendCommand("EVAL", WRITE_TRAINING, 2, this.indexKey, this.keyPrefix + id, id, value);
      },
      remove: async id => {
        await client.sendCommand("EVAL", REMOVE_RECORD, 2, this.indexKey, this.keyPrefix + id, id);
      },
      clear: async () => {
        await client.sendCommand("EVAL", CLEAR_RECORDS, 1, this.indexKey, this.keyPrefix);
      },
    });
  }

  get keyPrefix(): string {
    return `yolo:train:${this.datasetName}:`;
  }
  get indexKey(): string {
    return `yolo:train_idx:${this.datasetName}`;
  }
  get persistenceState(): RedisPersistenceState {
    return this.#records.persistenceState;
  }

  async #put(item: TrainInstruction | TrainTriple, type: "instruction" | "triple"): Promise<void> {
    const value = { ...item, type };
    validateTrainingRecord(value);
    const serialized = JSON.stringify(value);
    validateTrainingRecord(JSON.parse(serialized), item.id);
    await this.#records.put(item.id, serialized);
  }
  async addInstruction(item: TrainInstruction): Promise<void> {
    return this.#put(item, "instruction");
  }
  async addTriple(item: TrainTriple): Promise<void> {
    return this.#put(item, "triple");
  }
  async getRecord(id: string): Promise<Record<string, unknown> | null> {
    validateRecordId(id);
    const value = (await this.#records.values()).get(id);
    return value === undefined ? null : validateTrainingRecord(JSON.parse(value), id);
  }
  async listRecords(limit = 50, offset = 0): Promise<Array<Record<string, unknown>>> {
    validatePageSize(limit, "limit");
    validatePageSize(offset, "offset");
    const values = await this.#records.values();
    return [...values.keys()]
      .toSorted(compareIds)
      .slice(offset, offset + limit)
      .map(id => validateTrainingRecord(JSON.parse(values.get(id)!), id));
  }
  async getStats(): Promise<TrainDatasetStats> {
    const values = await this.#records.values();
    const stats: TrainDatasetStats = {
      dataset: this.datasetName,
      totalCount: values.size,
      instructionCount: 0,
      tripleCount: 0,
      splitCounts: { train: 0, val: 0, test: 0, unspecified: 0 },
    };
    for (const [id, value] of values) {
      const record = validateTrainingRecord(JSON.parse(value), id);
      if (record.type === "instruction") stats.instructionCount++;
      else stats.tripleCount++;
      const split = record.split as "train" | "val" | "test" | undefined;
      stats.splitCounts[split ?? "unspecified"]++;
    }
    return stats;
  }
  async delete(id: string): Promise<boolean> {
    validateRecordId(id);
    return this.#records.remove(id);
  }
  async clear(): Promise<void> {
    return this.#records.clear();
  }
  async sync(): Promise<RedisPersistenceState> {
    return this.#records.sync();
  }
}
