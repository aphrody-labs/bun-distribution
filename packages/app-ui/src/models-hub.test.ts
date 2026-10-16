import { describe, expect, test } from "bun:test";
import {
  applyProgress,
  buildStandardExternalCandidates,
  entryBytes,
  evaluateDetectedStores,
  fitsVram,
  formatMb,
  inferHomeFromPath,
  installedIds,
  kindLabel,
  normalizeModelKind,
  resolveExternalModelPath,
  scanExternalModelDirectories,
  searchModelCatalog,
  cleanModelSearchQuery,
  STANDARD_EXTERNAL_MODEL_DIRS,
  startDownload,
} from "./models-hub-state";
import type { HardwareTelemetry } from "./tauri-bridge";

const hardware = (
  gpus: HardwareTelemetry["gpus"],
  cudaVramTotalMb: number | null = null,
): HardwareTelemetry => ({
  cpuThreads: 8,
  memoryTotalMb: 16384,
  memoryAvailableMb: 8192,
  avx2: true,
  cudaVramTotalMb,
  gpus,
  gpuError: gpus === null ? "aphrody model accel failed" : null,
});

describe("models hub state", () => {
  test("entry size is known only when every file declares one", () => {
    expect(
      entryBytes({
        files: [
          { role: "weights", ref: "a", bytes: 10 },
          { role: "tokenizer", ref: "b", bytes: 5 },
        ],
      }),
    ).toBe(15);
    expect(
      entryBytes({
        files: [
          { role: "weights", ref: "a", bytes: 10 },
          { role: "config", ref: "b" },
        ],
      }),
    ).toBeNull();
  });

  test("progress sums roles and measures throughput from real samples", () => {
    let state = startDownload(1000, 0);
    state = applyProgress(state, { id: "m", role: "weights", downloaded: 200, total: 800 }, 1000);
    expect(state.downloaded).toBe(200);
    expect(state.speedBps).toBe(200);
    expect(state.etaSeconds).toBe(4);
    state = applyProgress(state, { id: "m", role: "tokenizer", downloaded: 100, total: 200 }, 2000);
    expect(state.downloaded).toBe(300);
    expect(state.speedBps).toBeCloseTo(170);
  });

  test("installed ids come from the store's catalog ids", () => {
    const ids = installedIds({
      root: "/m",
      count: 2,
      total_bytes: 3,
      models: [
        {
          ref: "hf:a",
          path: "/m/a",
          bytes: 1,
          sha256: "x",
          format: "gguf",
          catalog_id: "whisper-base-en",
          installed_at: null,
          last_used_at: null,
        },
        {
          ref: "file:/b",
          path: "/b",
          bytes: 2,
          sha256: "y",
          format: "onnx",
          catalog_id: null,
          installed_at: null,
          last_used_at: null,
        },
      ],
    });
    expect([...ids]).toEqual(["whisper-base-en"]);
  });

  test("VRAM fit is unknown when the GPU probe failed, never assumed", () => {
    expect(fitsVram({ vram_min_bytes: 0 }, null)).toBe(true);
    expect(fitsVram({ vram_min_bytes: 4 * 1024 ** 3 }, hardware(null))).toBeNull();
    expect(fitsVram({ vram_min_bytes: 4 * 1024 ** 3 }, hardware([]))).toBe(false);
    expect(fitsVram({ vram_min_bytes: 4 * 1024 ** 3 }, hardware([], 8192))).toBe(true);
  });

  test("unprobed memory reads inconnu", () => {
    expect(formatMb(null)).toBe("inconnu");
    expect(formatMb(2048)).toBe("2.0 GB");
  });

  test("STANDARD_EXTERNAL_MODEL_DIRS declares Ollama, LM Studio and HuggingFace with exact subpaths", () => {
    const ids = STANDARD_EXTERNAL_MODEL_DIRS.map((d) => d.id);
    expect(ids).toEqual(["ollama", "lm-studio", "huggingface"]);

    const ollama = STANDARD_EXTERNAL_MODEL_DIRS.find((d) => d.id === "ollama");
    expect(ollama?.defaultSubpath).toBe(".ollama/models");

    const lmStudio = STANDARD_EXTERNAL_MODEL_DIRS.find((d) => d.id === "lm-studio");
    expect(lmStudio?.defaultSubpath).toBe(".cache/lm-studio/models");

    const hf = STANDARD_EXTERNAL_MODEL_DIRS.find((d) => d.id === "huggingface");
    expect(hf?.defaultSubpath).toBe(".cache/huggingface/hub");
  });

  test("resolveExternalModelPath formats paths correctly on Windows and POSIX without double slashes", () => {
    const posix = resolveExternalModelPath("/home/user", ".ollama/models");
    expect(posix).toBe("/home/user/.ollama/models");

    const posixTrailing = resolveExternalModelPath("/home/user/", ".cache/huggingface/hub");
    expect(posixTrailing).toBe("/home/user/.cache/huggingface/hub");

    const win = resolveExternalModelPath("C:\\Users\\test", ".ollama/models");
    expect(win).toBe("C:\\Users\\test\\.ollama\\models");

    const winTrailing = resolveExternalModelPath("C:\\Users\\test\\", ".cache/lm-studio/models");
    expect(winTrailing).toBe("C:\\Users\\test\\.cache\\lm-studio\\models");
  });

  test("buildStandardExternalCandidates builds candidates for all standard directories", () => {
    const candidates = buildStandardExternalCandidates("/home/testuser");
    expect(candidates.length).toBe(3);
    expect(candidates[0].path).toBe("/home/testuser/.ollama/models");
    expect(candidates[1].path).toBe("/home/testuser/.cache/lm-studio/models");
    expect(candidates[2].path).toBe("/home/testuser/.cache/huggingface/hub");
  });

  test("inferHomeFromPath extracts user home from Windows, Linux, and macOS paths", () => {
    expect(inferHomeFromPath("C:\\Users\\test\\src\\aphrody")).toBe("C:\\Users\\test");
    expect(inferHomeFromPath("D:\\Users\\developer\\.cache")).toBe("D:\\Users\\developer");
    expect(inferHomeFromPath("/home/ubuntu/projects/aphrody")).toBe("/home/ubuntu");
    expect(inferHomeFromPath("/Users/alice/Library/Application Support")).toBe("/Users/alice");
    expect(inferHomeFromPath("/var/log/syslog")).toBeNull();
  });

  test("evaluateDetectedStores maps probe results without assuming or faking presence", () => {
    const candidates = buildStandardExternalCandidates("/home/tester");
    const evaluated = evaluateDetectedStores(candidates, {
      "/home/tester/.ollama/models": { exists: true, modelCount: 4 },
      "/home/tester/.cache/lm-studio/models": false,
      "/home/tester/.cache/huggingface/hub": { exists: true, modelCount: 12 },
    });

    expect(evaluated.find((s) => s.id === "ollama")?.exists).toBe(true);
    expect(evaluated.find((s) => s.id === "ollama")?.modelCount).toBe(4);

    expect(evaluated.find((s) => s.id === "lm-studio")?.exists).toBe(false);
    expect(evaluated.find((s) => s.id === "lm-studio")?.modelCount).toBeUndefined();

    expect(evaluated.find((s) => s.id === "huggingface")?.exists).toBe(true);
    expect(evaluated.find((s) => s.id === "huggingface")?.modelCount).toBe(12);
  });

  test("scanExternalModelDirectories invokes custom probe and gathers results", async () => {
    const stores = await scanExternalModelDirectories("/home/tester", async (path) => {
      if (path.includes("ollama")) return { exists: true, modelCount: 3 };
      if (path.includes("huggingface")) return true;
      return false;
    });

    expect(stores.length).toBe(3);
    expect(stores.find((s) => s.id === "ollama")?.exists).toBe(true);
    expect(stores.find((s) => s.id === "ollama")?.modelCount).toBe(3);
    expect(stores.find((s) => s.id === "lm-studio")?.exists).toBe(false);
    expect(stores.find((s) => s.id === "huggingface")?.exists).toBe(true);
  });

  test("normalizeModelKind categorizes tasks and model names into chat, embedding, OCR, speech", () => {
    expect(normalizeModelKind("text-generation")).toBe("chat");
    expect(normalizeModelKind("Qwen2.5-Coder-7B-Instruct")).toBe("chat");
    expect(normalizeModelKind("Llama-3.3-70B-Instruct")).toBe("chat");

    expect(normalizeModelKind("text-embedding")).toBe("embedding");
    expect(normalizeModelKind("text-rerank")).toBe("embedding");
    expect(normalizeModelKind("bge-m3")).toBe("embedding");
    expect(normalizeModelKind("multilingual-e5-small")).toBe("embedding");

    expect(normalizeModelKind("ocr")).toBe("OCR");
    expect(normalizeModelKind("visual-transcription")).toBe("OCR");
    expect(normalizeModelKind("dots.ocr-1.5b")).toBe("OCR");
    expect(normalizeModelKind("granite-docling-258m")).toBe("OCR");

    expect(normalizeModelKind("speech-to-text")).toBe("speech");
    expect(normalizeModelKind("whisper-base-en")).toBe("speech");
  });

  test("kindLabel returns clean display labels", () => {
    expect(kindLabel("chat")).toBe("Chat");
    expect(kindLabel("embedding")).toBe("Embedding");
    expect(kindLabel("OCR")).toBe("OCR");
    expect(kindLabel("speech")).toBe("Speech");
  });
});

