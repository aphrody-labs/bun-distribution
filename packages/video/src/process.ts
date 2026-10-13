import { VideoLibraryError, type VideoErrorCode } from "./errors.ts";

export interface ProcessLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

interface OwnedJob {
  assign(process: { pid: number }): void;
  terminate(code?: number): void;
  close(): void;
}

interface WindowsJobs {
  isSupported: boolean;
  Job?: new (options: { killOnClose: boolean }) => OwnedJob;
}

export interface ProcessResult {
  code: number;
  stdout: string;
}

async function reap(child: Bun.ReadableSubprocess): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      child.exited.catch(() => {}),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, 5_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function createJob(): Promise<OwnedJob | undefined> {
  if (process.platform !== "win32") return;
  try {
    const windows = (await import("bun:windows")) as unknown as WindowsJobs;
    if (windows.isSupported && windows.Job) return new windows.Job({ killOnClose: true });
  } catch {
    // Hosts without the optional owner API use taskkill for the same owned process tree.
  }
}

/** Bound both streams, including discarded diagnostics, and own the child's entire lifetime. */
export async function runBounded(
  argv: string[],
  cwd: string,
  limits: ProcessLimits,
  input?: Uint8Array,
): Promise<ProcessResult> {
  if (limits.signal?.aborted) {
    throw new VideoLibraryError("NATIVE_INTERRUPTED", "The native video operation was interrupted.");
  }
  let job = await createJob();
  if (limits.signal?.aborted) {
    job?.close();
    throw new VideoLibraryError("NATIVE_INTERRUPTED", "The native video operation was interrupted.");
  }
  const taskkill = process.platform === "win32" ? Bun.which("taskkill") : null;
  if (process.platform === "win32" && !job && !taskkill) {
    throw new VideoLibraryError("NATIVE_START_FAILED", "Native process tree cancellation is unavailable.");
  }
  const controller = new AbortController();
  const reads = new AbortController();
  let child: Bun.ReadableSubprocess;
  try {
    child = Bun.spawn(argv, {
      cwd,
      stdin: input ?? "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
      killSignal: "SIGKILL",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
  } catch {
    job?.close();
    throw new VideoLibraryError("NATIVE_START_FAILED", "The native video process could not start.");
  }
  if (job) {
    try {
      job.assign(child);
    } catch {
      job.close();
      job = undefined;
      if (!taskkill) {
        controller.abort();
        await Promise.allSettled([reap(child), child.stdout.cancel(), child.stderr.cancel()]);
        throw new VideoLibraryError("NATIVE_START_FAILED", "The native video process could not be isolated.");
      }
    }
  }

  let failure: VideoLibraryError | undefined;
  let stopping: Promise<void> | undefined;
  let outputBytes = 0;

  const stopTree = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      reads.abort();
      try {
        if (job) {
          job.terminate();
        } else if (process.platform !== "win32") {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            // The owned process group may already be gone.
          }
        } else if (taskkill && child.exitCode === null) {
          const killer = Bun.spawn([taskkill, "/PID", String(child.pid), "/T", "/F"], {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            windowsHide: true,
            signal: AbortSignal.timeout(5_000),
            killSignal: "SIGKILL",
          });
          await killer.exited;
        }
      } catch {
        // Abort still terminates the direct child if the host tree operation fails.
      } finally {
        controller.abort();
        await reap(child);
      }
    })();
    return stopping;
  };

  const fail = (code: VideoErrorCode, message: string) => {
    failure ??= new VideoLibraryError(code, message);
    void stopTree();
  };
  const interrupt = () => fail("NATIVE_INTERRUPTED", "The native video operation was interrupted.");
  const timer = setTimeout(
    () => fail("NATIVE_TIMEOUT", "The native video operation exceeded its deadline."),
    limits.timeoutMs,
  );
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  limits.signal?.addEventListener("abort", interrupt, { once: true });
  if (limits.signal?.aborted) interrupt();

  const collect = async (stream: ReadableStream<Uint8Array>, retain: boolean): Promise<string> => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let retainedBytes = 0;
    try {
      while (true) {
        if (reads.signal.aborted) throw failure;
        let interrupted: (() => void) | undefined;
        const cancelled = new Promise<never>((_resolve, reject) => {
          interrupted = () => reject(failure);
          reads.signal.addEventListener("abort", interrupted, { once: true });
        });
        let chunk: Awaited<ReturnType<typeof reader.read>>;
        try {
          chunk = await Promise.race([reader.read(), cancelled]);
        } finally {
          if (interrupted) reads.signal.removeEventListener("abort", interrupted);
        }
        if (chunk.done) break;
        outputBytes += chunk.value.byteLength;
        if (outputBytes > limits.maxOutputBytes) {
          fail("OUTPUT_LIMIT", "The native video operation exceeded its output limit.");
          throw failure;
        }
        if (retain) {
          chunks.push(chunk.value);
          retainedBytes += chunk.value.byteLength;
        }
      }
      if (!retain) return "";
      const bytes = new Uint8Array(retainedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } finally {
      if (reads.signal.aborted) void reader.cancel().catch(() => {});
      try {
        reader.releaseLock();
      } catch {
        // A cancelled read can finish after its consumer has stopped.
      }
    }
  };

  try {
    const [code, stdout] = await Promise.all([
      child.exited.then(code => {
        // Closing a Windows job also closes pipes inherited by its remaining children.
        job?.close();
        job = undefined;
        return code;
      }),
      collect(child.stdout, true),
      collect(child.stderr, false),
    ]);
    if (failure) throw failure;
    return { code, stdout };
  } catch (error) {
    if (!failure) failure = new VideoLibraryError("NATIVE_FAILED", "The native video operation failed.");
    await stopTree();
    if (error instanceof VideoLibraryError) throw error;
    throw failure;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    limits.signal?.removeEventListener("abort", interrupt);
    job?.close();
  }
}
