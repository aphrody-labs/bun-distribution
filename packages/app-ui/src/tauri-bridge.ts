// SPDX-License-Identifier: Apache-2.0
/**
 * Web bridge for Aphrody OS (the native shell is not part of the web build).
 * Encapsulates window manager controls, native dialogs, OS telemetry,
 * desktop notifications, clipboard manager, and process lifecycle.
 */

import { browserSessionStream } from "./browser-session-stream";
import { webOsRagSearch, webOsRagStats, webOsReadDir, webOsReadText, wantsHttpBackend } from "./webos-backend";

export interface ShellWindowState {
  label: string;
  title: string;
  focused: boolean;
  minimized: boolean;
  maximized: boolean;
  decorated: boolean;
  theme: "light" | "dark";
}

export interface OsInfo {
  platform: string;
  version: string;
  arch: string;
  locale: string;
  hostname: string;
  osType: string;
}


/** The web build has no native shell: always false. Kept so callers can test it without a branch. */
export function isTauri(): boolean {
  return false;
}

/** Native commands do not exist on the web; callers receive null. */
export async function tauriInvoke<T>(_cmd: string, _args: Record<string, unknown> = {}): Promise<T | null> {
  return null;
}

/** Plain browser without a remote daemon: the Rust WebAssembly backend answers (`?backend=http` opts out). */
export function usesBrowserBackend(): boolean {
  return !isTauri() && typeof window !== "undefined" && !wantsHttpBackend(window.location.search);
}


export interface LocalAiAnswer {
  answer: string;
}

/** Ask the local chat model served by the managed `llama-server` (`studio_native_chat`). */
export async function askLocalAi(_prompt: string): Promise<LocalAiAnswer> {
  throw new Error("L’assistant local est disponible dans l’application de bureau.");
}

// ==========================================
// Window Management (aphrody_shell_window)
// ==========================================

export async function shellWindowAction(
  _action: Record<string, unknown>,
): Promise<{ closed: boolean; state?: ShellWindowState } | null> {
  return null;
}

export async function shellMinimize() {
  return shellWindowAction({ action: "minimize" });
}

export async function shellMaximize() {
  return shellWindowAction({ action: "maximize" });
}

export async function shellRestore() {
  return shellWindowAction({ action: "restore" });
}

export async function shellToggleMaximize() {
  return shellWindowAction({ action: "toggle_maximize" });
}

export async function shellClose() {
  return shellWindowAction({ action: "close" });
}

export async function shellGetState(): Promise<ShellWindowState | null> {
  const res = await shellWindowAction({ action: "state" });
  return res?.state ?? null;
}

export async function shellSetTheme(theme: "system" | "light" | "dark") {
  return shellWindowAction({ action: "set_theme", theme });
}

/**
 * Signal that the page has rendered (no native splash on the web).
 * This triggers `aphrody_app_ready` in the desktop backend to show the main window
 * and dismiss the splash screen immediately without waiting for `SPLASH_TIMEOUT`.
 */
export async function appReady(): Promise<void> {}

// ==========================================
// Dialogs (browser)
// ==========================================

export async function pickDirectory(_title = "Select Working Directory", _defaultPath?: string): Promise<string | null> {
  return null;
}

export async function pickFile(_title = "Select File", _defaultPath?: string): Promise<string | null> {
  return null;
}

export async function saveFileDialog(_options: { title?: string; defaultPath?: string; filters?: unknown[] }): Promise<string | null> {
  return null;
}

export async function confirmNative(message: string, _title = "Confirmation"): Promise<boolean> {
  return window.confirm(message);
}

export async function messageNative(message: string, _title?: string, _kind?: string): Promise<void> {
  window.alert(message);
}

export async function getOsTelemetry(): Promise<OsInfo> {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    platform: nav?.platform ?? "web",
    version: nav?.userAgent ?? "",
    arch: "",
    locale: nav?.language ?? "en",
    hostname: typeof location === "undefined" ? "" : location.hostname,
    osType: "web",
  };
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  return (await Notification.requestPermission()) === "granted";
}

export async function sendDesktopNotification(title: string, body?: string): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  new Notification(title, { body });
}

export async function copyToNativeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function readNativeClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

// Process lifecycle: a browser tab is closed or reloaded, not restarted by the app.
export async function restartApp(): Promise<void> {
  location.reload();
}

export async function exitApp(_code = 0): Promise<void> {
  window.close();
}

export interface GpuInfo {
  name: string;
  vram_bytes: number;
  vram_free_bytes: number;
  driver: string;
  compute_capability: string;
}

