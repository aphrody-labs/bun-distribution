import type {
  GeometryUpdate,
  Config,
  CodexModel,
  Frame,
  Operation,
  Page,
  PageSummary,
  PipelineConfig,
  Point,
  ProjectInfo,
  ProjectSummary,
  Scope,
  TypographyUpdate,
  TypesettingConfig,
} from "@aphrody/koharu-bridge/protocol";

interface NativeMethods {
  "agent.status": {
    params: {};
    result: {
      authenticated: boolean;
      running: string | null;
      login_running: boolean;
      config: Config;
    };
  };
  "agent.models": { params: {}; result: CodexModel[] };
  "agent.setConfig": { params: { config: Config }; result: { config: Config } };
  "agent.clear": { params: {}; result: null };
  "agent.login": { params: {}; result: { started: true } };
  "agent.cancelLogin": { params: {}; result: { cancelled: true } };
  "agent.logout": { params: {}; result: { authenticated: false } };
  "agent.run": { params: { prompt: string; cpu?: boolean }; result: { run: string } };
  "agent.cancel": { params: { run: string }; result: { cancelled: true } };
  "preferences.get": {
    params: {};
    result: { pipeline: PipelineConfig; providers: unknown[]; typesetting: TypesettingConfig };
  };
  "preferences.setPipeline": {
    params: { pipeline: PipelineConfig };
    result: { pipeline: PipelineConfig };
  };
  "preferences.setProviders": { params: { entries: unknown[] }; result: { providers: unknown[] } };
  "preferences.setTypesetting": {
    params: { typesetting: TypesettingConfig };
    result: { typesetting: TypesettingConfig };
  };
  "preferences.setCredential": {
    params: { provider: string; value?: string; clear?: boolean };
    result: { credential_configured: boolean };
  };
  "models.translation": { params: {}; result: unknown[] };
  "models.pipeline": { params: {}; result: unknown };
  "resources.status": { params: {}; result: unknown };
  "project.list": { params: {}; result: ProjectSummary[] };
  "project.delete": { params: { name: string }; result: null };
  "project.create": { params: { name: string }; result: ProjectInfo };
  "project.open": { params: { name: string }; result: ProjectInfo };
  "project.close": { params: {}; result: null };
  "project.info": { params: {}; result: ProjectInfo };
  "project.pages": { params: {}; result: PageSummary[] };
  "project.page": { params: { page: string }; result: Page | null };
  "project.selectPage": { params: { page: string }; result: ProjectInfo };
  "project.importPaths": {
    params: { paths: string[] };
    result: { pages: string[]; project: ProjectInfo };
  };
  "project.undo": { params: {}; result: ProjectInfo };
  "project.redo": { params: {}; result: ProjectInfo };
  "page.rename": { params: { page: string; label: string }; result: ProjectInfo };
  "page.delete": { params: { pages: string[] }; result: ProjectInfo };
  "page.move": { params: { page: string; index: number }; result: ProjectInfo };
  "page.result": { params: { page: string }; result: unknown };
  "page.sourceSha256": { params: { page: string }; result: { sha256: string } };
  "page.exportPng": {
    params: { page: string; path: string };
    result: { path: string; bytes: number };
  };
  "page.exportPsd": {
    params: { page: string; path: string };
    result: { path: string; bytes: number };
  };
  "text.addPoint": {
    params: { page: string; point: Point };
    result: { layer: string; project: ProjectInfo };
  };
  "text.addBox": {
    params: { page: string; frame: Frame };
    result: { layer: string; project: ProjectInfo };
  };
  "text.setSource": { params: { layer: string; text: string }; result: ProjectInfo };
  "text.setTranslation": { params: { layer: string; text: string | null }; result: ProjectInfo };
  "text.setTypography": { params: { updates: TypographyUpdate[] }; result: ProjectInfo };
  "layer.setGeometry": { params: { updates: GeometryUpdate[] }; result: ProjectInfo };
  "layer.setVisibility": {
    params: { layers: string[]; visible?: boolean | null; opacity?: number | null };
    result: ProjectInfo;
  };
  "layer.delete": { params: { layers: string[] }; result: ProjectInfo };
  "layer.move": { params: { layer: string; parent: string; index: number }; result: ProjectInfo };
  "raster.stroke": {
    params: {
      page: string;
      layer?: string | null;
      mode: "paint" | "erase";
      color: [number, number, number, number];
      diameter: number;
      points: Point[];
    };
    result: { layer: string; project: ProjectInfo };
  };
  "pipeline.run": {
    params: { operation?: Operation; scope?: Scope; cpu?: boolean };
    result: {
      status: string;
      base: number;
      finalRevision: number;
      completed: number;
      total: number;
      elapsedMs: number;
      project: ProjectInfo;
    };
  };
  "pipeline.start": {
    params: { operation?: Operation; scope?: Scope; cpu?: boolean };
    result: { job: number };
  };
  "pipeline.status": { params: {}; result: { running: number | null } };
  "pipeline.cancel": { params: { job: number }; result: { cancelled: true } };
  "canvas.preparePage": {
    params: { page: string };
    result: { prepared: unknown; revision: number };
  };
  "canvas.manifest": { params: { page: string }; result: { base64: string } };
  "canvas.resource": { params: { page: string; resource: string }; result: { base64: string } };
}

