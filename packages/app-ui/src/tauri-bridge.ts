// SPDX-License-Identifier: Apache-2.0
/**
 * Tauri v2 Native Bridge for Aphrody OS.
 * Encapsulates window manager controls, native dialogs, OS telemetry,
 * desktop notifications, clipboard manager, and process lifecycle.
 */

import { Channel } from "@tauri-apps/api/core";
import { browserSessionStream } from "./browser-session-stream";

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
      };
      event?: {
        listen(name: string, handler: (event: { payload: unknown }) => void): Promise<() => void>;
      };
    };
  }
}

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

export function isTauri(): boolean {
  return typeof window !== "undefined" && Boolean(
    window.__TAURI__?.core ||
    (window as unknown as { __TAURI_INTERNALS__?: { invoke: unknown } }).__TAURI_INTERNALS__
  );
}

export async function tauriInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T | null> {
  if (!isTauri()) return null;
  if (window.__TAURI__?.core) {
    return window.__TAURI__.core.invoke<T>(cmd, args);
  }
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke: <R>(c: string, a: Record<string, unknown>) => Promise<R> };
  }).__TAURI_INTERNALS__;
  if (internals?.invoke) {
    return internals.invoke<T>(cmd, args);
  }
  return null;
}

export interface ShenronChatResponse {
  answer: string;
  mode: string;
  hits: Array<{ title: string; url: string; snippet: string; score: number; kind: string; source_id?: string | null }>;
}

export async function askShenron(query: string): Promise<ShenronChatResponse> {
  const result = await tauriInvoke<ShenronChatResponse>("aphrody_shenron_chat", { query });
  if (!result) throw new Error("L’assistant Shenron est disponible dans l’application de bureau.");
  return result;
}

// ==========================================
// Window Management (aphrody_shell_window)
// ==========================================

export async function shellWindowAction(action: Record<string, unknown>): Promise<{ closed: boolean; state?: ShellWindowState } | null> {
  return tauriInvoke<{ closed: boolean; state?: ShellWindowState }>("aphrody_shell_window", { action });
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
 * Signal to Tauri that the main window has mounted and finished its initial render.
 * This triggers `aphrody_app_ready` in the desktop backend to show the main window
 * and dismiss the splash screen immediately without waiting for `SPLASH_TIMEOUT`.
 */
export async function appReady(): Promise<void> {
  if (isTauri()) {
    await tauriInvoke("aphrody_app_ready").catch(() => {});
  }
}

// ==========================================
// Native Dialogs (tauri-plugin-dialog)
// ==========================================

export async function pickDirectory(title = "Select Working Directory", defaultPath?: string): Promise<string | null> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const result = await open({
        title,
        defaultPath,
        directory: true,
        multiple: false,
      });
      return typeof result === "string" ? result : null;
    } catch {
      return tauriInvoke<string | null>("plugin:dialog|open", {
        options: { title, defaultPath, directory: true, multiple: false },
      });
    }
  }
  return null;
}

export async function pickFile(title = "Select File", defaultPath?: string): Promise<string | null> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const result = await open({
        title,
        defaultPath,
        directory: false,
        multiple: false,
      });
      return typeof result === "string" ? result : null;
    } catch {
      return tauriInvoke<string | null>("plugin:dialog|open", {
        options: { title, defaultPath, directory: false, multiple: false },
      });
    }
  }
  return null;
}

export async function saveFileDialog(options: {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  if (isTauri()) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      return await save(options);
    } catch {
      return tauriInvoke<string | null>("plugin:dialog|save", { options });
    }
  }
  return null;
}

export async function confirmNative(message: string, title = "Confirmation"): Promise<boolean> {
  if (isTauri()) {
    try {
      const { confirm } = await import("@tauri-apps/plugin-dialog");
      return await confirm(message, { title, kind: "warning" });
    } catch {
      const res = await tauriInvoke<string>("plugin:dialog|message", {
        message,
        title,
        kind: "warning",
        buttons: "OkCancel",
      });
      return res === "Ok";
    }
  }
  if (typeof window !== "undefined") {
    return window.confirm(message);
  }
  return true;
}