/** Probed host facts; `null` means the value could not be probed (shown as "inconnu"). */
export interface HardwareTelemetry {
  cpuThreads: number | null;
  memoryTotalMb: number | null;
  memoryAvailableMb: number | null;
  avx2: boolean | null;
  cudaVramTotalMb: number | null;
  /** `null` when `aphrody model accel` could not run; see `gpuError`. */
  gpus: GpuInfo[] | null;
  gpuError: string | null;
}

/** One catalog entry of `aphrody model catalog --json` (aphrody-models `CatalogEntry`). */
export interface CatalogEntry {
  id: string;
  title: string;
  task: string;
  backend: string;
  summary: string;
  files: Array<{ role: string; ref: string; bytes?: number; sha256?: string }>;
  accel: string[];
  vram_min_bytes: number;
  speed: string;
  license: { spdx: string; commercial_use?: unknown };
}

/** One installed artefact of `aphrody model list --json`. */
export interface InstalledModel {
  ref: string;
  path: string;
  bytes: number;
  sha256: string;
  format: string;
  catalog_id: string | null;
  installed_at: string | null;
  last_used_at: string | null;
}

export interface InstalledModels {
  root: string;
  count: number;
  total_bytes: number;
  models: InstalledModel[];
}

export interface PullReport {
  spec: string;
  artifacts: Array<{
    ref: string;
    path: string;
    bytes: number;
    sha256: string;
    format: string;
    outcome: string;
  }>;
  transferred_bytes: number;
  total_bytes: number;
}

export interface VerifyReport {
  spec: string;
  intact: boolean;
  artifacts: unknown[];
}

/** Payload of the `aphrody://model-pull` event. */
export interface PullProgress {
  id: string;
  role: string | null;
  downloaded: number;
  total: number | null;
}

export const MODEL_PULL_EVENT = "aphrody://model-pull";

/** Desktop-only command: unavailable on the web. */
async function desktopInvoke<T>(command: string, _args: Record<string, unknown> = {}): Promise<T> {
  throw new Error(`Aphrody desktop backend unavailable on the web (${command})`);
}

export function getHardwareTelemetry(): Promise<HardwareTelemetry> {
  return desktopInvoke<HardwareTelemetry>("aphrody_hardware_telemetry");
}

export function fetchModelCatalog(): Promise<{
  count: number;
  entries: CatalogEntry[];
}> {
  return desktopInvoke("aphrody_model_catalog");
}

export function fetchInstalledModels(): Promise<InstalledModels> {
  return desktopInvoke("aphrody_model_list");
}

export function fetchModelStoreRoot(): Promise<string> {
  return desktopInvoke("aphrody_model_store_root");
}

export function pullModel(id: string): Promise<PullReport> {
  return desktopInvoke("aphrody_model_pull", { id, force: false });
}

export function cancelModelPull(id: string): Promise<boolean> {
  return desktopInvoke("aphrody_model_cancel", { id });
}

export function verifyModel(id: string): Promise<VerifyReport> {
  return desktopInvoke("aphrody_model_verify", { id });
}

export function removeModel(id: string): Promise<unknown> {
  return desktopInvoke("aphrody_model_remove", { id });
}

export interface ExternalStoreStatus {
  id: string;
  name: string;
  path: string;
  exists: boolean;
  model_count?: number;
}

export function scanExternalModelStores(): Promise<ExternalStoreStatus[]> {
  return desktopInvoke("aphrody_model_scan_external");
}

export async function onModelPullProgress(handler: (progress: PullProgress) => void): Promise<() => void> {
  void handler;
  return () => undefined;
}

// ==========================================
// Auto-updater (the web page is always current)
// ==========================================

/** `plugin:updater|check` result (plugin `Metadata`), `null` when up to date. */
export interface UpdateMetadata {
  rid: number;
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
}

/** Ask the configured release feed for a newer signed build. Errors (no endpoint, bad signature, network) propagate. */
export function checkForAppUpdate(): Promise<UpdateMetadata | null> {
  return Promise.resolve(null);
}

export async function installAppUpdate(_onEvent?: unknown): Promise<void> {
  throw new Error("Updates are delivered by reloading the web app.");
}

let bridgeRequestId = 0;
let initialization: Promise<void> | undefined;

