// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";

/** Validate the original PNG bytes and derive the reference manifest metadata. */
export function zukanReferenceFrame(data: Uint8Array, url: string) {
  const bytes = Buffer.from(data);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Invalid PNG: ${url}`);
  }
  return {
    bytes,
    metadata: {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}
