// SPDX-License-Identifier: Apache-2.0
/** Capability schemas, validation, ownership and execution shared by all transports. */
import { resolve } from "node:path";
import { parseTsSource } from "../vfs/parse";
import { collectStatusReport } from "../vendor/status";
import {
  runGates,
  GATES,
  selectChanged,
  changedFiles,
  summarize,
  type Report,
  NOT_RUN_HEAVY,
  spawnRunner,
} from "../verify/engine";
import { scanDirectory } from "../vfs/scan";
import { scanLinks, estimateReclaim } from "../fleet/space";
import { collectDoctorReport } from "../sys/doctor";
import { yoloHome } from "../vfs/home";
import {
  UnifiedInferenceEngine,
  type UnifiedInferenceRequest,
  GEMMA4_CONFIG_PROVENANCE,
  getGemma4Config,
  estimateGemma4Memory,
  formatGemma4ChatPrompt,
  computeKVCacheFootprintBytes,
  type Gemma4Message,
} from "../gemma4/index";
import { NativeRedisClient } from "../redis/client";
import { RedisVectorStore } from "../redis/vector";
import { RedisTrainDb } from "../redis/traindb";
import { syncPackages, type PackageManager } from "../pm";
import { resolveContainedPath } from "./paths";
import { ToolArgumentError } from "./errors";
export { ToolArgumentError } from "./errors";

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
    readonly anyOf?: readonly { required: readonly string[] }[];
    readonly additionalProperties?: boolean;
  };
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: "yolo_n2b_scan",
    description:
      "Recursively analyze a Node.js codebase with the shared native N2B engine and bounded parallel workers. Read-only; returns the versioned N2B report. Requires the Yolo tooling library.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: workspace root)" },
        jobs: { type: "integer", minimum: 1, maximum: 6 },
        ignore: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  {
    name: "yolo_package_sync",
    description:
      "Plan or apply locked dependency synchronization with global Bun/uv/Cargo binaries. Apply uses the native supervised process owner; Cargo fetch is serialized. No engine builds or publication.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: workspace root)" },
        managers: {
          type: "string",
          description: "Comma-separated bun,uv,cargo; default detects manifests",
        },
        apply: {
          type: "boolean",
          description: "Execute planned dependency synchronization (default: false)",
        },
        offline: { type: "boolean", description: "Disable package network access" },
        production: {
          type: "boolean",
          description: "Omit development dependencies where supported",
        },
        timeoutMs: { type: "integer", minimum: 1, maximum: 1800000 },
      },
    },
  },
  {
    name: "yolo_verify",
    description:
      "Run repository quality gates in parallel (typecheck, lint, fmt, tests, rust-fmt, docs, import-check). Returns structured measured report.",
    inputSchema: {
      type: "object",
      properties: {
        only: {
          type: "string",
          description:
            "Comma-separated gate IDs to run (whitespace, typecheck, lint, fmt-check, test, rust-fmt, docs, import-check)",
        },
        changed: {
          type: "boolean",
          description: "If true, only runs gates whose file surfaces changed relative to HEAD",
        },
        parallel: {
          type: "integer",
          minimum: 1,
          maximum: 256,
          description: "Parallel worker concurrency limit (default: CPU count)",
        },
      },
    },
  },
  {
    name: "yolo_status",
    description:
      "Inspect active package forks, vendored crate sync status, and Cargo workspace configuration.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "yolo_scan",
    description:
      "Fast parallel directory scanner using Bun.Glob + wyhash. Returns file counts, byte sizes, line counts, extension stats, and composite tree fingerprint.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative or absolute target path to scan (defaults to repository root)",
        },
        exts: {
          type: "string",
          description: "Comma-separated list of extensions to include (e.g. 'ts,rs,toml')",
        },
        parallel: {
          type: "integer",
          minimum: 1,
          maximum: 256,
          description: "Max parallel I/O workers (default: 16)",
        },
      },
    },
  },
  {
    name: "yolo_parse",
    description:
      "Perform fast AST and token analysis on a TypeScript or JavaScript file using native Bun wyhash and token streaming.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to TypeScript/JavaScript file to parse",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "yolo_doctor",
    description:
      "Inspect environment diagnostics, toolchain availability (Bun, Rust, C compiler, uv/Python), runtime artifacts, and capabilities.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "yolo_bench",
    description:
      "Execute native Bun nanosecond-precision micro-benchmarks for hashing (wyhash, crc32) and string widths.",
    inputSchema: {
      type: "object",
      properties: {
        iterations: {
          type: "integer",
          minimum: 1,
          maximum: 1000000,
          description: "Number of benchmark iterations (default: 200,000)",
        },
      },
    },
  },
  {
    name: "yolo_host_space",
    description:
      "Measure disk space breakdown for a directory with deduplication of hard links and safety checks.",
    inputSchema: {
      type: "object",
      properties: {
        dir: {
          type: "string",
          description: "Directory path to measure",
        },
        parallel: { type: "integer", minimum: 1, maximum: 256 },
        depth: {
          type: "integer",
          minimum: 0,
          maximum: 32,
          description: "Scan depth (default: 2)",
        },
      },
      required: ["dir"],
    },
  },
  {
    name: "yolo_ai_infer",
    description:
      "Run a text inference turn through the configured native provider; no simulated fallback.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        model: { type: "string" },
        systemPrompt: { type: "string" },
        temperature: { type: "number", minimum: 0, maximum: 2 },
        maxTokens: { type: "integer", minimum: 1 },
        topP: { type: "number", minimum: 0, maximum: 1 },
        history: { type: "array", items: { type: "object" } },
      },
      required: ["prompt"],
    },
  },
  {
    name: "yolo_gemma4_status",
    description:
      "Inspect unverified repository Gemma 4 profiles, sliding window attention, KV cache and memory estimates for edge models (e2b, e4b, 26b, 31b).",
    inputSchema: {
      type: "object",
      properties: {
        model: {
          type: "string",
          description:
            "Model variant: 'gemma4-e2b' (smallest, default), 'gemma4-e4b', 'gemma4-26b-a4b-moe', 'gemma4-31b'",
        },
        seqLen: {
          type: "integer",
          minimum: 1,
          maximum: 10000000,
          description: "Sequence length for KV cache estimation (default: 512)",
        },
      },
    },
  },
  {
    name: "yolo_gemma4_prompt",
    description:
      "Format conversational turns with optional thought traces and multimodal tags into the repository Gemma 4 text template.",
    inputSchema: {
      type: "object",
      properties: {
        system: {
          type: "string",
          description: "Optional system prompt instruction",
        },
        user: {
          type: "string",
          description: "User prompt message",
        },
        thought: {
          type: "string",
          description: "Optional model thought trace",
        },
        imageCount: {
          type: "integer",
          minimum: 0,
          maximum: 256,
          description: "Number of <image> tokens to prepend",
        },
      },
      required: ["user"],
    },
  },
  {
    name: "yolo_vector_search",
    description:
      "Search persistent vectors by cosine similarity using an explicit query vector or a configured embedding provider.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Query text requiring a configured real embedding provider",
        },
        queryVector: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 65536 },
        filter: { type: "object", additionalProperties: { type: "string" } },
        namespace: {
          type: "string",
          description: "Vector index namespace (default: 'default')",
        },
        topK: {
          type: "integer",
          minimum: 1,
          maximum: 1000,
          description: "Number of top results to return (default: 5)",
        },
      },
      anyOf: [{ required: ["query"] }, { required: ["queryVector"] }],
    },
  },
  {
    name: "yolo_traindb_stats",
    description:
      "Retrieve training dataset statistics, sample counts, and splits from Redis Train DB.",
    inputSchema: {
      type: "object",
      properties: {
        dataset: {
          type: "string",
          description: "Dataset partition name (default: 'default')",
        },
      },
    },
  },
];