export function ensureAphrodyInitialized(): Promise<void> {
  initialization ??= (async () => {
    try {
      await aphrodyRpc("initialize", {
        clientInfo: { name: "aphrody-desktop", version: "1.0.0" },
        capabilities: { experimentalApi: false, aphrody: true },
      });
    } catch (error) {
      // A different webview may already have initialized the shared broker.
      if (!(error instanceof Error) || error.message !== "invalid request: Already initialized") throw error;
    }
    await aphrodyRpc("initialized");
  })().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

/** @internal Reset the shared initialization promise between tests. */
export function resetAphrodyInitializationForTesting(): void {
  initialization = undefined;
}

function rpcResult(body: unknown, notification: boolean): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Réponse du service invalide.");
  }
  const response = body as { result?: unknown; error?: { message?: string } };
  if (response.error) throw new Error(response.error.message ?? "Échec du service.");
  if (notification) return {};
  if (!response.result || typeof response.result !== "object" || Array.isArray(response.result)) {
    throw new Error("Réponse du service incomplète.");
  }
  return response.result as Record<string, unknown>;
}

export async function aphrodyRpc(
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const request = method === "initialized" ? { method, params } : { id: ++bridgeRequestId, method, params };
  const response = await fetch("/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
  const body = (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { message?: string };
  };
  return rpcResult(body, method === "initialized");
}

export async function aphrodyReply(response: {
  id: string | number;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  backendGeneration?: number;
}): Promise<void> {
  const acknowledged = await fetch("/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response),
  });
  if (!acknowledged.ok) throw new Error(`Server returned HTTP ${acknowledged.status}`);
  rpcResult(await acknowledged.json(), true);
}

export async function aphrodySessionStream(threadId: string, onMessage: (msg: unknown) => void): Promise<() => void> {
  if (typeof EventSource !== "undefined") return browserSessionStream(threadId, onMessage);
  throw new Error("Le flux de conversation est indisponible.");
}

// ==========================================
// Desktop integration (crates/ui/app/src/integration.rs)
// ==========================================

/** Desktop pet, widget and autostart state (pet and widget persist in the `desktop.json` store). */
export interface DesktopIntegrationState {
  pet: boolean;
  widget: boolean;
  autostart: boolean;
}

export type DesktopIntegrationAction =
  | { action: "state" }
  | { action: "set_pet"; on: boolean }
  | { action: "set_widget"; on: boolean }
  | { action: "set_autostart"; on: boolean };

/** Desktop integration is not available on the web. */
export function desktopIntegration(_action: DesktopIntegrationAction): Promise<DesktopIntegrationState | null> {
  return Promise.resolve(null);
}

/** Open an http(s) or mailto URL in a new tab. */
export async function openExternal(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
}

// ==========================================
// Workspace File System (Local Explorer)
// ==========================================

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface FsDirResult {
  path: string;
  entries: FsEntry[];
}

export async function fsReadDir(path?: string): Promise<FsDirResult | null> {
  if (usesBrowserBackend()) return webOsReadDir(path);
  return null;
}

export interface FsFileResult {
  path: string;
  size: number;
  content: string;
}

export async function fsReadText(path: string): Promise<FsFileResult | null> {
  if (usesBrowserBackend()) return webOsReadText(path);
  return null;
}

// ==========================================
// Document search through the app-server
// ==========================================

export interface RagSearchResultItem {
  path: string;
  line?: number;
  score?: number;
  text?: string;
  /** ISO 639-1 code of the chunk, when the backend detects it (browser backend). */
  language?: string;
}

export interface RagSearchResponse {
  results: RagSearchResultItem[];
  rawText?: string;
}

export async function runRagSearch(query: string, limit = 5): Promise<RagSearchResponse> {
  if (usesBrowserBackend()) {
    const hits = await webOsRagSearch(query, limit);
    return {
      results: hits.map(hit => ({
        path: hit.path,
        line: hit.start_line,
        score: hit.score,
        text: hit.content,
        language: hit.language,
      })),
    };
  }
  const response = await aphrodyRpc("aphrody/rag/search", {
    query,
    topK: limit,
  });
  const results = Array.isArray(response.results) ? response.results : [];
  return {
    results: results.map(value => {
      const result = value as Record<string, unknown>;
      return {
        path: typeof result.path === "string" ? result.path : "",
        score: typeof result.score === "number" ? result.score : undefined,
        text: typeof result.content === "string" ? result.content : undefined,
      };
    }),
  };
}

export interface RagStats {
  documents: number;
  chunks: number;
}

export async function getRagStats(): Promise<RagStats> {
  if (usesBrowserBackend()) return webOsRagStats();
  await ensureAphrodyInitialized();
  const status = await aphrodyRpc("aphrody/rag/status");
  if (typeof status.indexedDocuments !== "number" || typeof status.totalChunks !== "number") {
    throw new Error("Les statistiques documentaires sont indisponibles.");
  }
  return { documents: status.indexedDocuments, chunks: status.totalChunks };
}