export async function messageNative(message: string, title = "Aphrody OS", kind: "info" | "warning" | "error" = "info"): Promise<void> {
  if (isTauri()) {
    try {
      const { message: msg } = await import("@tauri-apps/plugin-dialog");
      await msg(message, { title, kind });
      return;
    } catch {
      await tauriInvoke("plugin:dialog|message", { message, title, kind });
      return;
    }
  }
  if (typeof window !== "undefined") {
    window.alert(message);
  }
}

// ==========================================
// OS Telemetry (tauri-plugin-os)
// ==========================================

export async function getOsTelemetry(): Promise<OsInfo> {
  if (!isTauri()) {
    return {
      platform: typeof navigator !== "undefined" ? navigator.platform || "web" : "web",
      version: "web",
      arch: "x86_64",
      locale: typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US",
      hostname: typeof location !== "undefined" ? location.hostname : "localhost",
      osType: "WebBrowser",
    };
  }
  try {
    const internals = (window as unknown as {
      __TAURI_OS_PLUGIN_INTERNALS__?: {
        platform: string;
        version: string;
        arch: string;
        os_type: string;
      };
    }).__TAURI_OS_PLUGIN_INTERNALS__;

    const [locale, hostname] = await Promise.all([
      tauriInvoke<string>("plugin:os|locale").catch(() => null),
      tauriInvoke<string>("plugin:os|hostname").catch(() => null),
    ]);

    return {
      platform: internals?.platform || (typeof navigator !== "undefined" ? navigator.platform || "unknown" : "unknown"),
      version: internals?.version || "unknown",
      arch: internals?.arch || "unknown",
      locale: locale || (typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US"),
      hostname: hostname || "localhost",
      osType: internals?.os_type || "unknown",
    };
  } catch {
    return {
      platform: "unknown",
      version: "unknown",
      arch: "unknown",
      locale: "unknown",
      hostname: "unknown",
      osType: "unknown",
    };
  }
}

// ==========================================
// Desktop Notifications (tauri-plugin-notification)
// ==========================================

export async function requestNotificationPermission(): Promise<boolean> {
  if (isTauri()) {
    try {
      const granted = await tauriInvoke<boolean>("plugin:notification|is_permission_granted");
      if (granted) return true;
      const state = await tauriInvoke<string>("plugin:notification|request_permission");
      return state === "granted";
    } catch {
      return false;
    }
  }
  if (typeof Notification !== "undefined") {
    if (Notification.permission === "granted") return true;
    const res = await Notification.requestPermission();
    return res === "granted";
  }
  return false;
}

export async function sendDesktopNotification(title: string, body?: string): Promise<void> {
  if (isTauri()) {
    try {
      await tauriInvoke("plugin:notification|notify", {
        options: { title, body },
      });
      return;
    } catch {
      // fallback
    }
  }
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch { /* ignored */ }
  }
}

// ==========================================
// Clipboard (tauri-plugin-clipboard-manager)
// ==========================================

export async function copyToNativeClipboard(text: string): Promise<boolean> {
  if (isTauri()) {
    try {
      await tauriInvoke("plugin:clipboard-manager|write_text", { text });
      return true;
    } catch {
      // fallback
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback
    }
  }
  if (typeof document !== "undefined") {
    try {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const success = document.execCommand("copy");
      document.body.removeChild(input);
      return success;
    } catch {
      return false;
    }
  }
  return false;
}

export async function readNativeClipboard(): Promise<string> {
  if (isTauri()) {
    try {
      const text = await tauriInvoke<string>("plugin:clipboard-manager|read_text");
      return text ?? "";
    } catch {
      // fallback
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      // fallback
    }
  }
  return "";
}

// ==========================================
// Process Controls (tauri-plugin-process)
// ==========================================

export async function restartApp(): Promise<void> {
  await tauriInvoke("plugin:process|restart");
}

