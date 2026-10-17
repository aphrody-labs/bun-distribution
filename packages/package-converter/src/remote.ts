// SPDX-License-Identifier: MIT
import { rename, rm } from "node:fs/promises";

export interface DownloadOptions {
  maxBytes: number;
  timeoutMs: number;
  /** Expected lowercase SHA-256; the file is discarded on mismatch. */
  sha256?: string;
  /** Expected lowercase SHA-512 (Ubuntu 26.10 InRelease lists only SHA512). */
  sha512?: string;
  size?: number;
}

export interface Download {
  url: string;
  path: string;
  sha256: string;
  size: number;
}

/** Fetch the first mirror that answers into `path`, hashing while streaming. */
export async function download(
  urls: string[],
  path: string,
  options: DownloadOptions,
): Promise<Download> {
  const errors: string[] = [];
  for (const url of urls) {
    const partial = `${path}.part`;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(options.timeoutMs),
        redirect: "follow",
      });
      if (!response.ok || !response.body) {
        errors.push(`${url}: HTTP ${response.status}`);
        continue;
      }
      const declared = Number(response.headers.get("content-length") ?? NaN);
      if (Number.isFinite(declared) && declared > options.maxBytes)
        throw new Error("declared size exceeds the download limit");
      const hasher = new Bun.CryptoHasher("sha256");
      const strong = options.sha512
        ? new Bun.CryptoHasher("sha512")
        : undefined;
      const sink = Bun.file(partial).writer();
      let size = 0;
      try {
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > options.maxBytes)
            throw new Error("download exceeds its byte limit");
          hasher.update(chunk);
          strong?.update(chunk);
          sink.write(chunk);
          if (size % (8 << 20) < chunk.byteLength) await sink.flush();
        }
      } finally {
        await sink.end();
      }
      const sha256 = hasher.digest("hex");
      if (options.size !== undefined && size !== options.size)
        throw new Error(`size ${size} differs from expected ${options.size}`);
      if (options.sha256 && sha256 !== options.sha256.toLowerCase())
        throw new Error(`SHA-256 ${sha256} differs from ${options.sha256}`);
      if (strong && strong.digest("hex") !== options.sha512!.toLowerCase())
        throw new Error("SHA-512 differs from the signed index");
      await rename(partial, path);
      return { url, path, sha256, size };
    } catch (error) {
      await rm(partial, { force: true });
      errors.push(
        `${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(`Download failed:\n  ${errors.join("\n  ")}`);
}

/** Detect gzip or Zstandard by magic bytes and return a decoded stream. */
export async function decodedFile(
  path: string,
): Promise<ReadableStream<Uint8Array>> {
  const file = Bun.file(path);
  const head = new Uint8Array(await file.slice(0, 6).arrayBuffer());
  const stream = file.stream();
  if (head[0] === 0x1f && head[1] === 0x8b)
    return stream.pipeThrough(new DecompressionStream("gzip"));
  if (
    head[0] === 0x28 &&
    head[1] === 0xb5 &&
    head[2] === 0x2f &&
    head[3] === 0xfd
  )
    return stream.pipeThrough(
      new DecompressionStream("zstd" as CompressionFormat),
    );
  if (head[0] === 0xfd && head[1] === 0x37 && head[2] === 0x7a)
    throw new Error(`${path}: xz input needs a native decoder; use zstd`);
  return stream;
}

/** Lines of a decoded text stream; malformed UTF-8 becomes U+FFFD. */
export async function* lines(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): AsyncGenerator<string> {
  const text = new TextDecoder();
  let pending = "";
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error("Decoded text exceeds byte limit");
    pending += text.decode(chunk, { stream: true });
    let start = 0;
    for (;;) {
      const end = pending.indexOf("\n", start);
      if (end < 0) break;
      yield pending.slice(start, end);
      start = end + 1;
    }
    pending = pending.slice(start);
    if (pending.length > 1 << 20) throw new Error("Text line exceeds limit");
  }
  pending += text.decode();
  if (pending) yield pending;
}
