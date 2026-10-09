// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
/**
 * Float32 vector utilities and arithmetic memory estimates.
 * This module neither executes a model nor allocates a KV cache or attention masks.
 */
import { GEMMA4_E2B_CONFIG, validateGemma4Config, type Gemma4Config } from "./models";

import { normalizeL2 } from "../math/vectors";
export { normalizeL2, cosineSimilarity, euclideanDistance } from "../math/vectors";

/** Synthetic deterministic hash projection, without model weights or semantic embedding guarantees. */
export function generateDeterministicEmbedding(
  text: string,
  dim: number = GEMMA4_E2B_CONFIG.embedDim,
): Float32Array {
  if (typeof text !== "string" || text.length > 1_048_576)
    throw new Error("Synthetic projection text exceeds the budget or is not text");
  if (!Number.isSafeInteger(dim) || dim < 1 || dim > 1_048_576)
    throw new Error("Synthetic projection dimension must be between 1 and 1048576");
  const vec = new Float32Array(dim);
  const utf8 = new TextEncoder().encode(text);

  // High-entropy deterministic projection using 64-bit FNV/Murmur-style mix
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < utf8.length; i++) {
    const byte = utf8[i]!;
    h1 = (Math.imul(h1 ^ byte, 0x01000193) ^ (byte << 3)) >>> 0;
    h2 = (Math.imul(h2 ^ byte, 0x27d4eb2d) ^ (byte >>> 2)) >>> 0;
  }

  // Generate float32 components
  for (let i = 0; i < dim; i++) {
    h1 = (Math.imul(h1 ^ i, 0x5bd1e995) + h2) >>> 0;
    h2 = (Math.imul(h2, 0x1b873593) ^ (h1 >>> 13)) >>> 0;
    // Normalized to [-1.0, 1.0]
    vec[i] = (h1 / 4294967296.0) * 2.0 - 1.0;
  }

  return normalizeL2(vec);
}

/** Arithmetic KV estimate from an unverified profile; no cache is allocated. */
export function computeKVCacheFootprintBytes(
  config: Gemma4Config,
  batchSize: number = 1,
  seqLen: number = 512,
  bytesPerElem: number = 2, // 16-bit
): { localBytes: number; globalBytes: number; totalBytes: number; totalMb: number } {
  validateGemma4Config(config);
  for (const value of [batchSize, seqLen]) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("Batch size and sequence length must be positive safe integers");
  }
  if (![1, 2, 4].includes(bytesPerElem)) throw new Error("bytesPerElem must be 1, 2 or 4");
  const headDim = config.headDim;
  const numKvHeads = config.numKvHeads;
  const windowSize = Math.min(seqLen, config.slidingWindowSize);

  // Key + Value = 2 tensors
  let localBytes = 0;
  let globalBytes = 0;

  for (let layer = 0; layer < Math.min(config.numLayers, config.attentionPattern.length); layer++) {
    const pattern = config.attentionPattern[layer];
    const repeats =
      Math.floor(config.numLayers / config.attentionPattern.length) +
      (layer < config.numLayers % config.attentionPattern.length ? 1 : 0);
    if (pattern === "local_sliding") {
      // B * numKvHeads * windowSize * headDim * 2 * bytesPerElem
      localBytes += repeats * batchSize * numKvHeads * windowSize * headDim * 2 * bytesPerElem;
    } else {
      // Full sequence length for global attention layers
      globalBytes += repeats * batchSize * numKvHeads * seqLen * headDim * 2 * bytesPerElem;
    }
  }

  const totalBytes = localBytes + globalBytes;
  if (!Number.isSafeInteger(totalBytes)) throw new Error("KV estimate exceeds safe integer range");
  return {
    localBytes,
    globalBytes,
    totalBytes,
    totalMb: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
  };
}