export async function exitApp(code = 0): Promise<void> {
  await tauriInvoke("plugin:process|exit", { code });
}

// ==========================================
// Hardware telemetry and local models (`aphrody model …` behind crates/ui/app/src/models.rs)
// ==========================================

/** GPU as reported by `aphrody model accel` (snake_case, straight from the CLI). */
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
  artifacts: Array<{ ref: string; path: string; bytes: number; sha256: string; format: string; outcome: string }>;
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

/** Invoke a desktop command; outside Tauri there is no backend, which is an error, not an empty result. */
async function desktopInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) throw new Error("Aphrody desktop backend unavailable (not running inside Tauri)");
  return (await tauriInvoke<T>(command, args)) as T;
}

export function getHardwareTelemetry(): Promise<HardwareTelemetry> {
  return desktopInvoke<HardwareTelemetry>("aphrody_hardware_telemetry");
}

export function fetchModelCatalog(): Promise<{ count: number; entries: CatalogEntry[] }> {
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
  if (!window.__TAURI__?.event) return () => undefined;
  return window.__TAURI__.event.listen(MODEL_PULL_EVENT, (event) => handler(event.payload as PullProgress));
}

// ==========================================
// Auto-updater (vendored tauri-plugin-updater v2)
// ==========================================

/** `plugin:updater|check` result (plugin `Metadata`), `null` when up to date. */
export interface UpdateMetadata {
  rid: number;
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
}

type UpdaterEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

/** Ask the configured release feed for a newer signed build. Errors (no endpoint, bad signature, network) propagate. */
export function checkForAppUpdate(): Promise<UpdateMetadata | null> {
  return desktopInvoke<UpdateMetadata | null>("plugin:updater|check");
}

/** Download, verify (minisign) and install `update`, reporting received/total bytes, then restart. */
export async function installAppUpdate(
  update: UpdateMetadata,
  onProgress?: (received: number, total: number | null) => void,
): Promise<void> {
  let received = 0;
  let total: number | null = null;
  const onEvent = new Channel<UpdaterEvent>();
  onEvent.onmessage = (message) => {
    if (message.event === "Started") total = message.data.contentLength ?? null;
    if (message.event === "Progress") received += message.data.chunkLength;
    onProgress?.(received, total);
  };
  await desktopInvoke("plugin:updater|download_and_install", { rid: update.rid, onEvent });
  await restartApp();
}

let bridgeRequestId = 0;

export async function aphrodyRpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const request = method === "initialized" ? { method, params } : { id: ++bridgeRequestId, method, params };
  if (isTauri()) {
    const response = await tauriInvoke<{ result?: unknown; error?: { message?: string } }>("aphrody_rpc", { request });
    if (response?.error) throw new Error(response.error.message ?? "Aphrody RPC failure");
    return (response?.result ?? {}) as Record<string, unknown>;
  }
  const response = await fetch("./rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
  const body = (await response.json()) as { result?: Record<string, unknown>; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "Aphrody RPC failure");
  return body.result ?? {};
}

export async function aphrodyReply(response: {
  id: string | number;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  backendGeneration?: number;
}): Promise<void> {
  if (isTauri()) {
    await tauriInvoke("aphrody_reply", { response });
    return;
  }
  await fetch("./rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response),
  });
}

export async function aphrodySessionStream(
  threadId: string,
  onMessage: (msg: unknown) => void
): Promise<() => void> {
  if (!isTauri() && typeof EventSource !== "undefined") {
    return browserSessionStream(threadId, onMessage);
  }
  if (isTauri()) {
    try {
      const channel = new Channel<unknown>();
      channel.onmessage = onMessage;
      await tauriInvoke("aphrody_session_stream", {
        thread_id: threadId,
        threadId,
        channel,
      });
      return () => {
        tauriInvoke("aphrody_session_unstream", {
          thread_id: threadId,
          threadId,
        }).catch(() => {});
      };
    } catch (err) {
      console.warn("Failed to attach session stream:", err);
    }
  }
  return () => {};
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

/** Read or change the desktop integration from the main window. `null` outside Tauri. */
export function desktopIntegration(action: DesktopIntegrationAction): Promise<DesktopIntegrationState | null> {
  return tauriInvoke<DesktopIntegrationState>("aphrody_desktop_integration", { action });
}

/** Open an http(s) or mailto URL with the system handler (tauri-plugin-opener). */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  await tauriInvoke("plugin:opener|open_url", { url });
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
  return tauriInvoke<FsDirResult>("aphrody_fs_read_dir", { path });
}

