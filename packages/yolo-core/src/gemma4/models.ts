// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
/**
 * Repository architecture profiles for estimates, not qualified model specifications.
 * No pinned upstream model/configuration or loaded weights establish these values.
 */

export type AttentionType = "global" | "local_sliding";

export const GEMMA4_CONFIG_PROVENANCE = {
  status: "unverified" as const,
  source: "repository-profile" as const,
  description:
    "Estimated profiles without a pinned upstream model configuration; weights and tokenizer are not loaded here.",
};

export interface VisionEncoderConfig {
  readonly dModel: number;
  readonly numLayers: number;
  readonly numHeads: number;
  readonly ffwHidden: number;
  readonly outputLength: number;
  readonly patchSize: number;
  readonly imageSize: number;
}

export interface ConformerAudioConfig {
  readonly subsamplingFactor: number;
  readonly dModel: number;
  readonly numHeads: number;
  readonly numLayers: number;
  readonly kernelSize: number;
  readonly sampleRate: number;
  readonly melChannels: number;
}

export interface Gemma4Config {
  readonly name: string;
  readonly vocabSize: number;
  readonly embedDim: number;
  readonly hiddenDim: number;
  readonly numLayers: number;
  readonly numHeads: number;
  readonly headDim: number;
  readonly numKvHeads: number;
  readonly slidingWindowSize: number;
  readonly finalLogitSoftcap: number;
  readonly qkNormWithScale: boolean;
  readonly rmsNormEps: number;
  readonly localRopeFrequency: number;
  readonly globalRopeFrequency: number;
  readonly localRopeProportion: number;
  readonly globalRopeProportion: number;
  readonly attentionPattern: readonly AttentionType[];
  readonly enableMoe: boolean;
  readonly numExperts: number;
  readonly topKExperts: number;
  readonly visionEncoder?: VisionEncoderConfig | undefined;
  readonly audioEncoder?: ConformerAudioConfig | undefined;
}

// ---------------------------------------------------------------------------
// Historical repository profile, retained for compatibility and estimates only.
// ---------------------------------------------------------------------------
export const GEMMA4_E2B_CONFIG: Gemma4Config = {
  name: "gemma4-e2b",
  vocabSize: 262144,
  embedDim: 1536,
  hiddenDim: 6144,
  numLayers: 35,
  numHeads: 8,
  headDim: 256,
  numKvHeads: 1,
  slidingWindowSize: 512,
  finalLogitSoftcap: 30.0,
  qkNormWithScale: true,
  rmsNormEps: 1e-6,
  localRopeFrequency: 10000,
  globalRopeFrequency: 1000000,
  localRopeProportion: 1.0,
  globalRopeProportion: 0.25,
  attentionPattern: [
    "local_sliding",
    "local_sliding",
    "local_sliding",
    "local_sliding",
    "global",
  ],
  enableMoe: false,
  numExperts: 0,
  topKExperts: 0,
  visionEncoder: {
    dModel: 1152,
    numLayers: 27,
    numHeads: 16,
    ffwHidden: 4304,
    outputLength: 280,
    patchSize: 16,
    imageSize: 448,
  },
  audioEncoder: {
    subsamplingFactor: 4,
    dModel: 512,
    numHeads: 8,
    numLayers: 12,
    kernelSize: 31,
    sampleRate: 16000,
    melChannels: 128,
  },
};

export const GEMMA4_E4B_CONFIG: Gemma4Config = {
  name: "gemma4-e4b",
  vocabSize: 262144,
  embedDim: 2560,
  hiddenDim: 10240,
  numLayers: 38,
  numHeads: 10,
  headDim: 256,
  numKvHeads: 2,
  slidingWindowSize: 512,
  finalLogitSoftcap: 30.0,
  qkNormWithScale: true,
  rmsNormEps: 1e-6,
  localRopeFrequency: 10000,
  globalRopeFrequency: 1000000,
  localRopeProportion: 1.0,
  globalRopeProportion: 0.25,
  attentionPattern: [
    "local_sliding",
    "local_sliding",
    "local_sliding",
    "local_sliding",
    "global",
  ],
  enableMoe: false,
  numExperts: 0,
  topKExperts: 0,
  visionEncoder: GEMMA4_E2B_CONFIG.visionEncoder,
  audioEncoder: GEMMA4_E2B_CONFIG.audioEncoder,
};

export const GEMMA4_26B_A4B_MOE_CONFIG: Gemma4Config = {
  name: "gemma4-26b-a4b-moe",
  vocabSize: 262144,
  embedDim: 2560,
  hiddenDim: 10240,
  numLayers: 38,
  numHeads: 10,
  headDim: 256,
  numKvHeads: 2,
  slidingWindowSize: 1024,
  finalLogitSoftcap: 30.0,
  qkNormWithScale: true,
  rmsNormEps: 1e-6,
  localRopeFrequency: 10000,
  globalRopeFrequency: 1000000,
  localRopeProportion: 1.0,
  globalRopeProportion: 0.25,
  attentionPattern: [
    "local_sliding",
    "local_sliding",
    "local_sliding",
    "local_sliding",
    "global",
  ],
  enableMoe: true,
  numExperts: 128,
  topKExperts: 8,
  visionEncoder: GEMMA4_E2B_CONFIG.visionEncoder,
  audioEncoder: GEMMA4_E2B_CONFIG.audioEncoder,
};

