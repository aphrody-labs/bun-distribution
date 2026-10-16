// SPDX-License-Identifier: Apache-2.0
import { cosineSimilarity } from "../math/vectors";
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

export interface VectorDocument {
  id: string;
  vector: Float32Array;
  metadata: Record<string, string>;
}
export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: Record<string, string>;
}
export interface VectorStoreOptions {
  dimensions?: number | undefined;
}

function validateVector(vector: Float32Array, requireNorm = true): void {
  if (!(vector instanceof Float32Array) || vector.length === 0)
    throw new TypeError("Vector must be a nonempty Float32Array");
  let norm = 0;
  for (const component of vector) {
    if (!Number.isFinite(component)) throw new TypeError("Vector components must be finite");
    norm += component * component;
  }
  if (requireNorm && norm === 0)
    throw new RangeError("Cosine search requires a nonzero vector norm");
}

function copyMetadata(metadata: Record<string, string>): Record<string, string> {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata))
    throw new TypeError("Vector metadata must be an object of strings");
  const entries = Object.entries(metadata);
  if (entries.some(([, value]) => typeof value !== "string"))
    throw new TypeError("Vector metadata values must be strings");
  return Object.fromEntries(entries);
}

const WRITE_VECTOR = `${CHECK_INDEX}
local keyKind = redis.call('TYPE', KEYS[2]).ok
if keyKind ~= 'none' and keyKind ~= 'hash' then return redis.error_reply('YOLO vector must be a hash') end
local dimensionKind = redis.call('TYPE', KEYS[3]).ok
if dimensionKind ~= 'none' and dimensionKind ~= 'string' then return redis.error_reply('YOLO dimension must be a string') end
local value = cjson.decode(ARGV[2])
local dimension = tostring(value.dim)
local existing = redis.call('GET', KEYS[3])
if existing and existing ~= dimension then return redis.error_reply('YOLO vector dimensions differ') end
if not existing then
  for _, id in ipairs(redis.call('SMEMBERS', KEYS[1])) do
    local vec = redis.call('HGET', ARGV[3] .. id, 'vec')
    if vec then
      local padding = string.sub(vec, -2) == '==' and 2 or (string.sub(vec, -1) == '=' and 1 or 0)
      local oldDimension = (#vec / 4 * 3 - padding) / 4
      if oldDimension ~= value.dim then return redis.error_reply('YOLO vector dimensions differ') end
    end
  end
end
redis.call('HSET', KEYS[2], 'id', ARGV[1], 'vec', value.vec, 'meta', value.meta, 'dim', dimension)
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('SET', KEYS[3], dimension)
return 1
`;
const READ_VECTORS = `${CHECK_INDEX}
local rows = {}
for _, id in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  local data = redis.call('HGETALL', ARGV[1] .. id)
  if #data > 0 then table.insert(rows, {id, data}) end
end
return {redis.call('GET', KEYS[2]) or false, rows}
`;

/** Redis-backed exact cosine KNN with an explicit pending offline overlay. */
export class RedisVectorStore {
  readonly client: NativeRedisClient;
  readonly namespace: string;
  readonly #records: IndexedRecords;
  readonly #configuredDimensions: number | undefined;
  #dimensions: number | undefined;