export interface FsFileResult {
  path: string;
  size: number;
  content: string;
}

export async function fsReadText(path: string): Promise<FsFileResult | null> {
  return tauriInvoke<FsFileResult>("aphrody_fs_read_text", { path });
}

// ==========================================
// AI Contextual Operations (OCR, Transcribe, RAG)
// ==========================================

export interface OcrRunOptions {
  path: string;
  languages?: string[];
  force?: boolean;
}

export async function runOcr(options: OcrRunOptions): Promise<Record<string, unknown>> {
  void options;
  throw new Error("OCR is not exposed by the Aphrody app-server yet.");
}

export interface TranscribeRunOptions {
  path: string;
  model?: string;
  language?: string;
}

export async function runTranscribe(options: TranscribeRunOptions): Promise<Record<string, unknown>> {
  return aphrodyRpc("aphrody/transcribe/run", { ...options });
}

export interface RagIndexOptions {
  path: string;
  recursive?: boolean;
}

export async function runRagIndex(options: RagIndexOptions): Promise<Record<string, unknown>> {
  void options;
  throw new Error("RAG indexing is not exposed by the Aphrody app-server yet.");
}

export interface RagSearchResultItem {
  path: string;
  line?: number;
  score?: number;
  text?: string;
}

export interface RagSearchResponse {
  results: RagSearchResultItem[];
  rawText?: string;
}

export async function runRagSearch(query: string, limit = 5): Promise<RagSearchResponse> {
  const response = await aphrodyRpc("aphrody/rag/search", { query, topK: limit });
  const results = Array.isArray(response.results) ? response.results : [];
  return {
    results: results.map((value) => {
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
  try {
    const status = await aphrodyRpc("aphrody/rag/status");
    return {
      documents: typeof status.indexedDocuments === "number" ? status.indexedDocuments : 0,
      chunks: typeof status.totalChunks === "number" ? status.totalChunks : 0,
    };
  } catch {}
  return { documents: 0, chunks: 0 };
}

// ---------------------------------------------------------------------------
// Native Rust A2A & MCP Desktop Studio Bridge
// ---------------------------------------------------------------------------

export interface NativeA2AFleetResponse {
  peers: Array<{
    id: string;
    name: string;
    role: string;
    status: "busy" | "idle" | "offline";
    version?: string;
    skills?: string[];
    activeClaim?: string;
  }>;
  claims: Array<Record<string, unknown>>;
  envelopes: Array<Record<string, unknown>>;
  coordDir: string;
}

export async function fetchA2AFleetStatus(): Promise<NativeA2AFleetResponse | null> {
  return tauriInvoke<NativeA2AFleetResponse>("studio_a2a_fleet_status");
}

export async function sendA2AEnvelope(envelope: Record<string, unknown>): Promise<{ sent: boolean; path: string } | null> {
  return tauriInvoke<{ sent: boolean; path: string }>("studio_a2a_send_envelope", { envelope });
}

export interface NativeMcpToolItem {
  name: string;
  description: string;
  ui?: {
    resourceUri?: string;
    html?: string;
  } | null;
}

export async function fetchMcpToolsList(): Promise<{ tools: NativeMcpToolItem[]; protocol: string; m3Parity: boolean } | null> {
  return tauriInvoke<{ tools: NativeMcpToolItem[]; protocol: string; m3Parity: boolean }>("studio_mcp_tools_list");
}