export interface ToolExecutionContextOptions {
  inference?: UnifiedInferenceEngine | undefined;
  redisClient?: NativeRedisClient | undefined;
  embed?: ((text: string) => Promise<Float32Array>) | undefined;
  containPaths?: boolean | undefined;
}

export interface ToolCallOptions {
  signal?: AbortSignal | undefined;
}

/** One context per transport; clients supplied by callers remain caller-owned. */
export class ToolExecutionContext {
  readonly inference: UnifiedInferenceEngine;
  readonly redisClient: NativeRedisClient;
  readonly embed: ToolExecutionContextOptions["embed"];
  readonly containPaths: boolean;
  readonly #ownsClient: boolean;
  readonly #vectors = new Map<string, RedisVectorStore>();
  readonly #datasets = new Map<string, RedisTrainDb>();
  #closed = false;

  constructor(options: ToolExecutionContextOptions = {}) {
    this.inference =
      options.inference ??
      new UnifiedInferenceEngine(process.env["YOLO_INFERENCE_MODEL"] ?? "gemma4-e2b", {
        apiKey: process.env["YOLO_INFERENCE_API_KEY"],
      });
    this.redisClient = options.redisClient ?? new NativeRedisClient();
    this.#ownsClient = !options.redisClient;
    this.embed = options.embed;
    this.containPaths = options.containPaths ?? false;
  }

