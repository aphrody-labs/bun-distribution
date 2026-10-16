// SPDX-License-Identifier: MIT
import { decoder, LIMITS } from "./types.ts";

export interface ArMember {
  name: string;
  data: Uint8Array;
}

/** Debian uses the common ar format, decimal sizes and even-byte member alignment. */
export function ar(data: Uint8Array): ArMember[] {
  if (
    data.length > LIMITS.packed ||
    decoder.decode(data.subarray(0, 8)) !== "!<arch>\n"
  )
    throw new Error("Invalid or oversized ar archive");
  const members: ArMember[] = [];
  const names = new Set<string>();
  for (let offset = 8; offset < data.length;) {
    if (offset + 60 > data.length) throw new Error("Truncated ar header");
    const header = decoder.decode(data.subarray(offset, offset + 60));
    const name = header.slice(0, 16).trim().replace(/\/$/, "");
    const sizeText = header.slice(48, 58).trim();
    if (
      !name ||
      name.startsWith("/") ||
      name.startsWith("#1/") ||
      names.has(name) ||
      header.slice(58) !== "`\n" ||
      !/^\d+$/.test(sizeText)
    )
      throw new Error("Unsupported or duplicate ar member");
    const size = Number(sizeText);
    const start = offset + 60;
    if (!Number.isSafeInteger(size) || size > data.length - start)
      throw new Error("Truncated ar member");
    names.add(name);
    members.push({ name, data: data.subarray(start, start + size) });
    if (members.length > 1000) throw new Error("Too many ar members");
    offset = start + size + (size % 2);
    if (offset > data.length) throw new Error("Missing ar alignment byte");
  }
  return members;
}
