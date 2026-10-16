// SPDX-License-Identifier: MIT
import { LIMITS } from "./types.ts";

// Frame layout: https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md
// Bun's decoder streams frames with unknown size and known frames over 16 MiB; bound the maximum output
// of every block before invoking it. A forged content-size field alone is insufficient.
export function boundedZstd(data: Uint8Array): Uint8Array {
  if (
    data.length > LIMITS.packed ||
    data.length < 5 ||
    data[0] !== 0x28 ||
    data[1] !== 0xb5 ||
    data[2] !== 0x2f ||
    data[3] !== 0xfd
  )
    throw new Error("Expected one bounded Zstandard frame");
  let offset = 4;
  const take = (size: number): Uint8Array => {
    if (size > data.length - offset)
      throw new Error("Truncated Zstandard frame");
    const bytes = data.subarray(offset, offset + size);
    offset += size;
    return bytes;
  };
  const integer = (size: number): bigint => {
    const bytes = take(size);
    let value = 0n;
    for (let index = bytes.length - 1; index >= 0; index--)
      value = value * 256n + BigInt(bytes[index]!);
    return value;
  };
  const descriptor = take(1)[0]!;
  if (descriptor & 8)
    throw new Error("Reserved Zstandard frame descriptor bit");
  const single = !!(descriptor & 32);
  const contentFlag = descriptor >> 6;
  let window = 0;
  if (!single) {
    const descriptor = take(1)[0]!;
    const base = 2 ** (10 + (descriptor >> 3));
    window = base + (base / 8) * (descriptor & 7);
    if (window > LIMITS.unpacked)
      throw new Error("Zstandard window exceeds byte limit");
  }
  const dictionarySize = [0, 1, 2, 4][descriptor & 3]!;
  if (integer(dictionarySize) !== 0n)
    throw new Error("Zstandard dictionary is not configured");
  const contentSizeBytes =
    contentFlag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][contentFlag]!;
  const contentSize = contentSizeBytes
    ? integer(contentSizeBytes) + (contentSizeBytes === 2 ? 256n : 0n)
    : undefined;
  if (contentSize !== undefined && contentSize > BigInt(LIMITS.unpacked))
    throw new Error("Zstandard decoded size exceeds byte limit");
  if (single) window = Number(contentSize);
  const blockMaximum = Math.min(window, 128 * 1024);
  let worstOutput = 0;
  let knownOutput = 0;
  let blocks = 0;
  for (;;) {
    if (++blocks > LIMITS.entries)
      throw new Error("Zstandard block count exceeds limit");
    const header = take(3);
    const value = header[0]! + (header[1]! << 8) + (header[2]! << 16);
    const last = !!(value & 1);
    const type = (value >> 1) & 3;
    const size = value >>> 3;
    if (type === 3 || size > blockMaximum)
      throw new Error("Invalid Zstandard block size or type");
    worstOutput += type === 2 ? blockMaximum : size;
    if (type !== 2) knownOutput += size;
    if (
      worstOutput > LIMITS.unpacked ||
      (contentSize !== undefined && BigInt(knownOutput) > contentSize)
    )
      throw new Error("Zstandard blocks exceed decoded byte bound");
    take(type === 1 ? 1 : size);
    if (last) break;
  }
  if (descriptor & 4) take(4);
  if (offset !== data.length)
    throw new Error(
      "Zstandard trailing data, skippable frames or multiple frames are not accepted",
    );
  if (contentSize !== undefined && BigInt(worstOutput) < contentSize)
    throw new Error("Zstandard declared size exceeds its block output bound");
  const decoded = Bun.zstdDecompressSync(data);
  if (
    decoded.length > worstOutput ||
    (contentSize !== undefined && decoded.length !== Number(contentSize))
  )
    throw new Error("Zstandard decoded size differs from its frame bounds");
  return decoded;
}