export const GEMMA4_31B_CONFIG: Gemma4Config = {
  name: "gemma4-31b",
  vocabSize: 262144,
  embedDim: 4096,
  hiddenDim: 16384,
  numLayers: 48,
  numHeads: 16,
  headDim: 256,
  numKvHeads: 4,
  slidingWindowSize: 1024,
  finalLogitSoftcap: 30.0,
  qkNormWithScale: true,
  rmsNormEps: 1e-6,
  localRopeFrequency: 10000,
  globalRopeFrequency: 1000000,
  localRopeProportion: 1.0,
  globalRopeProportion: 0.25,
  attentionPattern: [
    "local_sliding",
    "local_sliding",
    "local_sliding",
    "local_sliding",
    "global",
  ],
  enableMoe: false,
  numExperts: 0,
  topKExperts: 0,
  visionEncoder: GEMMA4_E2B_CONFIG.visionEncoder,
  audioEncoder: GEMMA4_E2B_CONFIG.audioEncoder,
};

export const GEMMA4_MODELS: Readonly<Record<string, Gemma4Config>> = {
  "gemma4-e2b": GEMMA4_E2B_CONFIG,
  "gemma4-e4b": GEMMA4_E4B_CONFIG,
  "gemma4-26b-a4b-moe": GEMMA4_26B_A4B_MOE_CONFIG,
  "gemma4-31b": GEMMA4_31B_CONFIG,
};

/** Retrieve a known estimate profile; unknown names must not silently alias another model. */
export function getGemma4Config(
  modelName: string = "gemma4-e2b",
): Gemma4Config {
  if (typeof modelName !== "string") throw new Error("Model name must be text");
  const norm = modelName.toLowerCase().replace(/_/g, "-");
  if (!Object.hasOwn(GEMMA4_MODELS, norm))
    throw new Error(`Unknown model profile: ${modelName}`);
  return GEMMA4_MODELS[norm]!;
}

/** Validate arithmetic inputs, without asserting upstream provenance or model compatibility. */
export function validateGemma4Config(config: Gemma4Config): void {
  if (!config || typeof config.name !== "string" || !config.name.trim())
    throw new Error("Invalid model profile name");
  for (const key of [
    "vocabSize",
    "embedDim",
    "hiddenDim",
    "numLayers",
    "numHeads",
    "headDim",
    "numKvHeads",
    "slidingWindowSize",
    "localRopeFrequency",
    "globalRopeFrequency",
  ] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1)
      throw new Error(`${key} must be a positive safe integer`);
  }
  if (
    config.numKvHeads > config.numHeads ||
    config.numHeads % config.numKvHeads !== 0
  )
    throw new Error("Invalid KV head grouping");
  if (
    !Array.isArray(config.attentionPattern) ||
    !config.attentionPattern.length ||
    config.attentionPattern.length > 10_000 ||
    config.attentionPattern.some(
      (entry) => entry !== "global" && entry !== "local_sliding",
    )
  )
    throw new Error("Invalid attention pattern");
  if (!Number.isFinite(config.rmsNormEps) || config.rmsNormEps <= 0)
    throw new Error("Invalid normalization epsilon");
  if (
    !Number.isFinite(config.finalLogitSoftcap) ||
    config.finalLogitSoftcap < 0
  )
    throw new Error("Invalid logit softcap");
  for (const proportion of [
    config.localRopeProportion,
    config.globalRopeProportion,
  ]) {
    if (!Number.isFinite(proportion) || proportion < 0 || proportion > 1)
      throw new Error("Invalid RoPE proportion");
  }
  if (
    typeof config.qkNormWithScale !== "boolean" ||
    typeof config.enableMoe !== "boolean"
  )
    throw new Error("Invalid model profile flags");
  if (
    !Number.isSafeInteger(config.numExperts) ||
    !Number.isSafeInteger(config.topKExperts) ||
    (config.enableMoe
      ? config.numExperts < 1 ||
        config.topKExperts < 1 ||
        config.topKExperts > config.numExperts
      : config.numExperts !== 0 || config.topKExperts !== 0)
  )
    throw new Error("Invalid expert routing counts");
  for (const encoder of [config.visionEncoder, config.audioEncoder]) {
    if (encoder !== undefined) {
      if (
        !encoder ||
        typeof encoder !== "object" ||
        !Object.values(encoder).every(
          (value) =>
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value > 0,
        )
      )
        throw new Error("Invalid encoder profile");
    }
  }
}

/** Nominal parameter-storage estimate; excludes KV cache, activations and runtime overhead. */
export function estimateGemma4Memory(
  config: Gemma4Config,
  bytesPerParam: 1 | 2 | 4 = 2, // 1 = 8-bit, 2 = 16-bit (bf16/fp16), 4 = fp32
): { paramCount: number; memoryBytes: number; memoryMb: number } {
  validateGemma4Config(config);
  if (![1, 2, 4].includes(bytesPerParam))
    throw new Error("bytesPerParam must be 1, 2 or 4");
  let paramCount = 0;
  if (config.name === "gemma4-e2b") {
    paramCount = 2_000_000_000;
  } else if (config.name === "gemma4-e4b") {
    paramCount = 4_000_000_000;
  } else if (config.name === "gemma4-26b-a4b-moe") {
    paramCount = 26_000_000_000;
  } else if (config.name === "gemma4-31b") {
    paramCount = 31_000_000_000;
  } else {
    paramCount = config.embedDim * config.hiddenDim * config.numLayers;
  }
  const memoryBytes = paramCount * bytesPerParam;
  if (!Number.isSafeInteger(memoryBytes))
    throw new Error("Model memory estimate exceeds safe integer range");
  return {
    paramCount,
    memoryBytes,
    memoryMb: Math.round(memoryBytes / (1024 * 1024)),
  };
}