  vectorStore(namespace = "default"): RedisVectorStore {
    if (this.#closed) throw new Error("Tool context is closed");
    let store = this.#vectors.get(namespace);
    if (!store) {
      if (this.#vectors.size >= 128) throw new ToolArgumentError("Too many vector namespaces");
      store = new RedisVectorStore(this.redisClient, namespace);
      this.#vectors.set(namespace, store);
    }
    return store;
  }

  trainDb(dataset = "default"): RedisTrainDb {
    if (this.#closed) throw new Error("Tool context is closed");
    let db = this.#datasets.get(dataset);
    if (!db) {
      if (this.#datasets.size >= 128) throw new ToolArgumentError("Too many datasets");
      db = new RedisTrainDb(this.redisClient, dataset);
      this.#datasets.set(dataset, db);
    }
    return db;
  }

  close(): void {
    this.#closed = true;
    this.#vectors.clear();
    this.#datasets.clear();
    if (this.#ownsClient) this.redisClient.close();
  }
}

const defaultContexts = new Map<string, ToolExecutionContext>();
export function defaultContext(rootDir: string): ToolExecutionContext {
  const key = resolve(rootDir);
  let context = defaultContexts.get(key);
  if (!context) {
    if (defaultContexts.size >= 32) {
      const oldest = defaultContexts.keys().next().value!;
      defaultContexts.get(oldest)!.close();
      defaultContexts.delete(oldest);
    }
    context = new ToolExecutionContext();
    defaultContexts.set(key, context);
  }
  return context;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateValue(value: unknown, schema: Record<string, unknown>, label: string): void {
  const type = schema.type;
  if (
    (type === "number" || type === "integer") &&
    (typeof value !== "number" ||
      !Number.isFinite(value) ||
      (type === "integer" && !Number.isInteger(value)))
  ) {
    throw new ToolArgumentError(`${label} must be a finite ${type}`);
  }
  if (type === "string" && typeof value !== "string")
    throw new ToolArgumentError(`${label} must be a string`);
  if (type === "boolean" && typeof value !== "boolean")
    throw new ToolArgumentError(`${label} must be a boolean`);
  if (
    typeof value === "number" &&
    ((typeof schema.minimum === "number" && value < schema.minimum) ||
      (typeof schema.maximum === "number" && value > schema.maximum))
  ) {
    throw new ToolArgumentError(`${label} is outside the allowed range`);
  }
  if (type === "array") {
    if (!Array.isArray(value)) throw new ToolArgumentError(`${label} must be an array`);
    if (
      (typeof schema.minItems === "number" && value.length < schema.minItems) ||
      (typeof schema.maxItems === "number" && value.length > schema.maxItems)
    ) {
      throw new ToolArgumentError(`${label} has an invalid length`);
    }
    if (isRecord(schema.items))
      value.forEach((item, index) =>
        validateValue(item, schema.items as Record<string, unknown>, `${label}[${index}]`),
      );
  }
  if (type === "object") {
    if (!isRecord(value)) throw new ToolArgumentError(`${label} must be an object`);
    if (isRecord(schema.additionalProperties)) {
      for (const [key, item] of Object.entries(value))
        validateValue(item, schema.additionalProperties, `${label}.${key}`);
    }
  }
}

export function validateToolArguments(
  name: string,
  args: unknown,
): asserts args is Record<string, unknown> {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (!tool) throw new ToolArgumentError(`Unknown tool: ${name}`);
  if (!isRecord(args)) throw new ToolArgumentError("Tool arguments must be an object");
  for (const key of tool.inputSchema.required ?? []) {
    if (args[key] === undefined) throw new ToolArgumentError(`Missing required argument: '${key}'`);
  }
  if (
    tool.inputSchema.anyOf &&
    !tool.inputSchema.anyOf.some((branch) =>
      branch.required.every((key) => args[key] !== undefined),
    )
  ) {
    throw new ToolArgumentError("Provide queryVector or query with an embedding provider");
  }
  for (const [key, value] of Object.entries(args)) {
    const schema = tool.inputSchema.properties[key];
    if (!isRecord(schema)) throw new ToolArgumentError(`Unknown argument: '${key}'`);
    validateValue(value, schema, key);
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown> = {},
  rootDir: string = yoloHome(),
  context: ToolExecutionContext = defaultContext(rootDir),
  callOptions: ToolCallOptions = {},
): Promise<unknown> {
  validateToolArguments(name, args);
  switch (name) {
    case "yolo_package_sync": {
      const root = context.containPaths
        ? resolveContainedPath(rootDir, args.path as string | undefined)
        : resolve(rootDir, (args.path as string) ?? ".");
      const managers =
        typeof args.managers === "string"
          ? args.managers.split(",").map((value) => value.trim())
          : undefined;
      if (
        managers &&
        (managers.length === 0 || managers.some((value) => !["bun", "uv", "cargo"].includes(value)))
      )
        throw new ToolArgumentError("Choose managers: bun, uv, cargo");
      return syncPackages({
        root,
        managers: managers as PackageManager[] | undefined,
        apply: args.apply === true,
        offline: args.offline === true,
        production: args.production === true,
        timeoutMs: args.timeoutMs as number | undefined,
        signal: callOptions.signal,
      });
    }

    case "yolo_verify": {
      let selected = [...GATES];
      let selection: Report["selection"] = "all";
      if (typeof args.only === "string" && args.only.length > 0) {
        const want = args.only
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const unknown = want.filter((id) => !GATES.some((gate) => gate.id === id));
        if (unknown.length) throw new ToolArgumentError(`Unknown gates: ${unknown.join(", ")}`);
        selected = GATES.filter((g) => want.includes(g.id));
        selection = "only";
      } else if (args.changed === true) {
        selected = selectChanged(GATES, changedFiles(rootDir));
        selection = "changed";
      }
      const ids = new Set(selected.map((gate) => gate.id));
      for (const gate of selected) {
        for (const id of gate.needs ?? []) {
          if (ids.has(id)) continue;
          const dependency = GATES.find((entry) => entry.id === id);
          if (dependency) {
            ids.add(id);
            selected.push(dependency);
          }
        }
      }
      selected = GATES.filter((gate) => ids.has(gate.id));
      const parallel = Math.max(1, Number(args.parallel ?? navigator.hardwareConcurrency ?? 4));
      const runner = spawnRunner(rootDir, 60_000);
      const outcome = await runGates(selected, runner, { parallel, root: rootDir });
      const sum = summarize(outcome.results, outcome.wallMs);
      return {
        schema: "yolo.verify/1",
        startedAt: new Date().toISOString(),
        root: rootDir,
        selection,
        parallel,
        wallMs: outcome.wallMs,
        ...sum,
        gates: outcome.results,
        notRun: NOT_RUN_HEAVY,
      };
    }

    case "yolo_status": {
      return await collectStatusReport(rootDir);
    }

    case "yolo_scan": {
      const target = context.containPaths
        ? resolveContainedPath(rootDir, args.path as string | undefined)
        : typeof args.path === "string"
          ? resolve(rootDir, args.path)
          : rootDir;
      const exts =
        typeof args.exts === "string" ? args.exts.split(",").map((e) => e.trim()) : undefined;
      const parallel = typeof args.parallel === "number" ? args.parallel : 16;
      return await scanDirectory(target, { exts, parallel });
    }

    case "yolo_n2b_scan": {
      const target = context.containPaths
        ? resolveContainedPath(rootDir, args.path as string | undefined)
        : resolve(rootDir, (args.path as string | undefined) ?? ".");
      const { scanNodeProject } = await import("../compiler/native");
      return scanNodeProject(target, {
        mode: "check",
        dry_run: true,
        ...(typeof args.jobs === "number" ? { jobs: args.jobs } : {}),
        ...(Array.isArray(args.ignore) ? { ignore: args.ignore as string[] } : {}),
      });
    }

    case "yolo_parse": {
      if (typeof args.path !== "string") {
        throw new Error("Missing required argument: 'path'");
      }
      const filePath = context.containPaths
        ? resolveContainedPath(rootDir, args.path)
        : resolve(rootDir, args.path);
      return await parseTsSource(filePath);
    }

    case "yolo_doctor": {
      return collectDoctorReport();
    }

    case "yolo_bench": {
      const iters =
        typeof args.iterations === "number"
          ? Math.max(10_000, Math.min(1_000_000, args.iterations))
          : 200_000;
      const testBuffer = Buffer.from("Aphrody YOLO Bun Industrial Engine Benchmark Data String");

      const t0 = Bun.nanoseconds();
      let lastHash = 0n;
      for (let i = 0; i < iters; i++) {
        lastHash = Bun.hash.wyhash(testBuffer, BigInt(i));
      }
      const elapsedWyhashMs = Number(((Bun.nanoseconds() - t0) / 1_000_000).toFixed(2));

      const t1 = Bun.nanoseconds();
      let lastCrc = 0;
      for (let i = 0; i < iters; i++) {
        lastCrc = Bun.hash.crc32(testBuffer, i);
      }
      const elapsedCrcMs = Number(((Bun.nanoseconds() - t1) / 1_000_000).toFixed(2));

      return {
        schema: "yolo.bench/1",
        iterations: iters,
        wyhash: {
          elapsedMs: elapsedWyhashMs,
          opsPerSec: Math.round((iters / (elapsedWyhashMs || 1)) * 1000),
          sample: lastHash.toString(16).slice(0, 8),
        },
        crc32: {
          elapsedMs: elapsedCrcMs,
          opsPerSec: Math.round((iters / (elapsedCrcMs || 1)) * 1000),
          sample: lastCrc.toString(16),
        },
      };
    }

    case "yolo_host_space": {
      if (typeof args.dir !== "string") {
        throw new Error("Missing required argument: 'dir'");
      }
      const depth = typeof args.depth === "number" ? args.depth : 2;
      const parallel = typeof args.parallel === "number" ? args.parallel : 8;
      const dir = context.containPaths ? resolveContainedPath(rootDir, args.dir) : args.dir;
      const records = await scanLinks([dir], {
        run: async (cmd: string) => {
          const proc = Bun.spawn(["sh", "-c", cmd], { windowsHide: true, stdout: "pipe" });
          return await new Response(proc.stdout).text();
        },
        depth,
        parallel,
      });
      const reclaim = estimateReclaim(records);
      return {
        dir: args.dir,
        recordsCount: records.length,
        reclaim,
      };
    }

    case "yolo_ai_infer": {
      return context.inference.infer({
        ...(args as unknown as UnifiedInferenceRequest),
        signal: callOptions.signal,
      });
    }
    case "yolo_gemma4_status": {
      const modelName = typeof args.model === "string" ? args.model : "gemma4-e2b";
      const seqLen = typeof args.seqLen === "number" ? args.seqLen : 512;
      const config = getGemma4Config(modelName);
      const memory = estimateGemma4Memory(config);
      const kvCache = computeKVCacheFootprintBytes(config, 1, seqLen);
      return {
        schema: "yolo.gemma4.status/1",
        model: config.name,
        provenance: GEMMA4_CONFIG_PROVENANCE,
        weightsLoaded: false,
        isSmallestEdgeModel: config.name === "gemma4-e2b",
        architecture: {
          vocabSize: config.vocabSize,
          embedDim: config.embedDim,
          hiddenDim: config.hiddenDim,
          numLayers: config.numLayers,
          numHeads: config.numHeads,
          numKvHeads: config.numKvHeads,
          slidingWindowSize: config.slidingWindowSize,
          finalLogitSoftcap: config.finalLogitSoftcap,
          enableMoe: config.enableMoe,
          hasVision: Boolean(config.visionEncoder),
          hasAudio: Boolean(config.audioEncoder),
        },
        memory: {
          paramCountEst: memory.paramCount,
          weightMemoryMbBf16: memory.memoryMb,
          kvCacheFootprintBytes: kvCache.totalBytes,
          kvCacheFootprintMb: kvCache.totalMb,
        },
      };
    }

    case "yolo_gemma4_prompt": {
      if (typeof args.user !== "string") {
        throw new Error("Missing required argument: 'user'");
      }
      const messages: Gemma4Message[] = [];
      if (typeof args.system === "string" && args.system) {
        messages.push({ role: "system", content: args.system });
      }
      messages.push({
        role: "user",
        content: args.user,
        imageCount: typeof args.imageCount === "number" ? args.imageCount : undefined,
      });
      if (typeof args.thought === "string" && args.thought) {
        messages.push({
          role: "model",
          content: "",
          thought: args.thought,
        });
      }
      const formatted = formatGemma4ChatPrompt(messages);
      return {
        schema: "yolo.gemma4.prompt/1",
        formattedPrompt: formatted,
        length: formatted.length,
      };
    }

    case "yolo_vector_search": {
      const namespace = typeof args.namespace === "string" ? args.namespace : "default";
      const topK = typeof args.topK === "number" ? args.topK : 5;
      let queryVector: Float32Array;
      if (Array.isArray(args.queryVector)) {
        queryVector = new Float32Array(args.queryVector);
      } else {
        if (!context.embed)
          throw new ToolArgumentError("No embedding provider configured; supply queryVector");
        queryVector = await context.embed(args.query as string);
      }
      const store = context.vectorStore(namespace);
      const results = await store.query(
        queryVector,
        topK,
        args.filter as Record<string, string> | undefined,
      );
      return { schema: "yolo.vector.search/1", namespace, topK, results };
    }

    case "yolo_traindb_stats": {
      const dataset = typeof args.dataset === "string" ? args.dataset : "default";
      const stats = await context.trainDb(dataset).getStats();
      return { schema: "yolo.traindb.stats/1", ...stats };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Same catalog subset for AI CLI discovery and execution; no second schema list. */
export function isAiTool(name: string): boolean {
  return (
    /^yolo_(?:ai_|gemma4_|vector_|traindb_)/.test(name) && TOOLS.some((tool) => tool.name === name)
  );
}
