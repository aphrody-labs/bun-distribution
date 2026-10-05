/**
 * Light client of the precompiled CEF desktop host. Process supervision stays in the
 * C ABI runtime; Tauri, CEF and GTK 4 are confined to the desktop artifact.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ManagedProcess } from "./index";
import { sharedRuntime } from "./modules";
import { installedDesktopExecutable } from "./desktop-artifact";

export type DesktopGrant = "window.create" | "window.control" | "window.observe";
export interface DesktopOptions {
  readonly executable?: string;
  readonly grants: readonly DesktopGrant[];
  readonly allowedOrigins: readonly string[];
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export interface WindowOptions {
  readonly url: string;
  readonly title: string;
  readonly width?: number;
  readonly height?: number;
  readonly signal?: AbortSignal;
}
export interface DesktopEvent {
  readonly sequence: number;
  readonly window: string;
  readonly kind: string;
  readonly data: unknown;
}
export interface WindowInfo {
  readonly window: string;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
}
export class DesktopError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "DesktopError";
  }
}

const MAX_FRAME = 64 * 1024;
const REQUEST_TIMEOUT_MS = 6_000;

/** One authenticated JSON frame per connection, bounded independently of the native host. */
function exchange(
  port: number,
  token: string,
  id: number,
  method: string,
  params: unknown,
  sockets: Set<Socket>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const frame = JSON.stringify({ token, id, method, params }) + "\n";
    if (Buffer.byteLength(frame) > MAX_FRAME) {
      reject(new DesktopError("InvalidArgument", "desktop request exceeds 64 KiB"));
      return;
    }
    const socket = createConnection({ host: "127.0.0.1", port });
    sockets.add(socket);
    let chunks = Buffer.alloc(0);
    let done = false;
    const finish = (error?: Error, value?: unknown): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sockets.delete(socket);
      socket.destroy();
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new DesktopError("Timeout", "desktop reply timed out")),
      REQUEST_TIMEOUT_MS,
    );
    socket.once("connect", () => socket.write(frame));
    socket.once("error", (error) => finish(error));
    socket.once("close", () =>
      finish(new DesktopError("SessionClosed", "desktop connection closed")),
    );
    socket.on("data", (data: Buffer) => {
      chunks = Buffer.concat([chunks, data]);
      if (chunks.length > MAX_FRAME) {
        finish(new DesktopError("OutputLimit", "desktop reply exceeds 64 KiB"));
        return;
      }
      const newline = chunks.indexOf(10);
      if (newline < 0) return;
      try {
        const reply: unknown = JSON.parse(chunks.subarray(0, newline).toString("utf8"));
        if (reply === null || typeof reply !== "object" || !("id" in reply) || reply.id !== id) {
          throw new DesktopError("ProtocolMismatch", "desktop reply has a different request id");
        }
        if ("error" in reply) {
          const error = reply.error;
          if (
            error === null ||
            typeof error !== "object" ||
            !("code" in error) ||
            !("message" in error) ||
            typeof error.code !== "string" ||
            typeof error.message !== "string"
          ) {
            throw new DesktopError("ProtocolMismatch", "desktop error reply is invalid");
          }
          finish(new DesktopError(error.code, error.message));
        } else if ("result" in reply) finish(undefined, reply.result);
        else throw new DesktopError("ProtocolMismatch", "desktop reply is missing its result");
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export class DesktopWindow {
  #closed = false;
  constructor(
    readonly id: string,
    readonly session: DesktopSession,
  ) {}
  async info(): Promise<WindowInfo> {
    return (await this.session.request("window.info", { window: this.id })) as WindowInfo;
  }
  async setTitle(title: string): Promise<void> {
    await this.session.request("window.title", { window: this.id, title });
  }
  async resize(width: number, height: number): Promise<void> {
    await this.session.request("window.resize", { window: this.id, width, height });
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    try {
      await this.session.request("window.close", { window: this.id });
    } catch (error) {
      if (!(error instanceof DesktopError && error.code === "InvalidHandle")) throw error;
    }
    this.#closed = true;
  }
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/** A session owns its windows and native host. Closing it joins the supervised process. */
export class DesktopSession {
  #nextId = 0;
  #closed = false;
  #closing: Promise<void> | undefined;
  #sockets = new Set<Socket>();
  #abortCleanup: (() => void) | undefined;
  private constructor(
    readonly process: ManagedProcess,
    readonly port: number,
    private readonly token: string,
  ) {}

  static async open(options: DesktopOptions): Promise<DesktopSession> {
    options.signal?.throwIfAborted();
    const executable =
      options.executable ??
      process.env["YOLO_DESKTOP_BIN"] ??
      installedDesktopExecutable() ??
      join(
        process.env["YOLO_HOME"] ?? join(homedir(), ".yolo"),
        "bin",
        process.platform === "win32" ? "yolo-desktop.exe" : "yolo-desktop",
      );
    if (!existsSync(executable))
      throw new DesktopError(
        "ArtifactMissing",
        `precompiled desktop host not found at ${executable}`,
      );
    const token = randomBytes(32).toString("hex");
    const child = sharedRuntime().spawn({
      program: executable,
      args: ["--runtime-host"],
      stdio: "capture-lossless",
      maxOutputBytes: 1024 * 1024,
      env: {
        YOLO_DESKTOP_TOKEN: token,
        YOLO_DESKTOP_POLICY: JSON.stringify({
          grants: options.grants,
          allowedOrigins: options.allowedOrigins,
        }),
      },
    });
    let session: DesktopSession | undefined;
    try {
      const ready: unknown = JSON.parse(
        await child.waitForStdoutLine({
          timeoutMs: options.timeoutMs ?? 15_000,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      );
      if (
        ready === null ||
        typeof ready !== "object" ||
        !("protocol" in ready) ||
        ready.protocol !== "yolo.desktop/1" ||
        !("port" in ready) ||
        typeof ready.port !== "number" ||
        !Number.isInteger(ready.port) ||
        ready.port < 1 ||
        ready.port > 65535
      ) {
        throw new DesktopError("ProtocolMismatch", "desktop host handshake is incompatible");
      }
      session = new DesktopSession(child, ready.port, token);
      const ownedSession = session;
      if (options.signal !== undefined) {
        const signal = options.signal;
        const abort = (): void => {
          void ownedSession.close().catch(() => {});
        };
        signal.addEventListener("abort", abort, { once: true });
        session.#abortCleanup = () => signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          await session.close();
          signal.throwIfAborted();
        }
      }
      return session;
    } catch (error) {
      if (session !== undefined) {
        await session.close();
        throw error;
      }
      let stderr = "";
      try {
        stderr = child.stderrTail(2048);
      } catch {
        // Capture failures must not prevent ownership cleanup after failed startup.
      }
      try {
        await child.stopAsync(500);
      } finally {
        child.release();
      }
      if (options.signal?.aborted) options.signal.throwIfAborted();
      throw new DesktopError(
        "StartupFailed",
        `${error instanceof Error ? error.message : String(error)}${stderr ? `: ${stderr}` : ""}`,
      );
    }
  }

  /** Calls are checked for grants, bounds and current window identity in the native host. */
  request(method: string, params: unknown = null): Promise<unknown> {
    if (this.#closed)
      return Promise.reject(new DesktopError("SessionClosed", "desktop session is closed"));
    return exchange(this.port, this.token, ++this.#nextId, method, params, this.#sockets).then(
      (result) => {
        if (this.#closed)
          throw new DesktopError("SessionClosed", "desktop session closed during dispatch");
        return result;
      },
    );
  }

  async createWindow(options: WindowOptions): Promise<DesktopWindow> {
    options.signal?.throwIfAborted();
    const pending = this.request("window.create", {
      url: options.url,
      title: options.title,
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.height === undefined ? {} : { height: options.height }),
    }).then((result) => {
      if (
        result === null ||
        typeof result !== "object" ||
        !("window" in result) ||
        typeof result.window !== "string"
      ) {
        throw new DesktopError("ProtocolMismatch", "desktop create reply is invalid");
      }
      return new DesktopWindow(result.window, this);
    });
    if (options.signal === undefined) return await pending;
    const signal = options.signal;
    return await new Promise<DesktopWindow>((resolve, reject) => {
      const abort = (): void => {
        // Keep the native create reply alive so cancellation can destroy its exact resource.
        void pending.then((window) => window.close()).catch(() => {});
        reject(signal.reason ?? new DOMException("Window creation aborted", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      pending.then(
        (window) => {
          signal.removeEventListener("abort", abort);
          resolve(window);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
      if (signal.aborted) abort();
    });
  }

  async events(
    since = 0,
  ): Promise<{ readonly sequence: number; readonly events: readonly DesktopEvent[] }> {
    return (await this.request("events.read", { since })) as {
      readonly sequence: number;
      readonly events: readonly DesktopEvent[];
    };
  }

  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    this.#closed = true;
    this.#abortCleanup?.();
    try {
      await exchange(this.port, this.token, ++this.#nextId, "shutdown", null, this.#sockets);
      await this.process.waitForExit({ signal: AbortSignal.timeout(5_000) });
    } catch {
      await this.process.stopAsync(500);
    } finally {
      for (const socket of this.#sockets) socket.destroy();
      this.#sockets.clear();
      this.process.release();
    }
  }
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export const desktop = {
  open: (options: DesktopOptions): Promise<DesktopSession> => DesktopSession.open(options),
};