const entry = (id: string, ref = `hf:org/${id}/${id}-Q4.gguf@revision`) => ({
  id,
  title: id,
  summary: "Local inference",
  files: [{ role: "weights", ref }],
});

// Adapted Jan hub cases: exact identifiers, quant variants, URL queries and stable ranking.
describe("Jan model search absorbed into the existing catalog", () => {
  test("a pasted HF URL resolves its exact repository before nearby names", () => {
    const models = [entry("gemma-nearby"), entry("gemma-target"), entry("another-gemma")];
    const result = searchModelCatalog(models, "https://huggingface.co/org/gemma-target");
    expect(result[0]).toBe(models[1]);
    expect(models.map((model) => model.id)).toEqual([
      "gemma-nearby",
      "gemma-target",
      "another-gemma",
    ]);
  });

  test("exact variant filenames rank before fuzzy neighbors", () => {
    const models = [
      entry("neighbor", "hf:org/neighbor/exact-quont-Q4.gguf@revision"),
      entry("target", "hf:org/target/exact-quant-Q4.gguf@revision"),
    ];
    expect(searchModelCatalog(models, "exact-quant-Q4.gguf")[0]).toBe(models[1]);
  });

  test("matching ignores case, leading URL whitespace and host casing", () => {
    const model = entry("target");
    expect(cleanModelSearchQuery(" HTTPS://huggingface.co/ORG/target ")).toBe("ORG/target");
    expect(searchModelCatalog([model], " HTTPS://huggingface.co/ORG/target ")).toEqual([model]);
  });

  test("complete Fuse library handles typos and unknown searches", () => {
    const model = entry("gemma-target");
    expect(searchModelCatalog([model], "gemma-targte")).toEqual([model]);
    expect(searchModelCatalog([model], "xxxxxxxxxxxxxx")).toEqual([]);
  });

  test("blank query preserves input, rows and tie ordering", () => {
    const models = [entry("gemma-b"), entry("gemma-a")];
    expect(searchModelCatalog(models, "   ")).toBe(models);
    expect(searchModelCatalog(models, "gemma")).toEqual(models);
  });
});
