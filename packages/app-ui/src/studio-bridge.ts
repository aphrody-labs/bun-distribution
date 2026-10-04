// SPDX-License-Identifier: Apache-2.0
// Studio bridge: typed calls to the in-process Koharu service (`koharu_rpc`, crates/ui/app/src/koharu.rs).
// Shapes mirror crates/koharu/koharu-library/src/{service,project}.rs and koharu-pipeline request types.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./tauri-bridge";

export type KoharuStage = "detection" | "ocr" | "translation" | "inpainting";

export type KoharuOperation =
  | { operation: "full" }
  | { operation: "through"; stage: KoharuStage }
  | { operation: "only"; stage: KoharuStage }
  | { operation: "stages"; stages: KoharuStage[] };

export interface KoharuProjectSummary {
  name: string;
}

export interface KoharuProjectInfo {
  name: string;
  revision: unknown;
  active_page: string | null;
  can_undo: boolean;
  can_redo: boolean;
}

export interface KoharuPageSummary {
  id: string;
  label: string;
  size: { width: number; height: number };
  source_asset: string | null;
  layer_count: number;
}

export interface KoharuPipelineReport {
  status: string;
  completed: number;
  total: number;
  elapsedMs: number;
  project: KoharuProjectInfo;
}

export async function koharuRpc<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (!isTauri()) throw new Error("Koharu nécessite l’application Aphrody.");
  // Native IPC rejects errors; JSON null is a valid successful result (e.g. project.close).
  return invoke<T>("koharu_rpc", { method, params });
}

export const koharu = {
  listProjects: () => koharuRpc<KoharuProjectSummary[]>("project.list"),
  createProject: (name: string) => koharuRpc<KoharuProjectInfo>("project.create", { name }),
  openProject: (name: string) => koharuRpc<KoharuProjectInfo>("project.open", { name }),
  closeProject: () => koharuRpc<null>("project.close"),
  pages: () => koharuRpc<KoharuPageSummary[]>("project.pages"),
  importPaths: (paths: string[]) =>
    koharuRpc<{ pages: unknown; project: KoharuProjectInfo }>("project.importPaths", { paths }),
  runPipeline: (operation: KoharuOperation, pages?: string[], cpu = false) =>
    koharuRpc<KoharuPipelineReport>("pipeline.run", {
      operation,
      scope: pages && pages.length > 0 ? { scope: "pages", value: pages } : { scope: "project" },
      cpu,
    }),
  pipelineStatus: () => koharuRpc<{ running: number | null }>("pipeline.status"),
  cancelPipeline: (job: number) => koharuRpc<{ cancelled: true }>("pipeline.cancel", { job }),
  exportPng: (page: string, path: string) =>
    koharuRpc<{ path: string; bytes: number }>("page.exportPng", { page, path }),
  exportPsd: (page: string, path: string) =>
    koharuRpc<{ path: string; bytes: number }>("page.exportPsd", { page, path }),
  resources: () => koharuRpc<unknown>("resources.status"),
};

/** Structured Shenron reports from crates/ui/app/src/studio.rs (logic owned by aphrody-command). */
async function studio<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) throw new Error("Cette vue nécessite l’application Aphrody.");
  // Result<()> commands (admin window and training start) serialize successful acknowledgement as null.
  return invoke<T>(command, args);
}

export interface ShenronProbe {
  reachable?: boolean;
  configured?: boolean;
  status?: number;
  [key: string]: unknown;
}

export interface ShenronHealth {
  status: "operational" | "degraded";
  site: ShenronProbe;
  bot: ShenronProbe;
  aphrody_ai_http: ShenronProbe;
  serving_rag: {
    reachable: boolean;
    ready: boolean;
    chunks?: number;
    vectors?: number;
    reason?: string;
  };
  agent_home: { valid: boolean; files?: number; revision?: string; error?: string };
  rag_backend: string;
}

export interface ShenronRagStats {
  chunks: number;
  vectors: number;
  sources?: Array<{ kind: string; sourceId: string; count: number }>;
}

export interface ShenronRagHit {
  kind?: string;
  title?: string;
  url?: string;
  snippet?: string;
}

export interface ShenronTraining {
  python_project: string | null;
  gpu_count: number;
  candidate_root: string;
  rag_promotion: string;
}

export const shenron = {
  health: () => studio<ShenronHealth>("studio_shenron_health"),
  ragStats: () => studio<ShenronRagStats>("studio_shenron_rag_stats"),
  ragSearch: (query: string, limit = 10, kind?: string) =>
    studio<{ mode?: string; results: ShenronRagHit[] }>("studio_shenron_rag_search", {
      query,
      limit,
      kind: kind ?? null,
    }),
  training: () => studio<ShenronTraining>("studio_shenron_training"),
};

export interface NativeAiStatus {
  chat: { ready: boolean; model?: string; port?: number };
  embed: { ready: boolean; model?: string; port?: number };
  rerank: { ready: boolean; model?: string; port?: number };
}

export const nativeAi = {
  status: () => studio<NativeAiStatus>("studio_native_ai_status"),
  /** Open the full Shenron admin dashboard in its native window (local-AI bridge injected). */
  openAdmin: (url?: string) => studio<null>("studio_open_shenron_admin", { url: url ?? null }),
};

export type TrainKind = "embed" | "rerank";

export type TrainEvent =
  | { state: "started"; kind: TrainKind; steps: number; baseModel: string }
  | { state: "finished"; kind: TrainKind; output: string }
  | { state: "failed"; kind: TrainKind; error: string };

export const training = {
  /** Acknowledgement only; completion/failure comes from the native studio://train event. */
  start: (kind: TrainKind, steps: number, allowCpu: boolean, baseModel?: string) =>
    studio<null>("studio_shenron_train_start", {
      kind,
      steps,
      allowCpu,
      baseModel: baseModel ?? null,
    }),
  async onEvent(handler: (event: TrainEvent) => void): Promise<() => void> {
    if (!isTauri())
      throw new Error("Les événements d’entraînement nécessitent l’application Aphrody.");
    return listen<TrainEvent>("studio://train", (event) => handler(event.payload));
  },
};

export interface CorpusHit {
  rowid: string;
  kind: string;
  title: string;
  url: string;
  snippet: string;
  score: number;
  lang: string;
  originSourceId: string;
  entity?: string;
}

/** Offline Shenron corpus (aphrody-rag::dragonball::LocalCorpus) through the Studio commands. */
export const corpus = {
  info: () => studio<{ documents: number }>("studio_corpus_info"),
  search: (query: string, options: { limit?: number; kind?: string; lang?: string } = {}) =>
    studio<{ results?: CorpusHit[]; hits?: CorpusHit[]; [key: string]: unknown }>(
      "studio_corpus_search",
      {
        query,
        limit: options.limit ?? 20,
        kind: options.kind ?? null,
        lang: options.lang ?? null,
      },
    ),
  ask: (question: string) => studio<Record<string, unknown>>("studio_corpus_ask", { question }),
};

export interface GoogleDriveGrant {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
}

/** Google OAuth loopback consent with the Aphrody OAuth client; tokens kept in the private store. */
export const authorizeGoogleDrive = () => studio<GoogleDriveGrant>("studio_google_drive_authorize");
