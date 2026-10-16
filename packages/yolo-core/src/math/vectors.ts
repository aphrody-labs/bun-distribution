// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
/** Pure vector operations shared by retrieval and model adapters. */
function validateVector(vec: Float32Array): void {
  if (
    !(vec instanceof Float32Array) ||
    !vec.length ||
    !vec.every(Number.isFinite)
  )
    throw new Error(
      "Vector must contain finite Float32 values and be non-empty",
    );
}

/** Normalizes a vector in-place to unit L2 norm. */
export function normalizeL2(vec: Float32Array): Float32Array {
  validateVector(vec);
  let sum = 0.0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i]! * vec[i]!;
  }
  const norm = Math.sqrt(sum);
  if (norm > 0) {
    const inv = 1.0 / norm;
    for (let i = 0; i < vec.length; i++) {
      vec[i] = vec[i]! * inv;
    }
  }
  return vec;
}

/** Computes the cosine similarity between two normalized or unnormalized float32 vectors. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  validateVector(a);
  validateVector(b);
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? Math.max(-1, Math.min(1, dot / denom)) : 0.0;
}

/** Computes Euclidean distance between two float32 vectors. */
export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  validateVector(a);
  validateVector(b);
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0.0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}