  constructor(client: NativeRedisClient, namespace = "default", options: VectorStoreOptions = {}) {
    validateNamespace(namespace);
    if (
      options.dimensions !== undefined &&
      (!Number.isSafeInteger(options.dimensions) || options.dimensions < 1)
    ) {
      throw new RangeError("Vector dimensions must be a positive safe integer");
    }
    this.client = client;
    this.namespace = namespace;
    this.#configuredDimensions = options.dimensions;
    this.#dimensions = options.dimensions;
    this.#records = new IndexedRecords(client, {
      read: async () => {
        const [storedDimension, rows] = await client.sendCommand<
          [string | null, Array<[string, string[]]>]
        >("EVAL", READ_VECTORS, 2, this.indexKey, this.dimensionKey, this.keyPrefix);
        let dimension = storedDimension === null ? undefined : Number(storedDimension);
        if (dimension !== undefined && (!Number.isSafeInteger(dimension) || dimension < 1))
          throw new Error("Corrupt Redis vector dimensions");
        const records = new Map<string, string>();
        for (const [id, fields] of rows) {
          const data: Record<string, string> = Object.create(null);
          for (let index = 0; index < fields.length; index += 2) {
            const key = fields[index];
            const value = fields[index + 1];
            if (key !== undefined && value !== undefined) data[key] = value;
          }
          if (!data.vec || !data.meta || data.id !== id)
            throw new Error("Corrupt Redis vector document");
          const vector = RedisVectorStore.deserializeVector(data.vec);
          validateVector(vector);
          const metadata = copyMetadata(JSON.parse(data.meta));
          dimension ??= vector.length;
          if (
            vector.length !== dimension ||
            (data.dim !== undefined && Number(data.dim) !== dimension)
          )
            throw new Error("Redis vector dimensions differ");
          records.set(
            id,
            JSON.stringify({
              id,
              vec: data.vec,
              meta: JSON.stringify(metadata),
              dim: vector.length,
            }),
          );
        }
        if (
          dimension !== undefined &&
          this.#configuredDimensions !== undefined &&
          dimension !== this.#configuredDimensions
        )
          throw new RangeError("Redis vector dimensions differ from configured dimensions");
        this.#dimensions = dimension ?? this.#configuredDimensions;
        return records;
      },
      write: async (id, value) => {
        await client.sendCommand(
          "EVAL",
          WRITE_VECTOR,
          3,
          this.indexKey,
          this.keyPrefix + id,
          this.dimensionKey,
          id,
          value,
          this.keyPrefix,
        );
      },
      remove: async (id) => {
        await client.sendCommand("EVAL", REMOVE_RECORD, 2, this.indexKey, this.keyPrefix + id, id);
      },
      clear: async () => {
        await client.sendCommand(
          "EVAL",
          CLEAR_RECORDS,
          2,
          this.indexKey,
          this.dimensionKey,
          this.keyPrefix,
        );
      },
      validateWrite: (value) => {
        const dimension = (JSON.parse(value) as { dim: number }).dim;
        if (this.#dimensions !== undefined && dimension !== this.#dimensions)
          throw new RangeError("Vector dimensions differ");
      },
      acceptWrite: (value) => {
        this.#dimensions = (JSON.parse(value) as { dim: number }).dim;
      },
      acceptClear: () => {
        this.#dimensions = this.#configuredDimensions;
      },
    });
  }

  get keyPrefix(): string {
    return `yolo:vec:${this.namespace}:`;
  }
  get indexKey(): string {
    return `yolo:vec_idx:${this.namespace}`;
  }
  get dimensionKey(): string {
    return `${this.indexKey}:dimensions`;
  }
  get dimensions(): number | undefined {
    return this.#dimensions;
  }
  get persistenceState(): RedisPersistenceState {
    return this.#records.persistenceState;
  }

  static serializeVector(vector: Float32Array): string {
    validateVector(vector, false);
    const buffer = new ArrayBuffer(vector.length * 4);
    const view = new DataView(buffer);
    vector.forEach((value, index) => view.setFloat32(index * 4, value, true));
    return Buffer.from(buffer).toString("base64");
  }

  static deserializeVector(base64: string): Float32Array {
    if (
      typeof base64 !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
    )
      throw new TypeError("Invalid vector base64");
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length === 0 || buffer.length % 4 !== 0 || buffer.toString("base64") !== base64)
      throw new TypeError("Invalid vector byte length or encoding");
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const vector = new Float32Array(buffer.length / 4);
    for (let index = 0; index < vector.length; index++)
      vector[index] = view.getFloat32(index * 4, true);
    validateVector(vector, false);
    return vector;
  }

  async upsert(
    id: string,
    vector: Float32Array,
    metadata: Record<string, string> = {},
  ): Promise<void> {
    validateRecordId(id);
    validateVector(vector);
    if (this.#dimensions !== undefined && vector.length !== this.#dimensions)
      throw new RangeError("Vector dimensions differ");
    const value = JSON.stringify({
      id,
      vec: RedisVectorStore.serializeVector(vector),
      meta: JSON.stringify(copyMetadata(metadata)),
      dim: vector.length,
    });
    await this.#records.put(id, value);
  }

  async query(
    queryVector: Float32Array,
    topK = 5,
    filter?: Record<string, string>,
  ): Promise<VectorSearchResult[]> {
    validateVector(queryVector);
    validatePageSize(topK, "topK");
    const predicates = filter === undefined ? [] : Object.entries(copyMetadata(filter));
    const query = new Float32Array(queryVector);
    const records = await this.#records.values();
    if (this.#dimensions !== undefined && query.length !== this.#dimensions)
      throw new RangeError("Query vector dimensions differ");
    const scored: VectorSearchResult[] = [];
    for (const [id, value] of records) {
      const data = JSON.parse(value) as { vec: string; meta: string };
      const metadata = copyMetadata(JSON.parse(data.meta));
      if (
        predicates.some(
          ([key, expected]) => !Object.hasOwn(metadata, key) || metadata[key] !== expected,
        )
      )
        continue;
      const vector = RedisVectorStore.deserializeVector(data.vec);
      if (vector.length !== query.length) throw new RangeError("Query vector dimensions differ");
      scored.push({
        id,
        score: Math.max(-1, Math.min(1, cosineSimilarity(query, vector))),
        metadata,
      });
    }
    scored.sort((left, right) => right.score - left.score || compareIds(left.id, right.id));
    return scored.slice(0, topK);
  }

  async delete(id: string): Promise<boolean> {
    validateRecordId(id);
    return this.#records.remove(id);
  }
  async count(): Promise<number> {
    return (await this.#records.values()).size;
  }
  async clear(): Promise<void> {
    await this.#records.clear();
  }
  async sync(): Promise<RedisPersistenceState> {
    return this.#records.sync();
  }
}