export type NativeMethod = keyof NativeMethods;
export type NativeParams<Method extends NativeMethod> = NativeMethods[Method]["params"];
export type NativeResult<Method extends NativeMethod> = NativeMethods[Method]["result"];

export interface NativeClient {
  readonly exited: Promise<number>;
  call<Method extends NativeMethod>(
    method: Method,
    params: NativeParams<Method>,
  ): Promise<NativeResult<Method>>;
  onAgentEvent(receive: (event: { run: string; value: unknown }) => void): () => void;
  onAgentLoginEvent(receive: (value: unknown) => void): () => void;
  onPipelineEvent(receive: (event: { job: number; value: unknown }) => void): () => void;
  close(): Promise<void>;
}

export function formatSdkError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return JSON.stringify(error) ?? String(error);
}

/** Starts the headless Rust host; importing this module has no process side effects. */
export function startNativeClient(options: { binary?: string; root?: string } = {}): NativeClient {
  const command = [options.binary ?? "koharu-sdk"];
  if (options.root) command.push("--root", options.root);
  const child = Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const agentListeners = new Set<(event: { run: string; value: unknown }) => void>();
  const agentLoginListeners = new Set<(value: unknown) => void>();
  const pipelineListeners = new Set<(event: { job: number; value: unknown }) => void>();
  let nextId = 0;
  let closed = false;
  let closing: Promise<void> | undefined;

  const fail = (error: Error) => {
    closed = true;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  void (async () => {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 150_000_000) throw new Error("Koharu SDK response exceeds 150 MB");
        let end: number;
        while ((end = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (!line.trim()) continue;
          const message: unknown = JSON.parse(line);
          if (
            typeof message === "object" &&
            message !== null &&
            "event" in message &&
            message.event === "agent" &&
            "run" in message &&
            typeof message.run === "string" &&
            "value" in message
          ) {
            for (const receive of agentListeners) {
              try {
                receive({ run: message.run, value: message.value });
              } catch {
                // A subscriber cannot interrupt the native response stream.
              }
            }
            continue;
          }
          if (
            typeof message === "object" &&
            message !== null &&
            "event" in message &&
            message.event === "agent_login" &&
            "value" in message
          ) {
            for (const receive of agentLoginListeners) {
              try {
                receive(message.value);
              } catch {
                // A subscriber cannot interrupt the native response stream.
              }
            }
            continue;
          }
          if (
            typeof message === "object" &&
            message !== null &&
            "event" in message &&
            message.event === "pipeline" &&
            "job" in message &&
            typeof message.job === "number" &&
            "value" in message
          ) {
            for (const receive of pipelineListeners) {
              try {
                receive({ job: message.job, value: message.value });
              } catch {
                // A subscriber cannot interrupt the native response stream.
              }
            }
            continue;
          }
          if (
            typeof message !== "object" ||
            message === null ||
            !("id" in message) ||
            typeof message.id !== "number"
          ) {
            throw new Error("The Koharu SDK returned an invalid response.");
          }
          const request = pending.get(message.id);
          if (!request) continue;
          pending.delete(message.id);
          if ("error" in message) request.reject(new Error(formatSdkError(message.error)));
          else if ("result" in message) request.resolve(message.result);
          else {
            const error = new Error("The Koharu SDK response has no result or error.");
            request.reject(error);
            throw error;
          }
        }
      }
      if (buffer.trim()) throw new Error("The Koharu SDK closed with an incomplete response.");
      fail(new Error("The Koharu SDK process closed."));
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      child.kill();
    } finally {
      reader.releaseLock();
    }
  })();

  return {
    exited: child.exited,
    call<Method extends NativeMethod>(method: Method, params: NativeParams<Method>) {
      if (closed) return Promise.reject(new Error("The Koharu SDK process is closed."));
      const id = ++nextId;
      return new Promise<NativeResult<Method>>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        try {
          child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
          child.stdin.flush();
        } catch (error) {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    onAgentEvent(receive) {
      agentListeners.add(receive);
      return () => agentListeners.delete(receive);
    },
    onAgentLoginEvent(receive) {
      agentLoginListeners.add(receive);
      return () => agentLoginListeners.delete(receive);
    },
    onPipelineEvent(receive) {
      pipelineListeners.add(receive);
      return () => pipelineListeners.delete(receive);
    },
    close() {
      if (!closing) {
        if (!closed) {
          closed = true;
          child.stdin.end();
        }
        closing = child.exited.then(() => {
          fail(new Error("The Koharu SDK process closed."));
        });
      }
      return closing;
    },
  };
}
