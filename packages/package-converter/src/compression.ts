// SPDX-License-Identifier: MIT
import { LIMITS } from "./types.ts";
import { boundedZstd } from "./zstd.ts";

async function collect(stream: ReadableStream<Uint8Array>, limit: number, abort?: () => void): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error("Decoded data exceeds byte limit");
      chunks.push(value);
    }
  } catch (error) {
    abort?.();
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function decompress(data: Uint8Array, nativeDecoder?: string): Promise<Uint8Array> {
  let format: "gzip" | "zstd" | "xz" | "bzip2" | undefined;
  if (data[0] === 0x1f && data[1] === 0x8b) format = "gzip";
  else if (data[0] === 0x28 && data[1] === 0xb5 && data[2] === 0x2f && data[3] === 0xfd) format = "zstd";
  else if (
    data[0] === 0xfd &&
    data[1] === 0x37 &&
    data[2] === 0x7a &&
    data[3] === 0x58 &&
    data[4] === 0x5a &&
    data[5] === 0
  )
    format = "xz";
  else if (data[0] === 0x42 && data[1] === 0x5a && data[2] === 0x68) format = "bzip2";
  if (!format) return data;
  if (format === "zstd") return boundedZstd(data);
  if (format === "gzip") {
    const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("gzip"));
    return collect(stream, LIMITS.unpacked);
  }
  if (!nativeDecoder)
    throw new Error(`${format} needs --decoder with an explicitly configured native 7-Zip executable`);
  // Native 7-Zip consumes the compressed member on stdin, returns bytes on stdout, writes no files.
  const process = Bun.spawn(
    [nativeDecoder, "e", "-so", "-si", `-t${format}`, "-bd", "-bsp0", "-bso0", "-bse2", "-mmt1"],
    {
      stdin: new Blob([new Uint8Array(data)]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: LIMITS.deadlineMs,
    },
  );
  const results = await Promise.allSettled([
    collect(process.stdout, LIMITS.unpacked, () => process.kill()),
    collect(process.stderr, 65536, () => process.kill()),
    process.exited,
  ]);
  const output = results[0]!;
  const status = results[2]!;
  if (output.status === "rejected") throw output.reason;
  if (status.status === "rejected" || status.value !== 0) throw new Error(`Native ${format} decoder failed`);
  if (results[1]!.status === "rejected") throw new Error("Native decoder error output exceeds limit");
  return output.value;
}
