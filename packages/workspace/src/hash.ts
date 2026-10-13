/** Content identifiers use SHA-256, never an object store ETag. */
export function hashContent(data: string | Uint8Array | ArrayBuffer): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

export interface FileHashOptions {
  signal?: AbortSignal;
  maxBytes?: number;
}

/** One streamed hash owner for local files and remote object verification. */
export async function hashStream(stream: ReadableStream<Uint8Array>, options: FileHashOptions = {}): Promise<string> {
  const maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("Invalid file hash size limit.");
  options.signal?.throwIfAborted();
  const hasher = new Bun.CryptoHasher("sha256");
  const reader = stream.getReader();
  let bytes = 0;
  let finished = false;
  let rejectRead: ((reason?: unknown) => void) | undefined;
  const interrupt = () => rejectRead?.(options.signal?.reason ?? new DOMException("Interrupted", "AbortError"));
  options.signal?.addEventListener("abort", interrupt, { once: true });
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      const cancelled = new Promise<never>((_resolve, reject) => {
        rejectRead = reject;
      });
      const chunk = await Promise.race([reader.read(), cancelled]);
      rejectRead = undefined;
      if (chunk.done) {
        finished = true;
        return hasher.digest("hex");
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error("File hash size limit exceeded.");
      hasher.update(chunk.value);
    }
  } finally {
    options.signal?.removeEventListener("abort", interrupt);
    if (!finished) void reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      // A cancelled pending read can finish after its consumer has stopped.
    }
  }
}

/** Bound a large native payload before opening and while streaming its contents. */
export async function hashFile(path: string, options: FileHashOptions = {}): Promise<string> {
  options.signal?.throwIfAborted();
  const file = Bun.file(path);
  if (options.maxBytes !== undefined && file.size > options.maxBytes) throw new Error("File hash size limit exceeded.");
  return hashStream(file.stream(), options);
}
