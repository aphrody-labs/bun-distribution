// SPDX-License-Identifier: Apache-2.0
// Typed facade over the three-function call surface shared by WebAssembly and bun:ffi.
import type {
  Aggregate,
  CaseResult,
  Chunk,
  ChunkOptions,
  Comparison,
  GateResult,
  GoldCase,
  Hit,
  Id,
  Language,
  LengthUnit,
  Manifest,
  MmrCandidate,
  QuotaRule,
  Report,
  RetrievedHit,
  Scored,
  Sentence,
  SourceWeight,
  WeightedCandidate,
} from "./types";

/** What a backend (wasm or ffi) implements; both throw `Error` with the operation message. */
export interface RagTransport {
  manifest(): string;
  callJson(op: string, input: string): string;
  callVec(op: string, params: string, a: Uint8Array, b: Uint8Array): Uint8Array;
}

/** Version of the call surface this facade types; checked against the backend manifest. */
export const EXPECTED_ABI = 1;

const NONE = new Uint8Array(0);
const bytes = (f: Float32Array | Float64Array): Uint8Array => new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
// Copy so the view is aligned whatever the backend's buffer offset.
const f32 = (b: Uint8Array): Float32Array => new Float32Array(b.slice().buffer);
const f64 = (b: Uint8Array): Float64Array => new Float64Array(b.slice().buffer);
const hits = (b: Uint8Array): Hit[] => {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Hit[] = [];
  for (let at = 0; at + 8 <= b.byteLength; at += 8) {
    out.push({
      index: view.getUint32(at, true),
      score: view.getFloat32(at + 4, true),
    });
  }
  return out;
};
const rowsOf = (data: { length: number }, width: number): number => {
  if (!Number.isInteger(width) || width <= 0 || data.length % width !== 0) {
    throw new RangeError(`data length ${data.length} is not a multiple of width ${width}`);
  }
  return data.length / width;
};

export function createRagCore(transport: RagTransport) {
  const manifest = JSON.parse(transport.manifest()) as Manifest;
  if (manifest.abi !== EXPECTED_ABI) {
    throw new Error(`aphrody-rag-core ABI ${manifest.abi} does not match the facade (${EXPECTED_ABI})`);
  }
  const json = <T>(op: string, input: unknown): T => JSON.parse(transport.callJson(op, JSON.stringify(input))) as T;
  const vec = (op: string, params: object, a: Uint8Array = NONE, b: Uint8Array = NONE) =>
    transport.callVec(op, JSON.stringify(params), a, b);

  return {
    manifest,

    // chunking and text
    chunk: (path: string, text: string, options?: ChunkOptions) => json<Chunk[]>("chunk", { path, text, options }),
    detectLanguage: (path: string) => json<Language>("detect_language", { path }),
    normalizeNewlines: (text: string) => json<string>("normalize_newlines", { text }),
    measure: (text: string, unit: LengthUnit = "utf16") => json<number>("measure", { text, unit }),
    splitSentences: (text: string, o: { baseLine?: number; cjkSentenceBreaks?: boolean } = {}) =>
      json<Sentence[]>("split_sentences", {
        text,
        base_line: o.baseLine,
        cjk_sentence_breaks: o.cjkSentenceBreaks,
      }),

    // fusion
    rrf: (lists: readonly (readonly Id[])[], k = 60) => json<Scored[]>("rrf", { lists, k }),
    rrfWeighted: (lists: readonly { ids: readonly Id[]; weight: number }[], k = 60) =>
      json<Scored[]>("rrf_weighted", { lists, k }),
    fuseScores: (lists: readonly { items: readonly Scored[]; weight: number }[], scaling: "min_max" | "dist_based") =>
      json<Scored[]>("fuse_scores", { lists, scaling }),
    applySourceWeights: (input: {
      candidates: readonly WeightedCandidate[];
      weights?: readonly SourceWeight[];
      quota?: QuotaRule;
      protectedKinds?: readonly string[];
      topN: number;
    }) =>
      json<WeightedCandidate[]>("apply_source_weights", {
        candidates: input.candidates,
        weights: input.weights,
        quota: input.quota,
        protected_kinds: input.protectedKinds,
        top_n: input.topN,
      }),
    mmr: (candidates: readonly MmrCandidate[], lambda: number, topN: number) =>
      json<Id[]>("mmr", { candidates, lambda, top_n: topN }),
    minmaxNormalize: (values: readonly number[]) => json<number[]>("minmax_normalize", { values }),
    mergeTopK: (parts: readonly (readonly Hit[])[], k: number) => json<Hit[]>("merge_top_k", { parts, k }),

    // retrieval eval harness
    evalParseGold: (text: string) => json<GoldCase[]>("eval_parse_gold", { text }),
    evalNormalizeUrl: (url: string, stripOrigin?: string) =>
      json<string>("eval_normalize_url", { url, strip_origin: stripOrigin }),
    evalMatchesUrl: (actual: string, expected: string, stripOrigin?: string) =>
      json<boolean>("eval_matches_url", {
        actual,
        expected,
        strip_origin: stripOrigin,
      }),
    evalIsHit: (hit: RetrievedHit, c: GoldCase) => json<boolean>("eval_is_hit", { hit, case: c }),
    evalFirstHitRank: (results: readonly RetrievedHit[], c: GoldCase) =>
      json<number>("eval_first_hit_rank", { results, case: c }),
    evalNdcgAtK: (results: readonly RetrievedHit[], c: GoldCase, k = 10) =>
      json<number>("eval_ndcg_at_k", { results, case: c, k }),
    evalRunCase: (c: GoldCase, results: readonly RetrievedHit[], mode: string, latencyMs = 0) =>
      json<CaseResult>("eval_run_case", {
        case: c,
        results,
        mode,
        latency_ms: latencyMs,
      }),
    evalAggregate: (cases: readonly CaseResult[]) => json<Aggregate>("eval_aggregate", { cases }),
    evalAggregateByTag: (cases: readonly CaseResult[]) =>
      json<Record<string, Aggregate>>("eval_aggregate_by_tag", { cases }),
    evalQuantile: (values: readonly number[], q: number) => json<number>("eval_quantile", { values, q }),
    evalLatencyStats: (latenciesMs: readonly number[]) =>
      json<{ p50_ms: number; p95_ms: number }>("eval_latency_stats", {
        latencies_ms: latenciesMs,
      }),
    evalReport: (condition: string, cases: readonly CaseResult[]) => json<Report>("eval_report", { condition, cases }),
    evalGateCheck: (expr: string, aggregate: Aggregate) => json<GateResult>("eval_gate_check", { expr, aggregate }),
    evalCompare: (baseline: Report, candidate: Report, allowMixed = false) =>
      json<Comparison>("eval_compare", {
        baseline,
        candidate,
        allow_mixed: allowMixed,
      }),

    // dense vectors: row-major little-endian typed arrays, no JSON on the hot path
    normalizeF32: (data: Float32Array, width: number) =>
      f32(vec("normalize_f32", { rows: rowsOf(data, width), width }, bytes(data))),
    normalizeF64: (data: Float64Array, width: number) =>
      f64(vec("normalize_f64", { rows: rowsOf(data, width), width }, bytes(data))),
    l2NormalizeF32: (data: Float32Array, width: number) =>
      f32(vec("l2_normalize_f32", { rows: rowsOf(data, width), width }, bytes(data))),
    similaritiesF32: (left: Float32Array, right: Float32Array, width: number) =>
      f32(
        vec(
          "similarities_f32",
          {
            rows: rowsOf(left, width),
            right_rows: rowsOf(right, width),
            width,
          },
          bytes(left),
          bytes(right),
        ),
      ),
    similaritiesF64: (left: Float64Array, right: Float64Array, width: number) =>
      f64(
        vec(
          "similarities_f64",
          {
            rows: rowsOf(left, width),
            right_rows: rowsOf(right, width),
            width,
          },
          bytes(left),
          bytes(right),
        ),
      ),
    meanF32: (data: Float32Array, width: number) =>
      f32(vec("mean_f32", { rows: rowsOf(data, width), width }, bytes(data))),
    meanF64: (data: Float64Array, width: number) =>
      f64(vec("mean_f64", { rows: rowsOf(data, width), width }, bytes(data))),
    squaredDistancesF32: (rows: Float32Array, centroids: Float32Array, width: number) =>
      f32(
        vec(
          "squared_distances_f32",
          {
            rows: rowsOf(rows, width),
            right_rows: rowsOf(centroids, width),
            width,
          },
          bytes(rows),
          bytes(centroids),
        ),
      ),
    squaredDistancesF64: (rows: Float64Array, centroids: Float64Array, width: number) =>
      f64(
        vec(
          "squared_distances_f64",
          {
            rows: rowsOf(rows, width),
            right_rows: rowsOf(centroids, width),
            width,
          },
          bytes(rows),
          bytes(centroids),
        ),
      ),
    updateCentersF64: (rows: Float64Array, labels: readonly number[], centers: Float64Array, width: number) =>
      f64(
        vec(
          "update_centers_f64",
          {
            rows: rowsOf(rows, width),
            right_rows: rowsOf(centers, width),
            width,
            labels,
          },
          bytes(rows),
          bytes(centers),
        ),
      ),
    dotF32: (a: Float32Array, b: Float32Array) => f32(vec("dot_f32", {}, bytes(a), bytes(b)))[0] ?? 0,
    cosineF32: (a: Float32Array, b: Float32Array) => f32(vec("cosine_f32", {}, bytes(a), bytes(b)))[0] ?? 0,
    topKCosineF32: (query: Float32Array, matrix: Float32Array, dim: number, k: number) => {
      rowsOf(matrix, dim);
      return hits(vec("top_k_cosine_f32", { dim, k }, bytes(query), bytes(matrix)));
    },
    topKDotF32: (query: Float32Array, matrix: Float32Array, dim: number, k: number) => {
      rowsOf(matrix, dim);
      return hits(vec("top_k_dot_f32", { dim, k }, bytes(query), bytes(matrix)));
    },
    /** Symmetric int8 quantisation of one vector. */
    quantizeI8: (v: Float32Array) => {
      const out = vec("quantize_i8", {}, bytes(v));
      return {
        scale: new DataView(out.buffer, out.byteOffset, 4).getFloat32(0, true),
        codes: new Int8Array(out.slice(4).buffer),
      };
    },
    /** Approximate top-k over int8 rows (`codes` row-major) and their per-row scales. */
    topKI8: (query: Float32Array, codes: Int8Array, scales: Float32Array, dim: number, k: number) => {
      const rows = rowsOf(codes, dim);
      const packed = new Uint8Array(codes.byteLength + scales.byteLength);
      packed.set(new Uint8Array(codes.buffer, codes.byteOffset, codes.byteLength), 0);
      packed.set(bytes(scales), codes.byteLength);
      return hits(vec("top_k_i8", { dim, k, rows }, bytes(query), packed));
    },
  };
}

export type RagCore = ReturnType<typeof createRagCore>;
